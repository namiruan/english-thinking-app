import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Category, Settings } from './types';
import {
  defaultSettings,
  defaultGitHub,
  seedCategories,
  useGrammarStats,
  useProgress,
  useWordbook,
  useLocalStorage,
} from './store';
import { loadVault, type Vault } from './lib/vault';
import { decryptSecret } from './lib/crypto';
import { decryptData, snapshot, pushVault, type SyncData } from './lib/sync';
import type { ChatConfig } from './lib/gemini';
import ChatTab from './components/ChatTab';
import RegisterTab from './components/RegisterTab';
import HistoryTab from './components/HistoryTab';
import WordbookTab from './components/WordbookTab';
import SettingsModal from './components/SettingsModal';
import UnlockModal, { type UnlockResult } from './components/UnlockModal';
import SelectionLookup from './components/SelectionLookup';

const REMEMBER_PW_KEY = 'et.rememberedPw';
const LOCAL_AT_KEY = 'et.localAt'; // 로컬 마지막 변경 시각(ms) — 동기화 최신 판단
type SyncStatus = 'off' | 'idle' | 'syncing' | 'synced' | 'error';

type Tab = 'register' | 'chat' | 'history' | 'wordbook';

export default function App() {
  const [categories, setCategories] = useLocalStorage<Category[]>('et.categories', seedCategories);
  const [settings, setSettings] = useLocalStorage<Settings>('et.settings', defaultSettings);
  const [selectedCatIds, setSelectedCatIds] = useLocalStorage<string[]>(
    'et.selectedCats',
    seedCategories[0]?.id ? [seedCategories[0].id] : [],
  );
  const { progress, setProgress, recordFocusTurn, recordFreeTurn, clearProgress } = useProgress();
  const { grammarStats, setGrammarStats, addGrammar, clearGrammar } = useGrammarStats();
  const { words, setWords, addWord, removeWord, clearWords } = useWordbook();

  // 복습용 단어 (많이 저장된 순 상위 8개) → 대화에 재노출
  const studyWords = useMemo(
    () =>
      Object.values(words)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((w) => w.term),
    [words],
  );

  const [tab, setTab] = useState<Tab>('chat');
  const [showSettings, setShowSettings] = useState(false);

  // 시스템 안내용 토스트 (학습 내용이 아닌 알림)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((text: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);
  const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // 잠금 / vault
  const [vault, setVault] = useState<Vault | null>(null);
  const [booted, setBooted] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // 동기화 (GitHub)
  const [sessionPassword, setSessionPassword] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('off');
  const lastSyncedHashRef = useRef<string | null>(null);

  // 부팅: vault 로드 + 최초 구문 시드
  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await loadVault();
      if (!alive) return;
      setVault(v);
      // 암호화 자료(dataEnc/phrasesEnc)면 잠금 해제 후 채워짐 → 여기선 시드 안 함
      if (!v?.dataEnc && !v?.phrasesEnc && !localStorage.getItem('et.initialized')) {
        const phrases = v?.phrases?.length ? v.phrases : seedCategories;
        setCategories(phrases);
        setSelectedCatIds(phrases[0]?.id ? [phrases[0].id] : []);
        localStorage.setItem('et.initialized', '1');
      }
      // 이 기기에 기억된 비밀번호가 있으면 자동으로 잠금 해제
      if (v && (v.dataEnc || v.secret || v.phrasesEnc)) {
        const remembered = localStorage.getItem(REMEMBER_PW_KEY);
        if (remembered) {
          try {
            const res: UnlockResult = {};
            if (v.dataEnc) {
              res.data = await decryptData(v.dataEnc, remembered);
            } else {
              if (v.secret) res.apiKey = await decryptSecret(v.secret, remembered);
              if (v.phrasesEnc)
                res.categories = JSON.parse(await decryptSecret(v.phrasesEnc, remembered)) as Category[];
            }
            if (!alive) return;
            handleUnlock(res, remembered);
          } catch {
            localStorage.removeItem(REMEMBER_PW_KEY);
          }
        }
      }
      setBooted(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveKey = sessionKey || settings.apiKey || '';
  const effectiveSettings: Settings = useMemo(
    () => ({ ...settings, apiKey: effectiveKey }),
    [settings, effectiveKey],
  );

  // 대화·사전 엔진 설정 (Gemini 또는 Groq·워커 경유)
  const chatCfg: ChatConfig = useMemo(
    () => ({
      engine: settings.chatEngine === 'groq' ? 'groq' : 'gemini',
      apiKey: effectiveKey,
      model: settings.model?.trim() || 'gemini-3.5-flash-lite',
      workerUrl: settings.ttsUrl,
      secret: settings.ttsSecret,
      // 지원 종료된 Llama 모델이 저장돼 있으면 자동으로 Qwen(한국어 강함)으로
      groqModel:
        settings.groqModel && !/llama/i.test(settings.groqModel)
          ? settings.groqModel
          : 'openai/gpt-oss-120b',
    }),
    [settings, effectiveKey],
  );
  // 대화 가능 여부: Gemini는 키, Groq는 워커 주소
  const chatReady = chatCfg.engine === 'groq' ? !!chatCfg.workerUrl : !!effectiveKey;

  // 비번 강제: vault에 암호화 자료가 있으면 잠금 해제 전까지 앱을 막음
  const locked = booted && !!(vault?.dataEnc || vault?.secret || vault?.phrasesEnc) && !unlocked;

  // 연습 대상 = 선택된 카테고리들의 구문 합집합
  const selectedCats = categories.filter((c) => selectedCatIds.includes(c.id));
  const practicePhrases = selectedCats.flatMap((c) =>
    c.phrases.map((p) => ({ ...p, categoryName: c.name })),
  );
  const multiCat = selectedCats.length > 1;
  const poolLabel =
    selectedCats.length === 0
      ? ''
      : selectedCats.length === 1
        ? selectedCats[0].name
        : `${selectedCats.length}개 카테고리`;
  const poolKey = selectedCatIds.join(',');

  const toggleSelected = (id: string) =>
    setSelectedCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const addSelected = (id: string) =>
    setSelectedCatIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

  // 전체 동기화 데이터로 로컬 상태를 교체 (다른 기기에서 만든 최신본 반영)
  const hydrate = (data: SyncData) => {
    if (data.categories) setCategories(data.categories);
    if (data.selectedCatIds) setSelectedCatIds(data.selectedCatIds);
    if (data.wordbook) setWords(data.wordbook);
    if (data.progress) setProgress(data.progress);
    if (data.grammar) setGrammarStats(data.grammar);
    if (data.settings) setSettings(data.settings);
    // 방금 불러온 상태 = 최신 → 즉시 되-push 방지
    lastSyncedHashRef.current = snapshot(data);
  };

  const handleUnlock = (res: UnlockResult, password: string) => {
    setSessionPassword(password);
    if (res.data) {
      // 로컬이 더 최신이면(아직 push 안 됐거나 Pages 반영 전) vault로 덮어쓰지 않음
      const localAt = Number(localStorage.getItem(LOCAL_AT_KEY) || 0);
      const vaultAt = Number(res.data.updatedAt || 0);
      if (!localAt || vaultAt >= localAt) {
        hydrate(res.data);
        localStorage.setItem(LOCAL_AT_KEY, String(vaultAt || Date.now()));
        if (res.data.settings?.apiKey) setSessionKey(res.data.settings.apiKey);
        setSyncStatus(res.data.settings?.github?.token ? 'idle' : 'off');
      } else {
        // 로컬 유지. 세션 키만 확보하고, 곧 로컬을 push 하도록 함.
        if (res.data.settings?.apiKey) setSessionKey(res.data.settings.apiKey);
        else if (settings.apiKey) setSessionKey(settings.apiKey);
        setSyncStatus(settings.github?.token ? 'idle' : 'off');
        lastSyncedHashRef.current = null;
      }
    } else {
      if (res.apiKey) setSessionKey(res.apiKey);
      if (res.categories && res.categories.length) {
        setCategories(res.categories);
        setSelectedCatIds(res.categories[0]?.id ? [res.categories[0].id] : []);
      }
    }
    setUnlocked(true);
  };

  const clearKey = () => {
    setSettings((s) => ({ ...s, apiKey: '' }));
    setSessionKey(null);
    setShowSettings(false);
  };

  // 기억된 비밀번호를 지우고 다시 잠금 (재입력 필요)
  const lockNow = () => {
    localStorage.removeItem(REMEMBER_PW_KEY);
    setSessionKey(null);
    setSessionPassword(null);
    setUnlocked(false);
  };
  const hasLock = !!(vault?.dataEnc || vault?.secret || vault?.phrasesEnc);

  // 현재 전체 상태 스냅샷
  const currentData: SyncData = useMemo(
    () => ({
      categories,
      selectedCatIds,
      wordbook: words,
      progress,
      grammar: grammarStats,
      settings,
    }),
    [categories, selectedCatIds, words, progress, grammarStats, settings],
  );

  // 자동 동기화: 변경되면 디바운스 후 암호화 vault 를 GitHub 에 push
  useEffect(() => {
    if (!unlocked || !sessionPassword) return;
    const gh = settings.github;
    if (!gh?.token) {
      setSyncStatus('off');
      return;
    }
    const snap = snapshot(currentData);
    if (snap === lastSyncedHashRef.current) return; // 변경 없음
    // 로컬 변경 발생 → 이 시점을 로컬 최신 시각으로 기록 (push 실패/재로딩 시에도 로컬 보존)
    const ts = Date.now();
    localStorage.setItem(LOCAL_AT_KEY, String(ts));
    const cfg = { ...defaultGitHub, ...gh };
    const t = setTimeout(async () => {
      setSyncStatus('syncing');
      try {
        await pushVault(cfg, sessionPassword, currentData, ts);
        lastSyncedHashRef.current = snap;
        setSyncStatus('synced');
      } catch {
        setSyncStatus('error');
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [currentData, unlocked, sessionPassword, settings.github]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">英</div>
          <div>
            <div className="title">영어식 사고</div>
            <div className="subtitle">입에 척 달라붙는 구문 훈련</div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {!locked && syncStatus !== 'off' && (
            <span className={`sync-badge ${syncStatus}`} title="기기 간 동기화 상태">
              {syncStatus === 'syncing'
                ? '동기화 중…'
                : syncStatus === 'synced'
                  ? '☁ 동기화됨'
                  : syncStatus === 'error'
                    ? '⚠ 동기화 실패'
                    : '☁ 동기화'}
            </span>
          )}
          {hasLock && !locked && (
            <button className="icon-btn" onClick={lockNow} title="잠그기 (기억된 비밀번호 지우기)">
              🔒
            </button>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="설정">
            ⚙
          </button>
        </div>
      </header>

      {locked ? (
        <UnlockModal
          secret={vault?.secret}
          phrasesEnc={vault?.phrasesEnc}
          dataEnc={vault?.dataEnc}
          onUnlock={handleUnlock}
        />
      ) : (
        <>
          <nav className="tabs">
            <button className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>
              표현 등록
            </button>
            <button className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
              대화
            </button>
            <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
              기록
            </button>
            <button className={`tab ${tab === 'wordbook' ? 'active' : ''}`} onClick={() => setTab('wordbook')}>
              단어장
            </button>
          </nav>

          {tab === 'register' && (
            <RegisterTab
              categories={categories}
              setCategories={setCategories}
              selectedCatIds={selectedCatIds}
              toggleSelected={toggleSelected}
              addSelected={addSelected}
              addWord={addWord}
              chatCfg={chatCfg}
              chatReady={chatReady}
            />
          )}

          {/* 대화 탭은 언마운트하지 않고 숨김 → 탭 전환해도 세션 유지 */}
          <div style={{ display: tab === 'chat' ? undefined : 'none' }}>
            <ChatTab
              phrases={practicePhrases}
              poolLabel={poolLabel}
              poolKey={poolKey}
              multiCat={multiCat}
              settings={effectiveSettings}
              chatCfg={chatCfg}
              chatReady={chatReady}
              recordFocusTurn={recordFocusTurn}
              recordFreeTurn={recordFreeTurn}
              addGrammar={addGrammar}
              studyWords={studyWords}
              openSettings={() => setShowSettings(true)}
              showToast={showToast}
            />
          </div>

          {tab === 'history' && (
            <HistoryTab
              progress={progress}
              clearProgress={clearProgress}
              grammarStats={grammarStats}
              clearGrammar={clearGrammar}
            />
          )}

          {tab === 'wordbook' && (
            <WordbookTab words={words} removeWord={removeWord} clearWords={clearWords} />
          )}

          {showSettings && (
            <SettingsModal
              settings={effectiveSettings}
              syncData={currentData}
              hasKey={!!effectiveKey}
              sessionPassword={sessionPassword}
              onSave={setSettings}
              onSynced={(pw) => {
                setSessionPassword(pw);
                lastSyncedHashRef.current = snapshot(currentData);
                setSyncStatus('synced');
              }}
              onClearKey={clearKey}
              onClose={() => setShowSettings(false)}
            />
          )}

          {/* 드래그 사전 조회 팝업 */}
          <SelectionLookup chatCfg={chatCfg} chatReady={chatReady} onAdd={addWord} />
        </>
      )}

      <footer className="footer">
        영어식 사고 ·{' '}
        {effectiveSettings.chatEngine === 'groq'
          ? `Groq (${effectiveSettings.groqModel || 'openai/gpt-oss-120b'})`
          : effectiveSettings.model?.trim() || 'gemini-3.5-flash-lite'}{' '}
        · {effectiveSettings.ttsEngine === 'google' ? 'Google 음성' : 'Cloudflare 음성'} · 자동 동기화
      </footer>

      {toasts.length > 0 && (
        <div className="toast-host">
          {toasts.map((t) => (
            <div key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
