export interface Phrase {
  id: string;
  text: string; // 예: "be starting to like"
  meaning: string; // 한국어 뜻
  note?: string; // 사용 노트, 예: "(+ 동사원형도 가능)"
}

export interface Category {
  id: string;
  name: string;
  phrases: Phrase[];
}

export type Mode = 'focus' | 'free';

/** 영어 문장 + 숨김 번역 주석 (누르면 보임) — 자유 모드 응답 */
export interface TranslatedLine {
  label?: string;
  en: string; // 영어 (TTS 대상)
  ko: string; // 자연스러운 한국어 번역 (숨김)
}

/** 내 답변 교정 */
export interface Correction {
  corrected: string; // 맥락에 맞게 다듬은 자연스러운 영어 문장
  correctedKo: string; // 그 문장의 뜻
  reason: string; // 왜 그렇게 고쳤는지 (한국어)
}

/** 집중 모드 질문: 질문 + (숨김) 번역 + (숨김) 예시 답변 */
export interface FocusBlock {
  question: string;
  questionKo: string;
  sampleAnswer: string;
  sampleAnswerKo: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  /** 화면에 보여줄 텍스트 (한국어 피드백/일반 텍스트) */
  text: string;
  /** 집중 모드 질문 블록 (모델 메시지) */
  focus?: FocusBlock;
  /** 자유 모드 응답 라인 (모델 메시지) */
  lines?: TranslatedLine[];
  /** 내 답변에 대한 교정 (사용자 메시지에 부착) */
  correction?: Correction;
  /** 집중 모드에서 목표 구문을 올바르게 썼는지 */
  clean?: boolean;
}

export interface HistoryEntry {
  id: string;
  phraseText: string;
  categoryName: string;
  mode: Mode;
  cleanCount: number;
  turns: number;
  date: string; // ISO
}

export interface WordEntry {
  term: string; // 단어/숙어
  english: string; // 영어 풀이
  korean: string; // 한국어 뜻
  count: number; // 저장/노출 횟수
  date: string; // 마지막 ISO
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
}

export interface Settings {
  apiKey: string;
  model?: string; // 대화/사전 모델 (기본 gemini-2.5-flash)
  voiceEngine?: 'gemini' | 'browser'; // 음성 엔진 (기본 gemini)
  voice: string; // Gemini TTS 음성 이름
  autoSpeak: boolean; // AI 응답 자동 재생
  github?: GitHubConfig; // 앱에서 GitHub에 바로 저장할 때 사용
}
