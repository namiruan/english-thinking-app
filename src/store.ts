import { useCallback, useEffect, useState } from 'react';
import type { Category, HistoryEntry, Settings } from './types';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** localStorage 동기화 훅 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장 실패는 무시 */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export const newId = uid;

/** 기본 카테고리/구문 (원본 참고: "입에 척 달라붙는 첫 구문들") */
export const seedCategories: Category[] = [
  {
    id: uid(),
    name: '입에 척 달라붙는 첫 구문들',
    phrases: [
      {
        id: uid(),
        text: 'be starting to like',
        meaning: '~을(를) 점점 좋아하게 되다',
        note: '(+ 동사원형/명사)',
      },
      {
        id: uid(),
        text: 'end up (+ -ing)',
        meaning: '결국 ~하게 되다',
      },
      {
        id: uid(),
        text: 'be supposed to',
        meaning: '~하기로 되어 있다 / ~해야 한다',
      },
    ],
  },
];

export const defaultSettings: Settings = {
  apiKey: (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '',
  voice: 'Kore',
  autoSpeak: true,
};

export function useHistory() {
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('et.history', []);
  const addHistory = useCallback(
    (entry: Omit<HistoryEntry, 'id' | 'date'>) => {
      setHistory((prev) => [{ ...entry, id: uid(), date: new Date().toISOString() }, ...prev].slice(0, 200));
    },
    [setHistory],
  );
  const clearHistory = useCallback(() => setHistory([]), [setHistory]);
  return { history, addHistory, clearHistory };
}
