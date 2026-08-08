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

// ── 브라우저 내장 음성 합성 (무료·무제한) ──────────────
export const isSpeechSynthesisSupported = () => 'speechSynthesis' in window;

// 고품질 목소리로 추정되는 이름 힌트
const QUALITY_HINTS = [
  'natural',
  'neural',
  'enhanced',
  'premium',
  'google',
  'siri',
  'ava',
  'samantha',
  'aria',
  'jenny',
  'libby',
  'serena',
];

function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  const lang = v.lang.toLowerCase();
  let s = 0;
  if (QUALITY_HINTS.some((h) => n.includes(h))) s += 3;
  if (lang.startsWith('en-us')) s += 2;
  else if (lang.startsWith('en')) s += 1;
  if (!v.localService) s += 1; // 클라우드 음성(구글 등)이 대체로 자연스러움
  return s;
}

/** 사용 가능한 영어 음성 (품질 추정 높은 순) */
export function listEnglishVoices(): SpeechSynthesisVoice[] {
  const synth = window.speechSynthesis;
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

/** 음성 목록이 늦게 로드되는 브라우저 대응 */
export function onVoicesChanged(cb: () => void): () => void {
  const synth = window.speechSynthesis;
  if (!synth) return () => {};
  const handler = () => cb();
  synth.addEventListener('voiceschanged', handler);
  return () => synth.removeEventListener('voiceschanged', handler);
}

/** 브라우저 TTS로 재생. onEnd는 끝나거나 실패 시 호출. */
export function speakBrowser(
  text: string,
  onEnd: () => void,
  opts: { voiceName?: string; lang?: string } = {},
) {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd();
    return;
  }
  synth.cancel();
  const voices = listEnglishVoices();
  const chosen =
    (opts.voiceName && voices.find((v) => v.name === opts.voiceName)) || voices[0] || undefined;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = chosen?.lang || opts.lang || 'en-US';
  if (chosen) u.voice = chosen;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
}

export function cancelBrowserSpeech() {
  window.speechSynthesis?.cancel();
}
