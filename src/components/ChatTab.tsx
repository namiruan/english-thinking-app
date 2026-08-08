import { useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  Correction,
  FocusBlock,
  Mode,
  Phrase,
  Settings,
  TranslatedLine,
} from '../types';
import { newId } from '../store';
import { focusTurn, freeTurn, friendlyError, type Turn } from '../lib/gemini';
import { synthCloud } from '../lib/cloudtts';
import { isSpeechRecognitionSupported, startRecognition, type Recognizer } from '../lib/speech';

interface Props {
  phrases: Phrase[];
  poolLabel: string;
  poolKey: string;
  settings: Settings;
  recordFocusTurn: (phraseText: string, clean: boolean) => void;
  recordFreeTurn: () => void;
  addGrammar: (category: string, note: string, example: string) => void;
  studyWords: string[];
  openSettings: () => void;
}

const CLEAN_GOAL = 3;

// ── 자유 모드 응답: 영어 + 숨김 번역 ──────────────────
function LineView({
  line,
  speaking,
  onSpeak,
  disabled,
}: {
  line: TranslatedLine;
  speaking: boolean;
  onSpeak: () => void;
  disabled: boolean;
}) {
  const [showKo, setShowKo] = useState(false);
  return (
    <div className="tline">
      <div className="tline-en">
        <button className="speak" onClick={onSpeak} disabled={disabled} title="원어민 음성으로 듣기">
          {speaking ? '⏸' : '🔊'}
        </button>
        <span className="tline-text">{line.en}</span>
      </div>
      <div className="tline-ko-wrap">
        <button className="tline-toggle" onClick={() => setShowKo((s) => !s)}>
          {showKo ? '번역 숨기기' : '번역 보기'}
        </button>
        {showKo && <div className="tline-ko">{line.ko}</div>}
      </div>
    </div>
  );
}

