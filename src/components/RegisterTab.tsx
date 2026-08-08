import { useState } from 'react';
import type { Category, Phrase } from '../types';
import { newId } from '../store';
import { lookupTerm } from '../lib/gemini';

interface Props {
  categories: Category[];
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  selectedCatIds: string[];
  toggleSelected: (id: string) => void;
  addSelected: (id: string) => void;
  addWord: (w: { term: string; english: string; korean: string }) => void;
  apiKey?: string;
  model?: string;
}

export default function RegisterTab({
  categories,
  setCategories,
  selectedCatIds,
  toggleSelected,
  addSelected,
  addWord,
  apiKey,
  model,
}: Props) {
  type Draft = { text: string; meaning: string; explanation: string; example: string };
  const emptyDraft: Draft = { text: '', meaning: '', explanation: '', example: '' };
  const [newCat, setNewCat] = useState('');
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [importName, setImportName] = useState('');
  const [importTargetId, setImportTargetId] = useState<string>('__new__');
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [autoFill, setAutoFill] = useState(true);

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    const cat: Category = { id: newId(), name, phrases: [] };
    setCategories((prev) => [...prev, cat]);
    addSelected(cat.id);
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
    const parsed = parseBlocks(importText);
    if (parsed.length === 0) {
      setImportMsg('가져올 내용이 없어요. "" 안에 배울 구문/단어가 있는지 확인해 주세요.');
      return;
    }
    // 단어(공백 없는 단일 토큰) → 단어장, 구문(여러 단어) → 카테고리
    const isSingleWord = (t: string) => !!t && !/\s/.test(t.trim());
    const wordItems = parsed.filter((p) => isSingleWord(p.text));
    const phraseItems = parsed.filter((p) => !isSingleWord(p.text));

    // 1) 구문 → 카테고리 등록
    let targetId = '';
    let targetName = '';
    if (phraseItems.length) {
      const existing = categories.find((c) => c.id === importTargetId);
      if (importTargetId !== '__new__' && existing) {
        targetId = existing.id;
        targetName = existing.name;
        setCategories((prev) =>
          prev.map((c) => (c.id === targetId ? { ...c, phrases: [...c.phrases, ...phraseItems] } : c)),
        );
      } else {
        const cat: Category = { id: newId(), name: importName.trim() || '가져온 문장', phrases: phraseItems };
        targetId = cat.id;
        targetName = cat.name;
        setCategories((prev) => [...prev, cat]);
      }
      addSelected(targetId);
    }
    setImportText('');
    setImportName('');

    const summary = () => {
      const parts: string[] = [];
      if (phraseItems.length) parts.push(`구문 ${phraseItems.length}개${targetName ? ` → "${targetName}"` : ''}`);
      if (wordItems.length) parts.push(`단어 ${wordItems.length}개 → 단어장`);
      return parts.join(', ');
    };

    setImportBusy(true);
    setImportMsg(`✓ ${summary()} 등록.${autoFill && apiKey ? ' 뜻을 채우는 중…' : ''}`);

    // 2) 단어 → 단어장 등록 (맥락 기반 뜻/영영 풀이)
    for (const w of wordItems) {
      let english = '';
      let korean = w.meaning || '';
      if (autoFill && apiKey) {
        try {
          const r = await lookupTerm(apiKey, w.text, model, w.explanation);
          english = r.english;
          korean = r.korean || korean;
        } catch {
          /* 실패 시 파싱값 사용 */
        }
      }
      addWord({ term: w.text, english, korean });
    }

    // 3) 구문 뜻 자동 채우기 (맥락 기반)
    if (autoFill && apiKey && targetId) {
      for (const p of phraseItems) {
        if (p.meaning) continue;
        try {
          const r = await lookupTerm(apiKey, p.text, model, p.explanation);
          setCategories((prev) =>
            prev.map((c) =>
              c.id === targetId
                ? { ...c, phrases: c.phrases.map((x) => (x.id === p.id ? { ...x, meaning: r.korean } : x)) }
                : c,
            ),
          );
        } catch {
          /* 뜻 자동 채우기 실패는 건너뜀 */
        }
      }
    }

    setImportBusy(false);
    setImportMsg(`✓ ${summary()} 등록 완료.`);
  };

  const addPhrase = (catId: string) => {
    const dd = draft[catId];
    if (!dd || !dd.text.trim()) return;
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? {
              ...c,
              phrases: [
                ...c.phrases,
                {
                  id: newId(),
                  text: dd.text.trim(),
                  meaning: dd.meaning.trim(),
                  ...(dd.explanation.trim() ? { explanation: dd.explanation.trim() } : {}),
                  ...(dd.example.trim() ? { example: dd.example.trim() } : {}),
                },
              ],
            }
          : c,
      ),
    );
    setDraft((prev) => ({ ...prev, [catId]: emptyDraft }));
  };

  const updatePhrase = (catId: string, phraseId: string, patch: Partial<Phrase>) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId
          ? { ...c, phrases: c.phrases.map((p) => (p.id === phraseId ? { ...p, ...patch } : p)) }
          : c,
      ),
    );
  };

  const removePhrase = (catId: string, phraseId: string) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === catId ? { ...c, phrases: c.phrases.filter((p) => p.id !== phraseId) } : c,
      ),
    );
  };

  const toggleCollapse = (catId: string) =>
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));

  const movePhrase = (fromId: string, phraseId: string, toId: string) => {
    if (fromId === toId) return;
    setCategories((prev) => {
      const phrase = prev.find((c) => c.id === fromId)?.phrases.find((p) => p.id === phraseId);
      if (!phrase) return prev;
      return prev.map((c) => {
        if (c.id === fromId) return { ...c, phrases: c.phrases.filter((p) => p.id !== phraseId) };
        if (c.id === toId) return { ...c, phrases: [...c.phrases, phrase] };
        return c;
      });
    });
    setEditingId(null);
  };

  const renameCategory = (catId: string, name: string) => {
    setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, name } : c)));
  };

  const removeCategory = (catId: string) => {
    if (!confirm('이 카테고리와 안의 구문을 모두 삭제할까요?')) return;
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    if (selectedCatIds.includes(catId)) toggleSelected(catId);
  };

  const d = (catId: string): Draft => draft[catId] ?? emptyDraft;
  const setD = (catId: string, patch: Partial<Draft>) =>
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
          전체 = 영어 풀이로 저장돼요. 뜻은 문단 맥락에 맞게 AI가 자동으로 채워줍니다. <b>"" 안이 단어
          한 개</b>면 카테고리 대신 <b>단어장</b>에 등록돼요. 여러 개면 <b>빈 줄</b>로 구분.
        </p>
        <select
          className="select"
          value={importTargetId}
          onChange={(e) => setImportTargetId(e.target.value)}
          style={{ marginBottom: 8 }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} 에 추가
            </option>
          ))}
          <option value="__new__">+ 새 카테고리 만들기</option>
        </select>
        {importTargetId === '__new__' && (
          <input
            className="input"
            placeholder="새 카테고리 이름 (예: 티처조 영어식 사고 100)"
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            style={{ marginBottom: 8 }}
          />
        )}
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cat-title-row">
                <button
                  className={`cat-collapse ${collapsed[cat.id] ? 'collapsed' : ''}`}
                  onClick={() => toggleCollapse(cat.id)}
                  aria-label={collapsed[cat.id] ? '펼치기' : '접기'}
                  aria-expanded={!collapsed[cat.id]}
                  title={collapsed[cat.id] ? '펼치기' : '접기'}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <input
                  className="cat-name-input"
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  placeholder="카테고리 이름"
                  aria-label="카테고리 이름 수정"
                />
              </div>
              <div className="cat-count">{cat.phrases.length}개 구문</div>
            </div>
            <div className="row">
              <button
                className={`btn sm ${selectedCatIds.includes(cat.id) ? 'accent' : ''}`}
                onClick={() => toggleSelected(cat.id)}
                title="대화에서 함께 연습할 카테고리를 여러 개 고를 수 있어요"
              >
                {selectedCatIds.includes(cat.id) ? '✓ 연습 중' : '연습에 추가'}
              </button>
              <button className="btn sm danger ghost" onClick={() => removeCategory(cat.id)}>
                삭제
              </button>
            </div>
          </div>

          {!collapsed[cat.id] && (
            <>
          {cat.phrases.map((p) =>
            editingId === p.id ? (
              // 수정 모드
              <div className="phrase-item edit" key={p.id}>
                <div style={{ flex: 1 }}>
                  <input
                    className="input"
                    placeholder="구문 (배울 표현)"
                    value={p.text}
                    onChange={(e) => updatePhrase(cat.id, p.id, { text: e.target.value })}
                    style={{ marginBottom: 6, fontFamily: 'var(--mono)' }}
                  />
                  <input
                    className="input"
                    placeholder="뜻 (한국어)"
                    value={p.meaning}
                    onChange={(e) => updatePhrase(cat.id, p.id, { meaning: e.target.value })}
                    style={{ marginBottom: 6 }}
                  />
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="영어식 풀이 (선택)"
                    value={p.explanation ?? ''}
                    onChange={(e) => updatePhrase(cat.id, p.id, { explanation: e.target.value })}
                    style={{ marginBottom: 6, resize: 'vertical', fontSize: 13 }}
                  />
                  <input
                    className="input"
                    placeholder="예문 (선택)"
                    value={p.example ?? ''}
                    onChange={(e) => updatePhrase(cat.id, p.id, { example: e.target.value })}
                  />
                  {categories.length > 1 && (
                    <div className="row" style={{ marginTop: 8, gap: 8 }}>
                      <span className="hint" style={{ margin: 0 }}>카테고리 이동:</span>
                      <select
                        className="select"
                        style={{ flex: 1, fontSize: 13 }}
                        value={cat.id}
                        onChange={(e) => movePhrase(cat.id, p.id, e.target.value)}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                    <button className="btn sm ghost danger" onClick={() => removePhrase(cat.id, p.id)}>
                      삭제
                    </button>
                    <button className="btn sm primary" onClick={() => setEditingId(null)}>
                      완료
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // 보기 모드 (일관된 표시)
              <div className="phrase-item" key={p.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="p-text">
                    {p.text}
                    {p.note && (
                      <span style={{ color: 'var(--faint)', fontWeight: 400 }}> {p.note}</span>
                    )}
                  </div>
                  {p.meaning && <div className="p-meaning">{p.meaning}</div>}
                  {p.explanation && (
                    <div className="p-sub">💡 {p.explanation}</div>
                  )}
                  {p.example && (
                    <div className="p-sub" style={{ fontFamily: 'var(--mono)' }}>📝 {p.example}</div>
                  )}
                </div>
                <button
                  className="btn sm ghost"
                  onClick={() => setEditingId(p.id)}
                  title="수정"
                  aria-label="수정"
                >
                  ✏️
                </button>
              </div>
            ),
          )}

          <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
            <div className="section-label" style={{ marginBottom: 8 }}>구문 직접 추가</div>
            <input
              className="input"
              placeholder="구문 (예: end up -ing)"
              value={d(cat.id).text}
              onChange={(e) => setD(cat.id, { text: e.target.value })}
              style={{ marginBottom: 6, fontFamily: 'var(--mono)' }}
            />
            <input
              className="input"
              placeholder="뜻 (예: 결국 ~하게 되다)"
              value={d(cat.id).meaning}
              onChange={(e) => setD(cat.id, { meaning: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <textarea
              className="input"
              rows={2}
              placeholder="영어식 풀이 (선택)"
              value={d(cat.id).explanation}
              onChange={(e) => setD(cat.id, { explanation: e.target.value })}
              style={{ marginBottom: 6, resize: 'vertical', fontSize: 13 }}
            />
            <div className="row">
              <input
                className="input"
                placeholder="예문 (선택)"
                value={d(cat.id).example}
                onChange={(e) => setD(cat.id, { example: e.target.value })}
                style={{ flex: 1 }}
              />
              <button className="btn primary" onClick={() => addPhrase(cat.id)}>
                추가
              </button>
            </div>
          </div>
            </>
          )}
        </div>
      ))}

      {categories.length === 0 && (
        <div className="empty">카테고리를 먼저 추가해 구문을 등록해보세요.</div>
      )}
    </div>
  );
}
