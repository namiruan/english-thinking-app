import { useState } from 'react';
import type { Category, Phrase } from '../types';
import { newId } from '../store';

interface Props {
  categories: Category[];
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  activeCatId: string;
  setActiveCatId: (id: string) => void;
}

export default function RegisterTab({
  categories,
  setCategories,
  activeCatId,
  setActiveCatId,
}: Props) {
  const [newCat, setNewCat] = useState('');
  const [draft, setDraft] = useState<Record<string, { text: string; meaning: string; note: string }>>(
    {},
  );
  const [importName, setImportName] = useState('');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    const cat: Category = { id: newId(), name, phrases: [] };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setNewCat('');
  };

  // 붙여넣기 가져오기: 빈 줄로 항목 구분, 항목 안에서 라벨(구문/뜻/풀이/예문)로 분리.
  // 라벨이 없으면 "영어 | 한국어" 한 줄 형식도 지원.
  const importPhrases = () => {
    const blocks = importText
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const phrases: Phrase[] = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
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
          else if (/예문|example/i.test(label)) (example = val), (cur = 'example');
        } else if (cur) {
          // 라벨 이후 이어지는 줄 → 이어붙이기
          if (cur === 'text') text += (text ? '\n' : '') + line;
          else if (cur === 'meaning') meaning += (meaning ? '\n' : '') + line;
          else if (cur === 'explanation') explanation += (explanation ? '\n' : '') + line;
          else example += (example ? '\n' : '') + line;
        } else {
          // 라벨 없음 → "영어 | 뜻" 시도
          const parts = line.split(/\s*[|\t]\s*/);
          if (!text) {
            text = (parts[0] || '').trim();
            if (parts[1]) meaning = parts[1].trim();
          }
        }
      }
      if (text) {
        phrases.push({
          id: newId(),
          text,
          meaning,
          ...(explanation ? { explanation } : {}),
          ...(example ? { example } : {}),
        });
      }
    }

    if (phrases.length === 0) {
      setImportMsg('가져올 문장이 없어요. 아래 형식을 확인해 주세요.');
      return;
    }
    const cat: Category = { id: newId(), name: importName.trim() || '가져온 문장', phrases };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setImportText('');
    setImportName('');
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
          항목마다 <b>빈 줄</b>로 구분하고, 각 항목 안에 라벨을 붙여 넣으세요. <code>구문</code>은
          필수, <code>풀이·예문</code>은 선택. (간단히 <code>영어 | 뜻</code> 한 줄도 가능)
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
            '구문: ...\n뜻: ...\n풀이: ...\n예문: ...\n\n구문: ...\n뜻: ...\n\n(또는)\nEnglish sentence | 한국어 뜻'
          }
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12.5 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={importPhrases}>
            가져오기
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
