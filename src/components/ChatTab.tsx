import { useEffect, useRef, useState } from 'react';
import type {
  Category,
  ChatMessage,
  FocusBlock,
  HistoryEntry,
  Mode,
  Phrase,
  Settings,
  TranslatedLine,
} from '../types';
import { newId } from '../store';
import { focusTurn, freeTurn, friendlyError, synthesizeSpeech, type Turn } from '../lib/gemini';
import { isSpeechRecognitionSupported, startRecognition, type Recognizer } from '../lib/speech';

interface Props {
  category: Category | undefined;
  settings: Settings;
  addHistory: (e: Omit<HistoryEntry, 'id' | 'date'>) => void;
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

// ── 집중 모드: 질문 + [번역 보기][예시 답변 보기] 동급 토글 ──
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
  const qId = `${msgId}:q`;
  const aId = `${msgId}:a`;

  const speakBtn = (text: string, id: string, cls = 'speak') => (
    <button
      className={cls}
      onClick={() => (speakingId === id ? onStop() : onSpeak(text, id))}
      disabled={disabled}
      title="원어민 음성으로 듣기"
    >
      {speakingId === id ? '⏸' : '🔊'}
    </button>
  );

  return (
    <div className="tline">
      <div className="tline-en">
        {speakBtn(focus.question, qId)}
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
              {speakBtn(focus.sampleAnswer, aId, 'speak mini')}
              <span>{focus.sampleAnswer}</span>
            </div>
            <div className="tline-ex-ko">{focus.sampleAnswerKo}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatTab({ category, settings, addHistory, openSettings }: Props) {
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
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);

  const phrases = category?.phrases ?? [];
  const phrase: Phrase | undefined = phrases[phraseIdx];

  const resetSession = (opts?: { keepStats?: boolean }) => {
    if (!opts?.keepStats && focusCount + freeCount > 0 && category && phrase) {
      addHistory({
        phraseText: mode === 'focus' ? phrase.text : '(자유 대화)',
        categoryName: category.name,
        mode,
        cleanCount,
        turns: mode === 'focus' ? focusCount : freeCount,
      });
    }
    setMessages([]);
    turnsRef.current = [];
    setFocusCount(0);
    setFreeCount(0);
    setCleanCount(0);
    stopSpeaking();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => resetSession({ keepStats: true }), [category?.id, mode, phraseIdx]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const push = (m: Omit<ChatMessage, 'id'>) => {
    const msg = { ...m, id: newId() };
    setMessages((prev) => [...prev, msg]);
    return msg;
  };

  // ── TTS ────────────────────────────────
  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingId(null);
  };

  const playUrl = (url: string, id: string) => {
    stopSpeaking();
    setSpeakingId(id);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setSpeakingId((cur) => (cur === id ? null : cur));
    };
    audio.play().catch(() => setSpeakingId(null));
  };

  // 수동 재생 (스피커 버튼)
  const speak = async (text: string, id: string) => {
    if (!settings.apiKey || !text) return;
    stopSpeaking();
    setSpeakingId(id);
    try {
      const url = await synthesizeSpeech(settings.apiKey, text, settings.voice);
      playUrl(url, id);
    } catch (e) {
      setSpeakingId(null);
      push({ role: 'model', text: `🔊 음성 재생 실패: ${friendlyError(e)}` });
    }
  };

  // 오디오를 먼저 합성한 뒤 텍스트와 "동시에" 노출·재생 (자동 재생용)
  const pushWithSpeech = async (
    data: Omit<ChatMessage, 'id'>,
    ttsText: string,
    suffix: string,
  ) => {
    if (settings.autoSpeak && settings.apiKey && ttsText) {
      let url: string | null = null;
      try {
        url = await synthesizeSpeech(settings.apiKey, ttsText, settings.voice);
      } catch {
        /* 합성 실패 시 텍스트만 노출 */
      }
      const msg = push(data);
      if (url) playUrl(url, `${msg.id}:${suffix}`);
      return msg;
    }
    return push(data);
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
    setLoading(true);
    try {
      if (mode === 'focus') {
        if (!phrase) return;
        const r = await focusTurn(settings.apiKey, phrase, turnsRef.current);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        await pushWithSpeech(focusToMessage(r), r.question, 'q');
      } else {
        const r = await freeTurn(settings.apiKey, phrases, turnsRef.current);
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

    push({ role: 'user', text });
    turnsRef.current.push({ role: 'user', text });
    setInput('');
    setLoading(true);

    try {
      if (mode === 'focus') {
        if (!phrase) return;
        setFocusCount((c) => c + 1);
        const r = await focusTurn(settings.apiKey, phrase, turnsRef.current);
        turnsRef.current.push({ role: 'model', text: JSON.stringify(r) });
        if (r.clean) setCleanCount((c) => Math.min(CLEAN_GOAL, c + 1));
        await pushWithSpeech(focusToMessage(r), r.question, 'q');
      } else {
        setFreeCount((c) => c + 1);
        const r = await freeTurn(settings.apiKey, phrases, turnsRef.current);
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

  if (!category || phrases.length === 0) {
    return (
      <div className="empty">
        먼저 <b>표현 등록</b> 탭에서 구문을 등록해주세요.
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
            {mode === 'focus' ? '집중 목표 구문' : '이 카테고리'}
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
                {category.name}
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
          const hasContent = Boolean(m.focus || m.lines?.length);
          const bubble = (
            <div className={`msg model ${m.clean ? 'clean-flag' : ''}`}>
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
          );

          // 모델의 코치 피드백은 말풍선 밖 캡션으로, 실제 대화만 말풍선 안에
          if (m.role === 'model' && hasContent) {
            return (
              <div key={m.id} className="msg-row">
                {m.text && <div className="msg-note">{m.text}</div>}
                {bubble}
              </div>
            );
          }

          // 사용자 메시지 / 에러·시스템 메시지는 기존 말풍선
          return (
            <div key={m.id} className={`msg ${m.role} ${m.clean ? 'clean-flag' : ''}`}>
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
          ↺ 세션 초기화 (기록 저장)
        </button>
      </div>
    </div>
  );
}
