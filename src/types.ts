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

/** 영어 문장 + 숨김 번역 주석 (누르면 보임) */
export interface TranslatedLine {
  label?: string; // 예: "질문", "예시 답변"
  en: string; // 영어 (TTS 대상)
  ko: string; // 자연스러운 한국어 번역 (숨김)
  collapsible?: boolean; // true면 영어도 클릭해야 보임 (예시 답변)
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  /** 화면에 보여줄 텍스트 (한국어 피드백/일반 텍스트) */
  text: string;
  /** 영어 문장들 + 숨김 번역 (질문/예시 답변 등) */
  lines?: TranslatedLine[];
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

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
}

export interface Settings {
  apiKey: string;
  voice: string; // Gemini TTS 음성 이름
  autoSpeak: boolean; // AI 응답 자동 재생
  github?: GitHubConfig; // 앱에서 GitHub에 바로 저장할 때 사용
}
