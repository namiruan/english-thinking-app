import { useEffect, useMemo, useRef, useState } from 'react';
import { catHue } from '../lib/ui';

interface Item {
  id: string;
  text: string;
  note?: string;
  categoryName?: string;
}

interface Props {
  phrases: Item[];
  value: number; // 선택된 구문의 원본 인덱스
  onChange: (idx: number) => void;
  multiCat: boolean;
}

type Row =
  | { type: 'group'; name: string }
  | { type: 'item'; item: Item; idx: number; pos: number };

export default function PhraseCombobox({ phrases, value, onChange, multiCat }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeElRef = useRef<HTMLButtonElement | null>(null);

  const current = phrases[value];

  // 필터 + (카테고리별) 그룹 행 구성
  const { rows, itemCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = phrases
      .map((p, idx) => ({ p, idx }))
      .filter(
        ({ p }) =>
          !q ||
          p.text.toLowerCase().includes(q) ||
          (p.categoryName?.toLowerCase().includes(q) ?? false),
      );
    const out: Row[] = [];
    let pos = 0;
    let lastCat: string | null = null;
    for (const { p, idx } of filtered) {
      if (multiCat && (p.categoryName ?? '') !== lastCat) {
        lastCat = p.categoryName ?? '';
        out.push({ type: 'group', name: lastCat });
      }
      out.push({ type: 'item', item: p, idx, pos });
      pos++;
    }
    return { rows: out, itemCount: pos };
  }, [phrases, query, multiCat]);

  // 열릴 때 검색창 포커스
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // 필터가 줄면 active 보정
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, itemCount - 1)));
  }, [itemCount]);

  // 하이라이트 항목 화면 안으로
  useEffect(() => {
    activeElRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (idx: number) => {
    onChange(idx);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(itemCount - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows.find((r) => r.type === 'item' && r.pos === active) as
        | Extract<Row, { type: 'item' }>
        | undefined;
      if (row) pick(row.idx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="combo" ref={rootRef}>
      <button
        type="button"
        className="combo-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="연습할 구문 선택 (검색 가능)"
      >
        <span className="combo-current">{current?.text ?? '구문 선택'}</span>
        <span className="combo-caret">▾</span>
      </button>

      {open && (
        <div className="combo-panel" role="listbox">
          <input
            ref={inputRef}
            className="combo-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="구문·카테고리 검색…"
          />
          <div className="combo-list">
            {itemCount === 0 ? (
              <div className="combo-empty">검색 결과가 없어요</div>
            ) : (
              rows.map((r, i) =>
                r.type === 'group' ? (
                  <div
                    key={`g-${i}`}
                    className="combo-group"
                    style={{ ['--h' as string]: catHue(r.name) }}
                  >
                    📁 {r.name}
                  </div>
                ) : (
                  <button
                    key={r.item.id}
                    type="button"
                    ref={r.pos === active ? activeElRef : undefined}
                    className={`combo-item ${r.pos === active ? 'active' : ''} ${
                      r.idx === value ? 'selected' : ''
                    }`}
                    onMouseEnter={() => setActive(r.pos)}
                    onClick={() => pick(r.idx)}
                    role="option"
                    aria-selected={r.idx === value}
                  >
                    <span className="combo-item-text">{r.item.text}</span>
                    {r.idx === value && <span className="combo-check">✓</span>}
                  </button>
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
