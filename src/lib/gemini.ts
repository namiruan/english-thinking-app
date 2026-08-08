import { GoogleGenAI, Type } from '@google/genai';
import type { Phrase } from '../types';
import { base64ToBytes, parseSampleRate, pcmToWavBlob } from './audio';

const CHAT_MODEL = 'gemini-3.5-flash-lite';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// 설정에서 고를 수 있는 대화/사전 모델 (2026 기준)
export const CHAT_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite · 빠름·한도 여유 (권장)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash · 고품질' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · 대체용' },
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

// 번역 원칙 (모든 번역 필드 공통)
const TRANSLATION_RULE =
  'Korean translations must sound NATURAL — convey the meaning the way a Korean speaker would actually say it. Not a stiff word-for-word literal translation, but also faithful with no mistranslation.';

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
    'grammarIssues',
    'question',
    'questionKo',
    'sampleAnswer',
    'sampleAnswerKo',
  ],
};

export async function focusTurn(
  apiKey: string,
  phrase: Phrase,
  turns: Turn[],
  studyWords: string[] = [],
  model: string = CHAT_MODEL,
): Promise<FocusResult> {
  const ai = client(apiKey);
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: '연습을 시작해줘.' }] }]
      : toContents(turns);

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: focusSystem(phrase, studyWords),
        responseMimeType: 'application/json',
        responseSchema: focusSchema,
        temperature: 0.9,
      },
    }),
  );

  const parsed = JSON.parse(res.text ?? '{}') as Partial<FocusResult>;
  return {
    feedback: parsed.feedback ?? '',
    clean: Boolean(parsed.clean),
    corrected: parsed.corrected ?? '',
    correctedKo: parsed.correctedKo ?? '',
    correctionReason: parsed.correctionReason ?? '',
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
  apiKey: string,
  phrases: Phrase[],
  turns: Turn[],
  studyWords: string[] = [],
  model: string = CHAT_MODEL,
): Promise<FreeResult> {
  const ai = client(apiKey);
  const contents =
    turns.length === 0
      ? [{ role: 'user' as const, parts: [{ text: "Let's start a casual chat." }] }]
      : toContents(turns);

  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: freeSystem(phrases, studyWords),
        responseMimeType: 'application/json',
        responseSchema: freeSchema,
        temperature: 0.9,
      },
    }),
  );
  const parsed = JSON.parse(res.text ?? '{}') as Partial<FreeResult>;
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
  apiKey: string,
  term: string,
  model: string = CHAT_MODEL,
  context?: string,
): Promise<LookupResult> {
  const ai = client(apiKey);
  const prompt = context
    ? `Define the English term "${term}" AS IT IS USED in the following passage. Return the specific sense/meaning that fits THIS usage, not the most common or unrelated meaning.\n\nPassage:\n${context}`
    : `Define: "${term}"`;
  const res = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: `You are a friendly bilingual (English-Korean) dictionary for beginners. For the given English word or phrase/idiom, return JSON:
- "partOfSpeech": short type label (e.g. "verb", "noun", "idiom", "phrasal verb") or "".
- "english": a VERY SIMPLE English definition that a 5-year-old kindergartner could understand. Use only the most basic, common words. One short sentence. NO hard or academic vocabulary. If a simpler everyday word exists, use it.
- "korean": a natural, short Korean meaning.
If a passage/context is given, choose the meaning that matches how the term is used THERE — even if it is not the most common meaning. If it's an idiom or multi-word phrase, explain the whole expression in simple words, not individual words. Keep it short and easy.`,
        responseMimeType: 'application/json',
        responseSchema: lookupSchema,
        temperature: 0.3,
      },
    }),
  );
  const p = JSON.parse(res.text ?? '{}') as Partial<LookupResult>;
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
  if (/quota|rate|RESOURCE_EXHAUSTED|429/i.test(msg))
    return '요청이 너무 많거나 무료 사용량을 초과했어요. 약 1분 후 다시 시도해주세요.';
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
