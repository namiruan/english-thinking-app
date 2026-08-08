/**
 * 브라우저 내장 신경망 TTS (Kokoro-82M, Transformers.js 기반)
 * - 100% 로컬 실행. 최초 1회 모델(~86MB) 다운로드 후 브라우저에 캐시됨.
 * - API 키·서버·한도 없음.
 */

export interface KokoroVoice {
  id: string;
  label: string;
}

// 대표 음성 (a=American, b=British / f=female, m=male)
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: 'af_heart', label: 'Heart · 미국 여성 (추천)' },
  { id: 'af_bella', label: 'Bella · 미국 여성' },
  { id: 'af_nicole', label: 'Nicole · 미국 여성' },
  { id: 'am_michael', label: 'Michael · 미국 남성' },
  { id: 'am_adam', label: 'Adam · 미국 남성' },
  { id: 'bf_emma', label: 'Emma · 영국 여성' },
  { id: 'bm_george', label: 'George · 영국 남성' },
];

const MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';

type Status = 'idle' | 'loading' | 'ready' | 'error';
let status: Status = 'idle';
let ttsPromise: Promise<any> | null = null;

export function kokoroStatus(): Status {
  return status;
}

let usedDevice: 'webgpu' | 'wasm' | null = null;
export function kokoroDevice() {
  return usedDevice;
}

/** 모델 로드(최초 1회 다운로드). WebGPU 가능하면 가속, 아니면 WASM. progress: 0~100 */
export function loadKokoro(onProgress?: (pct: number) => void): Promise<any> {
  if (!ttsPromise) {
    status = 'loading';
    ttsPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const progress_callback = (p: any) => {
        if (onProgress && p && typeof p.progress === 'number') onProgress(Math.round(p.progress));
      };
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      // WebGPU 가속 시도 → 실패하면 WASM으로 폴백 (같은 q8 파일 재사용)
      if (hasGpu) {
        try {
          const t = await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: 'q8',
            device: 'webgpu',
            progress_callback,
          });
          usedDevice = 'webgpu';
          return t;
        } catch {
          /* WebGPU 실패 → WASM */
        }
      }
      const t = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback,
      });
      usedDevice = 'wasm';
      return t;
    })()
      .then((tts) => {
        status = 'ready';
        return tts;
      })
      .catch((e) => {
        status = 'error';
        ttsPromise = null;
        throw e;
      });
  }
  return ttsPromise;
}

/** 텍스트를 음성으로 합성해 재생 가능한 Blob URL 반환 */
export async function synthKokoro(text: string, voice = 'af_heart'): Promise<string> {
  const tts = await loadKokoro();
  const audio = await tts.generate(text, { voice });
  const blob: Blob = audio.toBlob();
  return URL.createObjectURL(blob);
}
