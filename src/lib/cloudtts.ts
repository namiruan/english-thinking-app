/**
 * 클라우드 TTS (내 Cloudflare Worker 경유 · Deepgram Aura)
 * 서버에서 음성을 만들어 mp3로 받아 재생 → 아이폰/패드/맥 모두 빠르고 자연스러움.
 */

export interface CloudVoice {
  id: string;
  label: string;
}

// Aura-1 화자
export const AURA1_VOICES: CloudVoice[] = [
  { id: 'asteria', label: 'Asteria · 여성 (미국, 추천)' },
  { id: 'luna', label: 'Luna · 여성' },
  { id: 'stella', label: 'Stella · 여성' },
  { id: 'athena', label: 'Athena · 여성 (영국)' },
  { id: 'hera', label: 'Hera · 여성' },
  { id: 'orion', label: 'Orion · 남성' },
  { id: 'arcas', label: 'Arcas · 남성' },
  { id: 'perseus', label: 'Perseus · 남성' },
  { id: 'zeus', label: 'Zeus · 남성' },
  { id: 'angus', label: 'Angus · 남성 (아일랜드)' },
];

// Aura-2 화자 (일부 · 미리듣기로 골라보세요)
export const AURA2_VOICES: CloudVoice[] = [
  { id: 'luna', label: 'Luna (기본)' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'andromeda', label: 'Andromeda' },
  { id: 'athena', label: 'Athena' },
  { id: 'hera', label: 'Hera' },
  { id: 'ophelia', label: 'Ophelia' },
  { id: 'iris', label: 'Iris' },
  { id: 'apollo', label: 'Apollo' },
  { id: 'orion', label: 'Orion' },
  { id: 'zeus', label: 'Zeus' },
  { id: 'mars', label: 'Mars' },
  { id: 'atlas', label: 'Atlas' },
];

// ── 무료 한도(하루 10k neuron) 소진 상태 (UTC 기준, 다음날 리셋) ──
const QUOTA_KEY = 'et.ttsQuotaHitUTC';
const utcDay = () => new Date().toISOString().slice(0, 10);

/** 에러가 무료 한도 초과(429)인지 */
export function isQuotaError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return m.includes('429') || m.includes('neuron') || m.includes('allocation');
}
/** 오늘 한도 소진으로 표시 (엔진별) */
export function markQuotaHit(engine: TtsEngine = 'cloudflare'): void {
  try {
    localStorage.setItem(QUOTA_KEY, `${utcDay()}|${engine}`);
  } catch {
    /* ignore */
  }
}
/** 오늘(UTC) 해당 엔진 한도가 잠겨있는지 */
export function isQuotaLocked(engine: TtsEngine = 'cloudflare'): boolean {
  try {
    return localStorage.getItem(QUOTA_KEY) === `${utcDay()}|${engine}`;
  } catch {
    return false;
  }
}

export function voicesForModel(model?: string): CloudVoice[] {
  return model === 'aura-2-en' ? AURA2_VOICES : AURA1_VOICES;
}
export function defaultVoiceForModel(model?: string): string {
  return model === 'aura-2-en' ? 'luna' : 'asteria';
}

export const CLOUD_MODELS = [
  { id: 'aura-1', label: 'Aura-1 · 자연스러움 (음성 선택 가능)' },
  { id: 'aura-2-en', label: 'Aura-2 · 더 표현력 좋음 (최신)' },
];

// ── 엔진 & Google Cloud TTS 음성 ──────────────────────────
export type TtsEngine = 'cloudflare' | 'google';
export const TTS_ENGINES: { id: TtsEngine; label: string }[] = [
  { id: 'cloudflare', label: 'Cloudflare · 하루 1만 (기본)' },
  { id: 'google', label: 'Google Cloud · 매월 100만 자 무료' },
];

// Google Cloud TTS Neural2 음성 (매월 100만 자 무료 티어)
export const GOOGLE_VOICES: CloudVoice[] = [
  { id: 'en-US-Neural2-F', label: 'US 여성 F (추천)' },
  { id: 'en-US-Neural2-C', label: 'US 여성 C' },
  { id: 'en-US-Neural2-E', label: 'US 여성 E' },
  { id: 'en-US-Neural2-H', label: 'US 여성 H' },
  { id: 'en-US-Neural2-A', label: 'US 남성 A' },
  { id: 'en-US-Neural2-D', label: 'US 남성 D' },
  { id: 'en-US-Neural2-I', label: 'US 남성 I' },
  { id: 'en-US-Neural2-J', label: 'US 남성 J' },
  { id: 'en-GB-Neural2-A', label: 'UK 여성 A' },
  { id: 'en-GB-Neural2-B', label: 'UK 남성 B' },
];

export function voicesForEngine(engine?: TtsEngine, model?: string): CloudVoice[] {
  return engine === 'google' ? GOOGLE_VOICES : voicesForModel(model);
}
export function defaultVoiceForEngine(engine?: TtsEngine, model?: string): string {
  return engine === 'google' ? 'en-US-Neural2-F' : defaultVoiceForModel(model);
}

/** 오디오 바이트를 받아온다. 오디오가 아니거나 비어있으면(한도/서버오류 등) 명확한 에러. */
async function fetchTtsBytes(
  url: string,
  secret: string,
  text: string,
  speaker: string,
  model: string,
  engine: TtsEngine = 'cloudflare',
): Promise<ArrayBuffer> {
  if (!url) throw new Error('NO_TTS_URL');
  const payload =
    engine === 'google'
      ? { provider: 'google', text, voice: speaker }
      : { provider: 'cloudflare', text, speaker, model };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Secret': secret } : {}),
    },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status}: ${detail}`.slice(0, 320));
  }
  const buf = await res.arrayBuffer();
  // 서버가 200이지만 오디오가 아닌 경우(빈 응답/에러 JSON/한도 초과 메시지 등) 감지
  const looksAudio = /audio|mpeg|mp3|octet-stream/i.test(ct);
  if (buf.byteLength < 512 || (ct && !looksAudio)) {
    let body = '';
    try {
      body = new TextDecoder().decode(buf).trim();
    } catch {
      /* ignore */
    }
    const hint = body ? `: ${body.slice(0, 140)}` : ` (${buf.byteLength}바이트${ct ? `, ${ct}` : ''})`;
    throw new Error(`음성 서버가 오디오를 반환하지 않았어요${hint}`);
  }
  return buf;
}

/** 재생용 blob URL (레거시/폴백) */
export async function synthCloud(
  url: string,
  secret: string,
  text: string,
  speaker = 'asteria',
  model = 'aura-1',
  engine: TtsEngine = 'cloudflare',
): Promise<string> {
  const buf = await fetchTtsBytes(url, secret, text, speaker, model, engine);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
}

/** Web Audio 재생용 원시 오디오 바이트 (자동재생 정책에 강함) */
export async function synthCloudBuffer(
  url: string,
  secret: string,
  text: string,
  speaker = 'asteria',
  model = 'aura-1',
  engine: TtsEngine = 'cloudflare',
): Promise<ArrayBuffer> {
  return await fetchTtsBytes(url, secret, text, speaker, model, engine);
}
