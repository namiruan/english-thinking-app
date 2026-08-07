/** base64 → Uint8Array */
export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Gemini TTS는 24kHz, 16-bit, mono PCM(raw)을 반환한다.
 * 브라우저에서 재생하려면 WAV 헤더를 씌워야 한다.
 */
export function pcmToWavBlob(
  pcm: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): Blob {
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);

  return new Blob([buffer], { type: 'audio/wav' });
}

/** 응답의 mimeType(예: "audio/L16;rate=24000")에서 sampleRate 추출 */
export function parseSampleRate(mimeType?: string, fallback = 24000): number {
  if (!mimeType) return fallback;
  const m = mimeType.match(/rate=(\d+)/);
  return m ? parseInt(m[1], 10) : fallback;
}
