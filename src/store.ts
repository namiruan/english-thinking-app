import { useCallback, useEffect, useState } from 'react';
import type { Category, GitHubConfig, HistoryEntry, Settings, WordEntry } from './types';

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

export const defaultGitHub: GitHubConfig = {
  token: '',
  owner: 'namiruan',
  repo: 'english-thinking-app',
  path: 'public/vault.json',
  branch: 'main',
};

export const defaultSettings: Settings = {
  apiKey: (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '',
  chatEngine: 'gemini',
  groqModel: 'openai/gpt-oss-120b',
  model: 'gemini-3.5-flash-lite',
  ttsEngine: 'cloudflare',
  ttsModel: 'aura-1',
  cloudVoice: 'asteria',
  autoSpeak: true,
  github: defaultGitHub,
};

export interface GrammarStat {
  category: string;
  count: number;
  example: string; // 마지막 교정 예시
  date: string; // 마지막 발생 ISO
  notes: Record<string, number>; // 세부 메모별 횟수
}

/** 반복되는 문법 약점 집계 */
export function useGrammarStats() {
  const [grammarStats, setGrammarStats] = useLocalStorage<Record<string, GrammarStat>>(
    'et.grammar',
    {},
  );
  const addGrammar = useCallback(
    (category: string, note: string, example: string) => {
      setGrammarStats((prev) => {
        const cur = prev[category];
        const notes = { ...(cur?.notes ?? {}) };
        if (note) notes[note] = (notes[note] ?? 0) + 1;
        return {
          ...prev,
          [category]: {
            category,
            count: (cur?.count ?? 0) + 1,
            example,
            date: new Date().toISOString(),
            notes,
          },
        };
      });
    },
    [setGrammarStats],
  );
  const clearGrammar = useCallback(() => setGrammarStats({}), [setGrammarStats]);
  return { grammarStats, setGrammarStats, addGrammar, clearGrammar };
}

// ── 학습 진행상황 (자동 저장) ──────────────────────────
export interface PhraseProgress {
  attempts: number; // 시도(집중 모드 답변) 횟수
  clean: number; // 목표 구문을 올바르게 쓴 횟수
}
export interface Progress {
  daily: Record<string, number>; // YYYY-MM-DD -> 그 날 대화 턴 수
  phrases: Record<string, PhraseProgress>; // 구문 텍스트 -> 숙련도
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayKey = () => dayKey(new Date());

export function computeStreak(daily: Record<string, number>): number {
  const d = new Date();
  if (!daily[dayKey(d)]) d.setDate(d.getDate() - 1); // 오늘 아직 안 했으면 어제부터
  let streak = 0;
  while ((daily[dayKey(d)] ?? 0) > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
export function weekCount(daily: Record<string, number>): number {
  const d = new Date();
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += daily[dayKey(d)] ?? 0;
    d.setDate(d.getDate() - 1);
  }
  return sum;
}

export function useProgress() {
  const [progress, setProgress] = useLocalStorage<Progress>('et.progress', { daily: {}, phrases: {} });

  const recordFocusTurn = useCallback(
    (phraseText: string, clean: boolean) => {
      setProgress((prev) => {
        const daily = { ...prev.daily };
        const k = todayKey();
        daily[k] = (daily[k] ?? 0) + 1;
        const phrases = { ...prev.phrases };
        const cur = phrases[phraseText] ?? { attempts: 0, clean: 0 };
        phrases[phraseText] = { attempts: cur.attempts + 1, clean: cur.clean + (clean ? 1 : 0) };
        return { daily, phrases };
      });
    },
    [setProgress],
  );

  const recordFreeTurn = useCallback(() => {
    setProgress((prev) => {
      const daily = { ...prev.daily };
      const k = todayKey();
      daily[k] = (daily[k] ?? 0) + 1;
      return { ...prev, daily };
    });
  }, [setProgress]);

  const clearProgress = useCallback(
    () => setProgress({ daily: {}, phrases: {} }),
    [setProgress],
  );

  return { progress, setProgress, recordFocusTurn, recordFreeTurn, clearProgress };
}

// ── 단어장 ──────────────────────────────────────────────
export function useWordbook() {
  const [words, setWords] = useLocalStorage<Record<string, WordEntry>>('et.wordbook', {});
  const addWord = useCallback(
    (w: Pick<WordEntry, 'term' | 'english' | 'korean' | 'source' | 'sourceLabel'>) => {
      const key = w.term.trim().toLowerCase();
      if (!key) return;
      setWords((prev) => ({
        ...prev,
        [key]: {
          term: w.term.trim(),
          english: w.english,
          korean: w.korean,
          // 출처는 새 값이 있으면 갱신, 없으면 기존 유지
          source: w.source ?? prev[key]?.source,
          sourceLabel: w.sourceLabel ?? prev[key]?.sourceLabel,
          count: (prev[key]?.count ?? 0) + 1,
          date: new Date().toISOString(),
        },
      }));
    },
    [setWords],
  );
  const removeWord = useCallback(
    (term: string) =>
      setWords((prev) => {
        const next = { ...prev };
        delete next[term.trim().toLowerCase()];
        return next;
      }),
    [setWords],
  );
  const clearWords = useCallback(() => setWords({}), [setWords]);
  return { words, setWords, addWord, removeWord, clearWords };
}

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
