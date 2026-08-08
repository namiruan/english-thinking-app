/**
 * 브라우저 내장 음성(Web Speech / SpeechSynthesis) — 무료·무제한 폴백.
 * 클라우드 TTS 한도(429) 등으로 실패할 때 대체 재생용.
 */

export function browserTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let cachedVoice: SpeechSynthesisVoice | null = null;
function pickEnglishVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return (
      voices.find((v) => /en[-_]US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null
    );
  } catch {
    return null;
  }
}

// 음성 목록은 비동기로 로드될 수 있어 미리 캐시 시도
if (browserTtsSupported()) {
  const warm = () => {
    cachedVoice = pickEnglishVoice();
  };
  warm();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', warm);
  } catch {
    /* ignore */
  }
}

/** 브라우저 음성으로 재생. 성공 시 true. onend는 재생이 끝나면 호출. */
export function speakBrowser(text: string, onend?: () => void): boolean {
  if (!browserTtsSupported() || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const v = cachedVoice || (cachedVoice = pickEnglishVoice());
    if (v) u.voice = v;
    u.rate = 0.95;
    if (onend) {
      u.onend = onend;
      u.onerror = onend;
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopBrowser(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}
