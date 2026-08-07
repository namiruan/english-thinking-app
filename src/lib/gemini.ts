import { GoogleGenAI, Type } from '@google/genai';
import type { Phrase } from '../types';
import { base64ToBytes, parseSampleRate, pcmToWavBlob } from './audio';

const CHAT_MODEL = 'gemini-2.5-flash';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

function client(apiKey: string) {
  if (!apiKey) throw new Error('NO_API_KEY');
  return new GoogleGenAI({ apiKey });
}

/** 대화 히스토리를 Gemini contents 형식으로 */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

function toContents(turns: Turn[]) {
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

// ── 집중 모드 ────────────────────────────────────────────────
export interface FocusResult {
  feedback: string; // 한국어 피드백 (첫 턴이면 인사)
  modelSentence: string; // 목표 구문을 쓴 자연스러운 영어 예문
  situation: string; // 다음에 학습자가 답할 한국어 상황
  clean: boolean; // 직전 답변에서 목표 구문을 올바르게 썼는지
}

const focusSystem = (p: Phrase) => `You are a warm, concise English speaking coach for a Korean learner.
The learner is drilling ONE target phrase until it feels automatic.

TARGET PHRASE: "${p.text}"
MEANING (Korean): ${p.meaning}${p.note ? ` ${p.note}` : ''}

Each turn you MUST return JSON with these fields:
- "feedback": short Korean feedback on the learner's previous answer (praise + one fix if needed). On the very first turn (no answer yet) write a one-line Korean greeting instead.
- "modelSentence": ONE short, natural spoken-English sentence that uses the TARGET PHRASE correctly. Vary it every turn.
- "situation": a short Korean situation prompt (1 sentence) telling the learner what to say next, so they can reply in English using the target phrase.
- "clean": true only if the learner's previous answer used the target phrase correctly and naturally; false otherwise (false on the first turn).

Rules: keep everything short, no filler, no markdown. Only the target phrase drilling — no unrelated chit-chat.`;

const focusSchema = {
  type: Type.OBJECT,
  properties: {
    feedback: { type: Type.STRING },
    modelSentence: { type: Type.STRING },
    situation: { type: Type.STRING },
    clean: { type: Type.BOOLEAN },
  },
  required: ['feedback', 'modelSentence', 'situation', 'clean'],
};

export async function focusTurn(
  apiKey: string,
  phrase: Phrase,
  turns: Turn[],
): Promise<FocusResult> {
  const ai = client(apiKey);
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: '연습을 시작해줘.' }] }]
      : toContents(turns);

  const res = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: focusSystem(phrase),
      responseMimeType: 'application/json',
      responseSchema: focusSchema,
      temperature: 0.9,
    },
  });

  const parsed = JSON.parse(res.text ?? '{}') as Partial<FocusResult>;
  return {
    feedback: parsed.feedback ?? '',
    modelSentence: parsed.modelSentence ?? '',
    situation: parsed.situation ?? '',
    clean: Boolean(parsed.clean),
  };
}

// ── 자유 모드 ────────────────────────────────────────────────
const freeSystem = (phrases: Phrase[]) => `You are a friendly native English conversation partner for a Korean learner.
Have a light, natural spoken conversation. Naturally create chances for the learner to use these target phrases:
${phrases.map((p) => `- "${p.text}" (${p.meaning})`).join('\n')}

Rules:
- Reply in natural, SHORT spoken English (1-3 sentences).
- If the learner makes a notable mistake, add ONE short gentle correction on a new line prefixed with "💡".
- Keep the conversation flowing with a follow-up question.
- No markdown headers, no long paragraphs.`;

export async function freeTurn(
  apiKey: string,
  phrases: Phrase[],
  turns: Turn[],
): Promise<string> {
  const ai = client(apiKey);
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: "Let's start a casual chat." }] }]
      : toContents(turns);

  const res = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents,
    config: {
      systemInstruction: freeSystem(phrases),
      temperature: 0.9,
    },
  });
  return (res.text ?? '').trim();
}

// ── 사전 / 뜻 보기 ────────────────────────────────────────────
export async function explainPhrase(apiKey: string, phrase: Phrase): Promise<string> {
  const ai = client(apiKey);
  const res = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `영어 구문 "${phrase.text}" (뜻: ${phrase.meaning})을 한국어로 간단히 설명해줘. 뉘앙스 1줄 + 자연스러운 예문 2개(영어와 한국어 번역). 마크다운 헤더 쓰지 말고 짧게.`,
          },
        ],
      },
    ],
    config: { temperature: 0.6 },
  });
  return (res.text ?? '').trim();
}

// ── Native TTS ───────────────────────────────────────────────
/** 영어 문장을 Gemini Native TTS로 합성해 재생 가능한 WAV Blob URL 반환 */
export async function synthesizeSpeech(
  apiKey: string,
  text: string,
  voice = 'Kore',
): Promise<string> {
  const ai = client(apiKey);
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  });

  const part = res.candidates?.[0]?.content?.parts?.[0];
  const data = part?.inlineData?.data;
  if (!data) throw new Error('NO_AUDIO');
  const sampleRate = parseSampleRate(part?.inlineData?.mimeType);
  const blob = pcmToWavBlob(base64ToBytes(data), sampleRate);
  return URL.createObjectURL(blob);
}

/** 사용자 친화적 에러 메시지 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'NO_API_KEY') return 'API 키가 없어요. 우측 상단 "설정"에서 Gemini API 키를 입력해주세요.';
  if (/quota|rate|RESOURCE_EXHAUSTED|429/i.test(msg))
    return '요청이 너무 많거나 무료 사용량을 초과했어요. 약 1분 후 다시 시도해주세요.';
  if (/API key not valid|401|403|PERMISSION/i.test(msg))
    return 'API 키가 유효하지 않아요. 설정에서 키를 다시 확인해주세요.';
  return `오류가 발생했어요: ${msg}`;
}

export const TTS_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
  'Zephyr',
];
