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

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  /** 화면에 보여줄 텍스트 (한국어 피드백 등 포함 가능) */
  text: string;
  /** TTS로 읽어줄 영어 문장 (있으면 스피커 버튼 노출) */
  english?: string;
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

export interface Settings {
  apiKey: string;
  voice: string; // Gemini TTS 음성 이름
  autoSpeak: boolean; // AI 응답 자동 재생
}
