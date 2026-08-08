import { useState } from 'react';
import type { Category } from '../types';
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

  // 붙여넣기 가져오기: "영어 | 한국어 뜻" (또는 탭) 한 줄씩
  const importPhrases = () => {
    const lines = importText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const phrases = lines
      .map((line) => {
        const parts = line.split(/\s*[|\t]\s*/);
        const text = (parts[0] || '').trim();
        const meaning = (parts[1] || '').trim();
        return text ? { id: newId(), text, meaning } : null;
      })
      .filter((p): p is { id: string; text: string; meaning: string } => !!p);
    if (phrases.length === 0) {
      setImportMsg('가져올 문장이 없어요. "영어 | 한국어" 형식으로 붙여넣어 주세요.');
      return;
    }
    const cat: Category = { id: newId(), name: importName.trim() || '가져온 문장', phrases };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setImportText('');
    setImportName('');
    setImportMsg(`✓ ${phrases.length}개 문장을 "${cat.name}" 카테고리로 등록했어요.`);
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
          문장을 한 줄에 하나씩, <code>영어 | 한국어 뜻</code> 형식으로 붙여넣으세요. (이 기기에만
          저장 · 비공개로 하려면 설정에서 암호화 저장)
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
          rows={5}
          placeholder={'I have no idea. | 전혀 모르겠어.\nIt is what it is. | 어쩔 수 없지.'}
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
