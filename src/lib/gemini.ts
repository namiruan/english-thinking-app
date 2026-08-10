import { GoogleGenAI, Type } from '@google/genai';
import type { Phrase } from '../types';
import { base64ToBytes, parseSampleRate, pcmToWavBlob } from './audio';

const CHAT_MODEL = 'gemini-3.5-flash-lite';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// 설정에서 고를 수 있는 대화/사전 모델 (2026 기준)
// 무료 한도: Flash-Lite(15 RPM·하루 ~1,000+) > Flash(10 RPM·하루 250)
export const CHAT_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · 무료 한도 최대 15RPM (권장)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite · 한도 여유 15RPM' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash · 고품질 (한도 적음)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · 고품질 10RPM' },
];

// 대화·사전 엔진 선택
export const CHAT_ENGINES = [
  { id: 'gemini', label: 'Gemini (Google)' },
  { id: 'groq', label: 'Groq · 무료·빠름 (Qwen)' },
];
// Groq 모델 (워커 경유). Llama는 한국어 약함 → Qwen 권장.
export const GROQ_MODELS = [
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B · 한국어 강함 (권장)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B · 고품질' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B · 빠름' },
];

function client(apiKey: string) {
  if (!apiKey) throw new Error('NO_API_KEY');
  return new GoogleGenAI({ apiKey });
}

/** 일시적 과부하(503/500/UNAVAILABLE)면 잠깐 기다렸다 자동 재시도 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retriable = /\b(503|500)\b|UNAVAILABLE|overloaded|high demand|internal error/i.test(msg);
      if (!retriable || attempt === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 700 * Math.pow(2, attempt))); // 0.7s, 1.4s
    }
  }
  throw lastErr;
}

/** 대화 히스토리를 Gemini contents 형식으로 */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

