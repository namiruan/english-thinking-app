/** 브라우저 내장 음성 인식(Web Speech API) 래퍼 — 무료, 키 불필요 */

// 브라우저 타입 보강
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const isSpeechRecognitionSupported = () => getRecognitionCtor() !== null;

export interface Recognizer {
  stop: () => void;
}

/**
 * 마이크 입력을 시작한다.
 * @returns 중지 함수 (지원 안 되면 null)
 */
export function startRecognition(
  onText: (text: string, isFinal: boolean) => void,
  onEnd: () => void,
  lang = 'en-US',
): Recognizer | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;

  rec.onresult = (e: any) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) onText(final, true);
    else if (interim) onText(interim, false);
  };
  rec.onerror = () => onEnd();
  rec.onend = () => onEnd();

  rec.start();
  return { stop: () => rec.stop() };
}
