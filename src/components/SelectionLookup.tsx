import { useEffect, useState } from 'react';
import { friendlyError, lookupTerm, type LookupResult } from '../lib/gemini';
import type { WordEntry } from '../types';

interface Props {
  apiKey: string;
  model: string;
  onAdd: (w: Pick<WordEntry, 'term' | 'english' | 'korean' | 'source' | 'sourceLabel'>) => void;
}

interface Anchor {
  term: string;
  x: number;
  y: number;
}

export default function SelectionLookup({ apiKey, model, onAdd }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  // 텍스트 선택 감지
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest?.('.lookup-popup')) return; // 팝업 내부 클릭 무시
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      // 영어가 포함된 짧은 선택만
      if (!text || text.length > 60 || !/[a-zA-Z]/.test(text) || !sel || sel.rangeCount === 0) {
        setAnchor(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      setAnchor({ term: text, x: rect.left + rect.width / 2, y: rect.bottom });
      setResult(null);
      setError('');
      setAdded(false);
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // 조회
  useEffect(() => {
    if (!anchor) return;
    if (!apiKey) {
      setError('설정에서 Gemini API 키를 먼저 입력해주세요.');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    lookupTerm(apiKey, anchor.term, model)
      .then((r) => alive && (setResult(r), setLoading(false)))
      .catch((e) => alive && (setError(friendlyError(e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [anchor, apiKey, model]);

  if (!anchor) return null;

  const left = Math.min(Math.max(12, anchor.x - 150), window.innerWidth - 312);
  const top = Math.min(anchor.y + 8, window.innerHeight - 240);

  return (
    <div className="lookup-popup" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="lookup-close" onClick={() => setAnchor(null)} title="닫기">
        ✕
      </button>
      <div className="lookup-term">{anchor.term}</div>
      {loading && (
        <div className="lookup-loading">
          <span className="spinner" /> 찾는 중…
        </div>
      )}
      {error && <div className="lookup-error">{error}</div>}
      {result && (
        <>
          {result.partOfSpeech && <div className="lookup-pos">{result.partOfSpeech}</div>}
          <div className="lookup-en">{result.english}</div>
          <div className="lookup-ko">{result.korean}</div>
          <button
            className="btn sm primary"
            style={{ marginTop: 10 }}
            disabled={added}
            onClick={() => {
              onAdd({
                term: anchor.term,
                english: result.english,
                korean: result.korean,
                source: 'chat',
                sourceLabel: '대화',
              });
              setAdded(true);
            }}
          >
            {added ? '✓ 단어장에 추가됨' : '📖 단어장에 추가'}
          </button>
        </>
      )}
    </div>
  );
}