function toContents(turns: Turn[]) {
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

// ── 대화 엔진 (Gemini 또는 Groq · 워커 경유) ──────────────
export interface ChatConfig {
  engine: 'gemini' | 'groq';
  apiKey: string; // Gemini API 키
  model: string; // Gemini 모델 id
  workerUrl?: string; // Groq는 워커 경유 (TTS 워커 재사용)
  secret?: string; // 워커 시크릿(선택)
  groqModel?: string; // Groq 모델 id
}

/** 대화 엔진에 맞게 JSON 응답을 생성 (Gemini responseSchema / Groq json_object) */
async function generateJSON(
  cfg: ChatConfig,
  systemPrompt: string,
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[],
  temperature: number,
  responseSchema: object,
): Promise<Record<string, unknown>> {
  if (cfg.engine === 'groq') {
    if (!cfg.workerUrl) throw new Error('NO_TTS_URL');
    const messages = [
      { role: 'system', content: systemPrompt },
      ...contents.map((c) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts.map((p) => p.text).join('\n'),
      })),
    ];
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.secret ? { 'X-Secret': cfg.secret } : {}) },
      body: JSON.stringify({
        kind: 'chat',
        model: cfg.groqModel || 'qwen/qwen3.6-27b',
        messages,
        temperature,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GROQ ${res.status}: ${detail}`.slice(0, 220));
    }
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '{}';
    return JSON.parse(text) as Record<string, unknown>;
  }
  // Gemini
  const ai = client(cfg.apiKey);
  const res = await withRetry(() =>
    ai.models.generateContent({
      model: cfg.model || CHAT_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema,
        temperature,
      },
    }),
  );
  return JSON.parse(res.text ?? '{}') as Record<string, unknown>;
}

// 번역 원칙 (모든 번역 필드 공통)
const TRANSLATION_RULE =
  'Korean translations must sound NATURAL — convey the meaning the way a Korean speaker would actually say it. Not a stiff word-for-word literal translation, but also faithful with no mistranslation. Write ALL Korean text strictly in Hangul with correct word spacing; NEVER use Chinese characters/Hanja, Japanese kana, Thai/Lao, or any non-Korean script. Every Korean field must be filled (never empty).';

// 문법 오류 분류 (집계를 위해 고정된 라벨만 사용)
export const GRAMMAR_CATEGORIES = [
  '동사 형태 (to부정사/동명사)',
  '시제',
  '수 일치 (주어-동사)',
  '관사 (a/an/the)',
  '단수/복수',
  '가산/불가산 명사',
  '전치사',
  '연어 (collocation)',
  '구동사 (phrasal verb)',
  '어순',
  '대명사',
  '조동사',
  '관계사/접속사',
  '비교 표현',
  '기타 문법',
];

export interface GrammarIssue {
  category: string; // 고정 카테고리
  note: string; // 구체적으로 뭘 틀렸는지 짧은 한국어 메모
}

// ── 집중 모드 (대화형) ──────────────────────────────────────
export interface FocusResult {
  feedback: string; // 한 줄 반응/인사 (첫 턴이면 인사)
  clean: boolean; // 직전 답변에서 목표 구문을 올바르게 썼는지
  corrected: string; // 학습자 답변을 맥락에 맞게 다듬은 영어 (첫 턴이면 "")
  correctedKo: string; // 교정 문장의 뜻 (첫 턴이면 "")
  correctionReason: string; // 왜 그렇게 고쳤는지 한국어 설명 (첫 턴이면 "")
  paraphrases: string[]; // 같은 의도를 더 구어체/요즘 표현으로 바꾼 대안 (첫 턴이면 [])
  grammarIssues: GrammarIssue[]; // 직전 답변의 문법 오류 (오타 제외, 없으면 [])
  question: string; // 영어 질문 (대화체)
  questionKo: string; // 질문의 자연스러운 한국어 번역
  sampleAnswer: string; // 목표 구문을 쓴 예시 영어 답변
  sampleAnswerKo: string; // 예시 답변의 자연스러운 한국어 번역
}

const studyWordsLine = (words: string[]) =>
  words.length
    ? `\n\nThe learner is studying these words/phrases — naturally reuse a few of them in your questions/examples when it fits (helps them review): ${words.join(', ')}.`
    : '';

const focusSystem = (p: Phrase, studyWords: string[]) => `You are a warm, engaging English conversation coach for a Korean learner.
You drill ONE target phrase through NATURAL BACK-AND-FORTH CONVERSATION until the learner can use it automatically.

TARGET PHRASE: "${p.text}"
MEANING (Korean): ${p.meaning}${p.note ? ` ${p.note}` : ''}${p.explanation ? `\nNOTE (how it's used): ${p.explanation}` : ''}

Every turn return JSON:
- "feedback": a very short Korean reaction to the learner's previous answer (e.g. "좋아요!", "거의 다 왔어요"). On the FIRST turn (no answer yet), a one-line friendly Korean greeting.
- "clean": true ONLY if the learner's previous answer used the target phrase correctly and naturally (false on the first turn).
- "corrected": Rewrite the learner's previous answer into the most NATURAL English that expresses what they were trying to say, in this conversation's context (fix awkward wording, grammar, word choice; keep their intent and the target phrase when appropriate). If their answer was already natural, return it lightly polished or unchanged. On the FIRST turn, "".
- "correctedKo": natural Korean meaning of "corrected". On the FIRST turn, "".
- "correctionReason": a short, specific Korean explanation of WHY you rewrote it that way — what sounded off and how the correction better fits the intended meaning/nuance. If it was already natural, say so briefly and note any subtle nuance. On the FIRST turn, "".
- "paraphrases": an array of 2-3 alternative English sentences that express the SAME intent as the learner's answer, but in a MORE COLLOQUIAL / SPOKEN or CURRENT, up-to-date way that native speakers actually say today (casual register, common idioms/phrasings, contractions). Keep each short and natural; make them genuinely different in wording from "corrected" and from each other. English only, no Korean, no labels. Return [] on the FIRST turn or if the answer was a one-word/trivial reply with no meaningful way to rephrase.
- "grammarIssues": an array describing the GRAMMAR errors in the learner's previous answer. Grammar mistakes ONLY — never include spelling/typos or style preferences. Each item is an object: { "category": one exact label from this fixed list — ${GRAMMAR_CATEGORIES.map((c) => `"${c}"`).join(', ')}; "note": a very short Korean sub-label naming the SPECIFIC point (e.g. "현재완료 시제", "a/an 선택", "동사+동명사", "in/on/at 혼동"). } Use "기타 문법" only when nothing else fits, and still give a precise "note". Return [] if there was no grammatical error, or on the FIRST turn.
- "question": a short, natural spoken-English question, like a real friend chatting, that naturally invites the learner to answer USING the target phrase. Vary the topic each turn.
- "questionKo": Korean translation of "question".
- "sampleAnswer": one natural English answer to your question that uses the target phrase — a model the learner could say.
- "sampleAnswerKo": Korean translation of "sampleAnswer".

${TRANSLATION_RULE}
Keep English short and conversational. No markdown, no filler.${studyWordsLine(studyWords)}`;

const focusSchema = {
  type: Type.OBJECT,
  properties: {
    feedback: { type: Type.STRING },
    clean: { type: Type.BOOLEAN },
    corrected: { type: Type.STRING },
    correctedKo: { type: Type.STRING },
    correctionReason: { type: Type.STRING },
    paraphrases: { type: Type.ARRAY, items: { type: Type.STRING } },
    grammarIssues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: GRAMMAR_CATEGORIES },
          note: { type: Type.STRING },
        },
        required: ['category', 'note'],
      },
    },
    question: { type: Type.STRING },
    questionKo: { type: Type.STRING },
    sampleAnswer: { type: Type.STRING },
    sampleAnswerKo: { type: Type.STRING },
  },
  required: [
    'feedback',
    'clean',
    'corrected',
    'correctedKo',
    'correctionReason',
    'paraphrases',
    'grammarIssues',
    'question',
    'questionKo',
    'sampleAnswer',
    'sampleAnswerKo',
  ],
};

export async function focusTurn(
  cfg: ChatConfig,
  phrase: Phrase,
  turns: Turn[],
  studyWords: string[] = [],
): Promise<FocusResult> {
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: '연습을 시작해줘.' }] }]
      : toContents(turns);
  const parsed = (await generateJSON(
    cfg,
    focusSystem(phrase, studyWords),
    contents,
    0.9,
    focusSchema,
  )) as Partial<FocusResult>;
  return {
    feedback: parsed.feedback ?? '',
    clean: Boolean(parsed.clean),
    corrected: parsed.corrected ?? '',
    correctedKo: parsed.correctedKo ?? '',
    correctionReason: parsed.correctionReason ?? '',
    paraphrases: Array.isArray(parsed.paraphrases)
      ? parsed.paraphrases.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [],
    grammarIssues: Array.isArray(parsed.grammarIssues)
      ? parsed.grammarIssues
          .filter((g): g is GrammarIssue => !!g && typeof g.category === 'string')
          .map((g) => ({ category: g.category, note: typeof g.note === 'string' ? g.note : '' }))
      : [],
    question: parsed.question ?? '',
    questionKo: parsed.questionKo ?? '',
    sampleAnswer: parsed.sampleAnswer ?? '',
    sampleAnswerKo: parsed.sampleAnswerKo ?? '',
  };
}

// ── 자유 모드 ────────────────────────────────────────────────
export interface FreeResult {
  reply: string; // 영어 응답
  replyKo: string; // 자연스러운 한국어 번역
  correction: string; // 한국어 교정 (없으면 빈 문자열)
}

const freeSystem = (phrases: Phrase[], studyWords: string[]) => `You are a friendly native English conversation partner for a Korean learner.
Have a light, natural spoken conversation. Naturally create chances for the learner to use these target phrases:
${phrases.map((p) => `- "${p.text}" (${p.meaning})`).join('\n')}${studyWordsLine(studyWords)}

Every turn return JSON:
- "reply": natural, SHORT spoken English (1-3 sentences) that keeps the conversation flowing with a follow-up question.
- "replyKo": Korean translation of "reply".
- "correction": if the learner made a notable mistake, ONE short gentle correction in Korean; otherwise "".

${TRANSLATION_RULE}
No markdown, no long paragraphs.`;

const freeSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    replyKo: { type: Type.STRING },
    correction: { type: Type.STRING },
  },
  required: ['reply', 'replyKo', 'correction'],
};

export async function freeTurn(
  cfg: ChatConfig,
  phrases: Phrase[],
  turns: Turn[],
  studyWords: string[] = [],
): Promise<FreeResult> {
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: "Let's start a casual chat." }] }]
      : toContents(turns);
  const parsed = (await generateJSON(
    cfg,
    freeSystem(phrases, studyWords),
    contents,
    0.9,
    freeSchema,
  )) as Partial<FreeResult>;
  return {
    reply: parsed.reply ?? '',
    replyKo: parsed.replyKo ?? '',
    correction: parsed.correction ?? '',
  };
}

// ── 드래그 사전 조회 ──────────────────────────────────────────
export interface LookupResult {
  term: string;
  partOfSpeech: string; // 품사/유형 (verb, idiom 등)
  english: string; // 영어 풀이
  korean: string; // 한국어 뜻
}

const lookupSchema = {
  type: Type.OBJECT,
  properties: {
    partOfSpeech: { type: Type.STRING },
    english: { type: Type.STRING },
    korean: { type: Type.STRING },
  },
  required: ['partOfSpeech', 'english', 'korean'],
};

export async function lookupTerm(
  cfg: ChatConfig,
  term: string,
  context?: string,
): Promise<LookupResult> {
  const prompt = context
    ? `Define the English term "${term}" AS IT IS USED in the following passage. Rewrite what the passage says about this term into a simpler, easier definition — keep ALL the meaning and usage the passage conveys, just in easier words. Do NOT fall back to the most common or unrelated meaning.\n\nPassage:\n${context}`
    : `Define: "${term}"`;
  const system = `You are a friendly bilingual (English-Korean) dictionary for beginners. For the given English word or phrase/idiom, return JSON:
- "partOfSpeech": short type label (e.g. "verb", "noun", "idiom", "phrasal verb") or "".
- "english": an EASY English definition using simple, everyday words a beginner can understand. Avoid hard or academic vocabulary. IF A PASSAGE/CONTEXT IS GIVEN: your definition MUST preserve the SAME meaning and usage that the passage conveys — including the key nuance (how, where, or when the word is used) — only expressed more simply. Do NOT reduce it to a generic or unrelated sense, and do NOT drop the context's nuance. Use one or two short, plain sentences (enough to keep the full meaning; do not over-shorten).
- "korean": a natural, short Korean meaning that matches this same sense. MUST be filled, written strictly in Hangul (no Chinese characters/Hanja, no Japanese, no other scripts), with correct spacing.
If it's an idiom or multi-word phrase, explain the whole expression in simple words, not individual words.`;
  const p = (await generateJSON(
    cfg,
    system,
    [{ role: 'user', parts: [{ text: prompt }] }],
    0.3,
    lookupSchema,
  )) as Partial<LookupResult>;
  return {
    term,
    partOfSpeech: p.partOfSpeech ?? '',
    english: p.english ?? '',
    korean: p.korean ?? '',
  };
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
  const res = await withRetry(() =>
    ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    }),
  );

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
  if (msg === 'NO_TTS_URL') return '설정에서 클라우드 TTS 서버 주소를 입력해주세요.';
  if (/quota|rate|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    const m = msg.match(/retryDelay["':\s]+(\d+)\s*s/i);
    const secs = m ? parseInt(m[1], 10) : 0;
    if (/per\s*day|perday|daily|requests per day/i.test(msg) || secs > 120)
      return '오늘 이 모델의 무료 일일 한도를 다 썼어요. (미국 태평양시 자정에 초기화) 설정 → "대화·사전 모델"에서 다른 모델로 바꾸면 계속 쓸 수 있어요.';
    return `요청이 잠깐 몰렸어요(분당 한도). ${secs ? `약 ${secs}초 후` : '약 1분 후'} 다시 시도하거나, 설정에서 다른 모델로 바꿔보세요.`;
  }
  if (/API key not valid|401|403|PERMISSION/i.test(msg))
    return 'API 키가 유효하지 않아요. 설정에서 키를 다시 확인해주세요.';
  if (/\b(503|500)\b|UNAVAILABLE|overloaded|high demand|internal error/i.test(msg))
    return 'Gemini 서버에 요청이 몰려 일시적으로 응답하지 못했어요. 잠시 후 다시 시도해주세요.';
  if (/\b404\b|NOT_FOUND|no longer available|is not found|not supported/i.test(msg))
    return '이 모델을 쓸 수 없어요. 설정 → "대화·사전 모델"에서 다른 모델을 고르거나 계정에서 지원하는 모델 ID를 직접 입력해주세요.';
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
