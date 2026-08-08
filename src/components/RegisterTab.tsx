import { useState } from 'react';
import type { Category, Phrase } from '../types';
import { newId } from '../store';
import { lookupTerm } from '../lib/gemini';

interface Props {
  categories: Category[];
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  activeCatId: string;
  setActiveCatId: (id: string) => void;
  apiKey?: string;
  model?: string;
}

export default function RegisterTab({
  categories,
  setCategories,
  activeCatId,
  setActiveCatId,
  apiKey,
  model,
}: Props) {
  const [newCat, setNewCat] = useState('');
  const [draft, setDraft] = useState<Record<string, { text: string; meaning: string; note: string }>>(
    {},
  );
  const [importName, setImportName] = useState('');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [autoFill, setAutoFill] = useState(true);

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    const cat: Category = { id: newId(), name, phrases: [] };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setNewCat('');
  };

  // 붙여넣기 파싱: 빈 줄로 항목 구분.
  // - 라벨(구문/뜻/풀이/예문)이 있으면 그걸 사용
  // - 없으면 "Think in English" 설명문으로 보고 "" 안 = 구문, 문단 = 풀이
  // - "영어 | 뜻" 한 줄 단축도 지원
  const parseBlocks = (raw: string): Phrase[] => {
    const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const out: Phrase[] = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const hasLabel = lines.some((l) =>
        /^(구문|문장|뜻|의미|풀이|해설|예문|example|meaning)\s*[:：]/i.test(l),
      );

      if (hasLabel) {
        let text = '';
        let meaning = '';
        let explanation = '';
        let example = '';
        let cur: 'text' | 'meaning' | 'explanation' | 'example' | null = null;
        for (const line of lines) {
          const m = line.match(/^(구문|문장|뜻|의미|풀이|해설|예문|example|meaning)\s*[:：]\s*(.*)$/i);
          if (m) {
            const label = m[1].toLowerCase();
            const val = m[2].trim();
            if (/구문|문장/.test(label)) (text = val), (cur = 'text');
            else if (/뜻|의미|meaning/.test(label)) (meaning = val), (cur = 'meaning');
            else if (/풀이|해설/.test(label)) (explanation = val), (cur = 'explanation');
            else (example = val), (cur = 'example');
          } else if (cur === 'text') text += (text ? '\n' : '') + line;
          else if (cur === 'meaning') meaning += (meaning ? '\n' : '') + line;
          else if (cur === 'explanation') explanation += (explanation ? '\n' : '') + line;
          else if (cur === 'example') example += (example ? '\n' : '') + line;
        }
        if (text) {
          out.push({ id: newId(), text, meaning, ...(explanation ? { explanation } : {}), ...(example ? { example } : {}) });
        }
      } else {
        // 라벨 없음
        const quoted = block.match(/["“”]([^"“”]+)["“”]/); // "" 안의 배울 구문
        const pipe = block.split(/\s*[|\t]\s*/);
        if (quoted) {
          out.push({ id: newId(), text: quoted[1].trim(), meaning: '', explanation: block });
        } else if (pipe.length >= 2) {
          out.push({ id: newId(), text: pipe[0].trim(), meaning: pipe[1].trim() });
        } else if (block) {
          out.push({ id: newId(), text: block.split('\n')[0].trim(), meaning: '' });
        }
      }
    }
    return out;
  };

  const importPhrases = async () => {
    const phrases = parseBlocks(importText);
    if (phrases.length === 0) {
      setImportMsg('가져올 문장이 없어요. "" 안에 배울 구문이 있는지 확인해 주세요.');
      return;
    }
    const cat: Category = { id: newId(), name: importName.trim() || '가져온 문장', phrases };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setImportText('');
    setImportName('');

    if (autoFill && apiKey && phrases.some((p) => !p.meaning)) {
      setImportBusy(true);
      setImportMsg(`✓ ${phrases.length}개 등록. 뜻을 채우는 중…`);
      for (const p of phrases) {
        if (p.meaning) continue;
        try {
          const r = await lookupTerm(apiKey, p.text, model);
          setCategories((prev) =>
            prev.map((c) =>
              c.id === cat.id
                ? { ...c, phrases: c.phrases.map((x) => (x.id === p.id ? { ...x, meaning: r.korean } : x)) }
                : c,
            ),
          );
        } catch {
          /* 뜻 자동 채우기 실패는 건너뜀 */
        }
      }
      setImportBusy(false);
    }
    setImportMsg(`✓ ${phrases.length}개 항목을 "${cat.name}" 카테고리로 등록했어요.`);
  };

  const addPhrase = (catId: string) => {
    const d = draft[catId];
    if (!d || !d.text.trim() || !d.meaning.trim()) return;
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              phrases: [
                ...c.phrases,
                {
                  id: newId(),
                  text: d.text.trim(),
                  meaning: d.meaning.trim(),
                  note: d.note.trim() || undefined,
                },
              ],
            }
          : c,
      ),
    );
    setDraft((prev) => ({ ...prev, [catId]: { text: '', meaning: '', note: '' } }));
  };

  const removePhrase = (catId: string, phraseId: string) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, phrases: c.phrases.filter((p) => p.id !== phraseId) } : c,
      ),
    );
  };

  const removeCategory = (catId: string) => {
    if (!confirm('이 카테고리와 안의 구문을 모두 삭제할까요?')) return;
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== catId);
      if (activeCatId === catId && next[0]) setActiveCatId(next[0].id);
      return next;
    });
  };

  const d = (catId: string) => draft[catId] ?? { text: '', meaning: '', note: '' };
  const setD = (catId: string, patch: Partial<{ text: string; meaning: string; note: string }>) =>
    setDraft((prev) => ({ ...prev, [catId]: { ...d(catId), ...patch } }));

  return (
    <div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="section-label">새 카테고리</div>
        <div className="row">
          <input
            className="input"
            placeholder="예: 여행에서 쓰는 구문"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            style={{ flex: 1 }}
          />
          <button className="btn primary" onClick={addCategory}>
            추가
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="section-label">가져오기 (붙여넣기)</div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          "Think in English" 설명문을 그대로 붙여넣으세요. <b>"" 안의 표현 = 배울 구문</b>, 문단
          전체 = 영어 풀이로 저장돼요. 뜻은 AI가 자동으로 채워줍니다. 여러 개면 <b>빈 줄</b>로 구분.
        </p>
        <input
          className="input"
          placeholder="카테고리 이름 (예: 티처조 영어식 사고 100)"
          value={importName}
          onChange={(e) => setImportName(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <textarea
          className="input"
          rows={7}
          placeholder={
            'When we say we "are starting to like" something, it means we are beginning to enjoy it...'
          }
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          style={{ resize: 'vertical', fontSize: 13 }}
        />
        <label className="toggle" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFill(e.target.checked)} />
          뜻 자동 채우기 (AI)
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={importPhrases} disabled={importBusy}>
            {importBusy ? <span className="spinner" /> : '가져오기'}
          </button>
          {importMsg && (
            <span className="hint" style={{ color: importMsg.startsWith('✓') ? 'var(--good)' : 'var(--danger)' }}>
              {importMsg}
            </span>
          )}
        </div>
      </div>

      {categories.map((cat) => (
        <div className="card" key={cat.id} style={{ marginBottom: 16 }}>
          <div className="cat-head">
            <div>
              <div className="cat-name">{cat.name}</div>
              <div className="cat-count">{cat.phrases.length}개 구문</div>
            </div>
            <div className="row">
              {activeCatId === cat.id ? (
                <span className="chip accent">연습 중</span>
              ) : (
                <button className="btn sm" onClick={() => setActiveCatId(cat.id)}>
                  이걸로 연습
                </button>
              )}
              <button className="btn sm danger ghost" onClick={() => removeCategory(cat.id)}>
                삭제
              </button>
            </div>
          </div>

          {cat.phrases.map((p) => (
            <div className="phrase-item" key={p.id}>
              <div>
                <div className="p-text">
                  {p.text}
                  {p.note && <span className="target-note" style={{ color: 'var(--faint)', fontWeight: 400 }}> {p.note}</span>}
                </div>
                <div className="p-meaning">{p.meaning}</div>
                {p.explanation && (
                  <div className="p-meaning" style={{ color: 'var(--faint)', marginTop: 3 }}>
                    💡 {p.explanation}
                  </div>
                )}
                {p.example && (
                  <div className="p-meaning" style={{ color: 'var(--faint)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                    📝 {p.example}
                  </div>
                )}
              </div>
              <button className="btn sm ghost danger" onClick={() => removePhrase(cat.id, p.id)}>
                ✕
              </button>
            </div>
          ))}

          <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                className="input"
                placeholder="영어 구문 (예: end up -ing)"
                value={d(cat.id).text}
                onChange={(e) => setD(cat.id, { text: e.target.value })}
                style={{ flex: 2, minWidth: 160 }}
              />
              <input
                className="input"
                placeholder="뜻 (예: 결국 ~하게 되다)"
                value={d(cat.id).meaning}
                onChange={(e) => setD(cat.id, { meaning: e.target.value })}
                style={{ flex: 2, minWidth: 140 }}
              />
            </div>
            <div className="row">
              <input
                className="input"
                placeholder="노트 (선택) 예: (+ 동사원형)"
                value={d(cat.id).note}
                onChange={(e) => setD(cat.id, { note: e.target.value })}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={() => addPhrase(cat.id)}>
                구문 추가
              </button>
            </div>
          </div>
        </div>
      ))}

      {categories.length === 0 && (
        <div className="empty">카테고리를 먼저 추가해 구문을 등록해보세요.</div>
      )}
    </div>
  );
}
