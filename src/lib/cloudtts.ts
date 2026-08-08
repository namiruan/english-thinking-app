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

/** 오디오 바이트를 받아온다. 오디오가 아니거나 비어있으면(한도/서버오류 등) 명확한 에러. */
async function fetchTtsBytes(
  url: string,
  secret: string,
  text: string,
  speaker: string,
  model: string,
): Promise<ArrayBuffer> {
  if (!url) throw new Error('NO_TTS_URL');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Secret': secret } : {}),
    },
    body: JSON.stringify({ text, speaker, model }),
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status}: ${detail}`.slice(0, 200));
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
): Promise<string> {
  const buf = await fetchTtsBytes(url, secret, text, speaker, model);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
}

/** Web Audio 재생용 원시 오디오 바이트 (자동재생 정책에 강함) */
export async function synthCloudBuffer(
  url: string,
  secret: string,
  text: string,
  speaker = 'asteria',
  model = 'aura-1',
): Promise<ArrayBuffer> {
  return await fetchTtsBytes(url, secret, text, speaker, model);
}
