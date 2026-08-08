/**
 * 클라우드 TTS (내 Cloudflare Worker 경유 · Deepgram Aura)
 * 서버에서 음성을 만들어 mp3로 받아 재생 → 아이폰/패드/맥 모두 빠르고 자연스러움.
 */

export interface CloudVoice {
  id: string;
  label: string;
}

// Deepgram Aura 화자
export const CLOUD_VOICES: CloudVoice[] = [
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

export async function synthCloud(
  url: string,
  secret: string,
  text: string,
  speaker = 'asteria',
): Promise<string> {
  if (!url) throw new Error('NO_TTS_URL');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Secret': secret } : {}),
    },
    body: JSON.stringify({ text, speaker }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status}: ${detail}`.slice(0, 200));
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
