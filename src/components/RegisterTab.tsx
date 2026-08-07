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

  const addCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    const cat: Category = { id: newId(), name, phrases: [] };
    setCategories((prev) => [...prev, cat]);
    setActiveCatId(cat.id);
    setNewCat('');
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