// 원문 대비 교정 문장에서 바뀐/추가된 단어를 표시 (LCS 단어 diff)
function highlightChanges(original: string, corrected: string): { text: string; changed: boolean }[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const A = original.trim().split(/\s+/).filter(Boolean).map(norm);
  const B = corrected.trim().split(/\s+/).filter(Boolean);
  const Bn = B.map(norm);
  const n = A.length;
  const m = B.length;
  if (!n) return B.map((text) => ({ text, changed: true }));

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === Bn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === Bn[j]) {
      matched[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return B.map((text, idx) => ({ text, changed: !matched[idx] }));
}

// 스피커 버튼 (공용)
function speakButton(
  text: string,
  id: string,
  speakingId: string | null,
  onSpeak: (t: string, i: string) => void,
  onStop: () => void,
  disabled: boolean,
  cls = 'speak',
) {
  return (
    <button
      className={cls}
      onClick={() => (speakingId === id ? onStop() : onSpeak(text, id))}
      disabled={disabled}
      title="원어민 음성으로 듣기"
    >
      {speakingId === id ? '⏸' : '🔊'}
    </button>
  );
}

// ── 내 답변 교정 카드 (질문 말풍선과 분리) ──
function CorrectionCard({
  c,
  original,
  msgId,
  speakingId,
  onSpeak,
  onStop,
  disabled,
}: {
  c: Correction;
  original: string;
  msgId: string;
  speakingId: string | null;
  onSpeak: (t: string, i: string) => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const [showKo, setShowKo] = useState(false);
  const parts = highlightChanges(original, c.corrected);
  return (
    <div className="correction-card">
      <div className="tline-en">
        {speakButton(c.corrected, `${msgId}:c`, speakingId, onSpeak, onStop, disabled)}
        <span className="tline-text">
          <span className="tline-tag correct">교정</span>
          {parts.map((p, i) => (
            <span key={i} className={p.changed ? 'chg' : undefined}>
              {p.text}
              {i < parts.length - 1 ? ' ' : ''}
            </span>
          ))}
        </span>
      </div>
      <div className="tline-ko-wrap">
        <button className="tline-toggle" onClick={() => setShowKo((s) => !s)}>
          {showKo ? '뜻 숨기기' : '뜻 보기'}
        </button>
        {showKo && <div className="tline-ko">{c.correctedKo}</div>}
      </div>
      <div className="correction-reason">💡 {c.reason}</div>
    </div>
  );
}

// ── 집중 모드 질문 말풍선 (항상 동일한 레이아웃) ──
function FocusView({
  focus,
  msgId,
  speakingId,
  onSpeak,
  onStop,
  disabled,
}: {
  focus: FocusBlock;
  msgId: string;
  speakingId: string | null;
  onSpeak: (text: string, id: string) => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const [showKo, setShowKo] = useState(false);
  const [showEx, setShowEx] = useState(false);

  return (
    <div className="tline">
      <div className="tline-en">
        {speakButton(focus.question, `${msgId}:q`, speakingId, onSpeak, onStop, disabled)}
        <span className="tline-text">{focus.question}</span>
      </div>
      <div className="tline-ko-wrap">
        <div className="tline-actions">
          <button className="tline-toggle" onClick={() => setShowKo((s) => !s)}>
            {showKo ? '번역 숨기기' : '번역 보기'}
          </button>
          <button className="tline-toggle" onClick={() => setShowEx((s) => !s)}>
            {showEx ? '예시 답변 숨기기' : '예시 답변 보기'}
          </button>
        </div>
        {showKo && <div className="tline-ko">{focus.questionKo}</div>}
        {showEx && (
          <div className="tline-ko tline-ex">
            <div className="tline-ex-en">
              {speakButton(
                focus.sampleAnswer,
                `${msgId}:a`,
                speakingId,
                onSpeak,
                onStop,
                disabled,
                'speak mini',
              )}
              <span>{focus.sampleAnswer}</span>
            </div>
            <div className="tline-ex-ko">{focus.sampleAnswerKo}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatTab({
  phrases,
  poolLabel,
  poolKey,
  settings,
  recordFocusTurn,
  recordFreeTurn,
  addGrammar,
  studyWords,
  openSettings,
}: Props) {
  const [mode, setMode] = useState<Mode>('focus');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [focusCount, setFocusCount] = useState(0);
  const [freeCount, setFreeCount] = useState(0);
  const [cleanCount, setCleanCount] = useState(0);

  const recRef = useRef<Recognizer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioPrimedRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);

  const phrase: Phrase | undefined = phrases[phraseIdx];
  const model = settings.model?.trim() || 'gemini-3.5-flash-lite';

  const resetSession = () => {
    // 진행상황은 매 턴 자동 저장되므로 여기선 현재 대화만 초기화
    setMessages([]);
    turnsRef.current = [];
    setFocusCount(0);
    setFreeCount(0);
    setCleanCount(0);
    stopSpeaking();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phraseIdx >= phrases.length && phrases.length > 0) setPhraseIdx(0);
  }, [phrases.length, phraseIdx]);

  useEffect(() => resetSession(), [poolKey, mode, phraseIdx]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // 음성 설정이 바뀌면 재생 상태 초기화 (토글 꼬임 방지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.cloudVoice, settings.ttsModel]);

  // 진행 중인 세션이 있으면 페이지 이탈(새로고침/닫기) 시 경고
  useEffect(() => {
    if (messages.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [messages.length]);

  const push = (m: Omit<ChatMessage, 'id'>) => {
    const msg = { ...m, id: newId() };
    setMessages((prev) => [...prev, msg]);
    return msg;
  };

  // ── TTS ────────────────────────────────
  // 자동재생 정책 대응: 사용자 클릭 시점에 오디오 요소를 미리 '해제'해 둔다.
  // 이후 비동기 합성(await) 뒤에 재생해도 차단되지 않음.
  const SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  const ensureAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };
  const primeAudio = () => {
    if (audioPrimedRef.current) return;
    audioPrimedRef.current = true;
    try {
      const a = ensureAudio();
      a.src = SILENT_WAV;
      a.play().then(() => a.pause()).catch(() => {});
    } catch {
      /* ignore */
    }
  };

  const stopSpeaking = () => {
    audioRef.current?.pause();
    setSpeakingId(null);
  };

  const playUrl = (url: string, id: string) => {
    const audio = ensureAudio();
    audio.pause();
    audio.src = url;
    setSpeakingId(id);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setSpeakingId((cur) => (cur === id ? null : cur));
    };
    audio.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
    audio.play().catch(() => {
      setSpeakingId(null);
      push({ role: 'model', text: '🔊 자동 재생이 차단됐어요. 스피커 버튼(🔊)을 한 번 더 눌러주세요.' });
    });
  };

  // 재생 (스피커 버튼 / 자동 재생 공용)
  const speak = async (text: string, id: string) => {
    if (!text) return;
    primeAudio(); // 클릭 제스처 안에서 오디오 해제
    stopSpeaking();
    setSpeakingId(id);
    try {
      const url = await synthCloud(
        settings.ttsUrl || '',
        settings.ttsSecret || '',
        text,
        settings.cloudVoice,
        settings.ttsModel,
      );
      playUrl(url, id);
    } catch (e) {
      setSpeakingId(null);
      push({ role: 'model', text: `🔊 음성 재생 실패: ${friendlyError(e)}` });
    }
  };

  // 음성을 먼저 합성한 뒤 텍스트와 "동시에" 노출·재생 (자동 재생용)
  const pushWithSpeech = async (
    data: Omit<ChatMessage, 'id'>,
    ttsText: string,
    suffix: string,
  ) => {
    if (!settings.autoSpeak || !ttsText || !settings.ttsUrl) return push(data);
    let url: string | null = null;
    try {
      url = await synthCloud(
        settings.ttsUrl,
        settings.ttsSecret || '',
        ttsText,
        settings.cloudVoice,
        settings.ttsModel,
      );
    } catch {
      /* 합성 실패 시 텍스트만 노출 */
    }
    const msg = push(data);
    if (url) playUrl(url, `${msg.id}:${suffix}`);
    return msg;
  };

  // 집중 모드 결과 → 메시지
  const focusToMessage = (r: Awaited<ReturnType<typeof focusTurn>>): Omit<ChatMessage, 'id'> => ({
    role: 'model',
    text: r.feedback,
    clean: r.clean,
    focus: {
      question: r.question,
      questionKo: r.questionKo,
      sampleAnswer: r.sampleAnswer,
      sampleAnswerKo: r.sampleAnswerKo,
    },
  });

  const freeToMessage = (r: Awaited<ReturnType<typeof freeTurn>>): Omit<ChatMessage, 'id'> => ({
    role: 'model',
    text: r.correction ? `💡 ${r.correction}` : '',
    lines: [{ en: r.reply, ko: r.replyKo }],
  });

  // ── 대화 시작 ──────────────────────────
  const start = async () => {
    if (!settings.apiKey) return openSettings();
    if (loading) return;
    primeAudio(); // 클릭 제스처 안에서 오디오 해제 (자동재생 대비)
    setLoading(true);
    try {
      if (mode === 'focus') {
        if (!phrase) return;
        const r = await focusTurn(settings.apiKey, phrase, turnsRef.current, studyWords, model);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        await pushWithSpeech(focusToMessage(r), r.question, 'q');
      } else {
        const r = await freeTurn(settings.apiKey, phrases, turnsRef.current, studyWords, model);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        await pushWithSpeech(freeToMessage(r), r.reply, '0');
      }
    } catch (e) {
      push({ role: 'model', text: `⚠️ ${friendlyError(e)}` });
    } finally {
      setLoading(false);
    }
  };

  // ── 메시지 전송 ────────────────────────
  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!settings.apiKey) return openSettings();

    primeAudio(); // 클릭 제스처 안에서 오디오 해제 (자동재생 대비)
    const userMsg = push({ role: 'user', text });
    turnsRef.current.push({ role: 'user', text });
    setInput('');
    setLoading(true);

    try {
      if (mode === 'focus') {
        if (!phrase) return;
        setFocusCount((c) => c + 1);
        const r = await focusTurn(settings.apiKey, phrase, turnsRef.current, studyWords, model);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        if (r.clean) setCleanCount((c) => Math.min(CLEAN_GOAL, c + 1));
        recordFocusTurn(phrase.text, r.clean); // 구문별 숙련도 + 일일 활동 자동 저장
        // 반복 문법 약점 기록 (오타 제외)
        r.grammarIssues.forEach((g) => addGrammar(g.category, g.note, r.corrected || text));
        // 교정을 내 답변 말풍선에 부착
        if (r.corrected) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMsg.id
                ? {
                    ...m,
                    clean: r.clean,
                    correction: {
                      corrected: r.corrected,
                      correctedKo: r.correctedKo,
                      reason: r.correctionReason,
                    },
                  }
                : m,
            ),
          );
        }
        await pushWithSpeech(focusToMessage(r), r.question, 'q');
      } else {
        setFreeCount((c) => c + 1);
        recordFreeTurn(); // 일일 활동 자동 저장
        const r = await freeTurn(settings.apiKey, phrases, turnsRef.current, studyWords, model);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        await pushWithSpeech(freeToMessage(r), r.reply, '0');
      }
    } catch (e) {
      push({ role: 'model', text: `⚠️ ${friendlyError(e)}` });
    } finally {
      setLoading(false);
    }
  };

  // ── 마이크 ────────────────────────────
  const toggleMic = () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const rec = startRecognition(
      (t, isFinal) => setInput((prev) => (isFinal ? (prev ? prev + ' ' : '') + t : prev)),
      () => {
        setRecording(false);
        recRef.current = null;
      },
    );
    if (!rec) {
      alert('이 브라우저는 음성 입력을 지원하지 않아요. (Chrome 권장)');
      return;
    }
    recRef.current = rec;
    setRecording(true);
  };

  const started = messages.length > 0;
  const missingKey = !settings.apiKey;

  if (phrases.length === 0) {
    return (
      <div className="empty">
        먼저 <b>표현 등록</b> 탭에서 연습할 카테고리를 선택해주세요.
      </div>
    );
  }

  return (
    <div>
      {/* 모드 선택 */}
      <div className="modes">
        <button className={`mode ${mode === 'focus' ? 'active' : ''}`} onClick={() => setMode('focus')}>
          <div className="m-title">🎯 집중 구문 연습</div>
          <div className="m-desc">목표 구문으로 대화하며 반복</div>
        </button>
        <button className={`mode ${mode === 'free' ? 'active' : ''}`} onClick={() => setMode('free')}>
          <div className="m-title">💬 자유 실전 대화</div>
          <div className="m-desc">등록한 구문을 자유롭게 활용</div>
        </button>
      </div>

      {/* 목표 구문 바 */}
      <div className="card target">
        <div>
          <div className="section-label" style={{ margin: '0 0 6px' }}>
            {mode === 'focus' ? '집중 목표 구문' : '연습 카테고리'}
          </div>
          {mode === 'focus' ? (
            <>
              <div className="phrase">
                {phrase?.text}
                {phrase?.note && <span className="note">{phrase.note}</span>}
              </div>
              <div className="meaning">{phrase?.meaning}</div>
            </>
          ) : (
            <>
              <div className="phrase" style={{ fontSize: 15 }}>
                {poolLabel}
              </div>
              <div className="meaning">{phrases.length}개 구문으로 대화</div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div className="stats">
            <span className="chip accent">집중 {focusCount}</span>
            <span className="chip">자유 {freeCount}</span>
            <span className="chip good">
              Clean {cleanCount}/{CLEAN_GOAL}
            </span>
          </div>
          {mode === 'focus' && phrases.length > 1 && (
            <select
              className="select"
              style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
              value={phraseIdx}
              onChange={(e) => setPhraseIdx(Number(e.target.value))}
            >
              {phrases.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.text}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {missingKey && (
        <div className="banner warn">
          Gemini API 키가 없어요.{' '}
          <a onClick={openSettings} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
            설정에서 입력
          </a>
          하면 대화를 시작할 수 있어요.
        </div>
      )}

      {/* 채팅 */}
      <div className="card chat">
        {!started && !loading && (
          <div className="chat-empty">
            {mode === 'focus'
              ? '🎯 목표 구문으로 대화하며 연습해요. 아래 버튼으로 시작하세요.'
              : '💬 자유롭게 영어로 대화해요. 아래 버튼으로 시작하세요.'}
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={start} disabled={loading}>
                연습 시작
              </button>
            </div>
          </div>
        )}

        {messages.map((m) => {
          // 모델: 캡션(피드백) + 질문/응답 말풍선 (항상 동일 레이아웃)
          if (m.role === 'model' && (m.focus || m.lines?.length)) {
            return (
              <div key={m.id} className="msg-row">
                {m.text && <div className="msg-note">{m.text}</div>}
                <div className="msg model">
                  {m.focus && (
                    <FocusView
                      focus={m.focus}
                      msgId={m.id}
                      speakingId={speakingId}
                      onSpeak={speak}
                      onStop={stopSpeaking}
                      disabled={missingKey}
                    />
                  )}
                  {m.lines?.map((line, i) => (
                    <LineView
                      key={i}
                      line={line}
                      speaking={speakingId === `${m.id}:${i}`}
                      disabled={missingKey}
                      onSpeak={() =>
                        speakingId === `${m.id}:${i}` ? stopSpeaking() : speak(line.en, `${m.id}:${i}`)
                      }
                    />
                  ))}
                </div>
              </div>
            );
          }

          // 사용자: 내 답변 말풍선 + (있으면) 교정 카드
          if (m.role === 'user') {
            return (
              <div key={m.id} className="msg-row user">
                <div className="msg user">{m.text}</div>
                {m.correction && (
                  <CorrectionCard
                    c={m.correction}
                    original={m.text}
                    msgId={m.id}
                    speakingId={speakingId}
                    onSpeak={speak}
                    onStop={stopSpeaking}
                    disabled={missingKey}
                  />
                )}
              </div>
            );
          }

          // 에러·시스템 메시지
          return (
            <div key={m.id} className="msg model">
              {m.text && <div className="msg-text">{m.text}</div>}
            </div>
          );
        })}

        {loading && (
          <div className="msg model">
            <span className="spinner" /> <span style={{ color: 'var(--muted)' }}>생각 중…</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 입력창 */}
      <div className="card composer">
        <button
          className={`mic ${recording ? 'recording' : ''}`}
          onClick={toggleMic}
          title="음성 입력 (English)"
          disabled={!isSpeechRecognitionSupported()}
        >
          🎤
        </button>
        <textarea
          rows={1}
          placeholder={started ? '영어로 답해보세요…' : '연습을 시작한 뒤 답을 입력하세요'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="send" onClick={send} disabled={loading || !input.trim()}>
          전송
        </button>
      </div>

      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        <button className="btn sm ghost" onClick={() => resetSession()}>
          ↺ 대화 새로 시작
        </button>
      </div>
    </div>
  );
}
