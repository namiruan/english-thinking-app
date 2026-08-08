import { useEffect, useMemo, useState } from 'react';
import type { Category, Settings } from './types';
import {
  defaultSettings,
  seedCategories,
  useGrammarStats,
  useProgress,
  useWordbook,
  useLocalStorage,
} from './store';
import { loadVault, type Vault } from './lib/vault';
import ChatTab from './components/ChatTab';
import RegisterTab from './components/RegisterTab';
import HistoryTab from './components/HistoryTab';
import WordbookTab from './components/WordbookTab';
import SettingsModal from './components/SettingsModal';
import UnlockModal from './components/UnlockModal';
import SelectionLookup from './components/SelectionLookup';

type Tab = 'register' | 'chat' | 'history' | 'wordbook';

export default function App() {
  const [categories, setCategories] = useLocalStorage<Category[]>('et.categories', seedCategories);
  const [settings, setSettings] = useLocalStorage<Settings>('et.settings', defaultSettings);
  const [activeCatId, setActiveCatId] = useLocalStorage<string>(
    'et.activeCat',
    seedCategories[0]?.id ?? '',
  );
  const { progress, recordFocusTurn, recordFreeTurn, clearProgress } = useProgress();
  const { grammarStats, addGrammar, clearGrammar } = useGrammarStats();
  const { words, addWord, removeWord, clearWords } = useWordbook();

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

  // 잠금 / vault
  const [vault, setVault] = useState<Vault | null>(null);
  const [booted, setBooted] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [skipUnlock, setSkipUnlock] = useState(false);

  // 부팅: vault 로드 + 최초 구문 시드
  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await loadVault();
      if (!alive) return;
      setVault(v);
      if (!localStorage.getItem('et.initialized')) {
        const phrases = v?.phrases?.length ? v.phrases : seedCategories;
        setCategories(phrases);
        setActiveCatId(phrases[0]?.id ?? '');
        localStorage.setItem('et.initialized', '1');
      }
      setBooted(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveKey = settings.apiKey || sessionKey || '';
  const effectiveSettings: Settings = useMemo(
    () => ({ ...settings, apiKey: effectiveKey }),
    [settings, effectiveKey],
  );

  const needUnlock = booted && !!vault?.secret && !effectiveKey && !skipUnlock;

  const activeCat = categories.find((c) => c.id === activeCatId) ?? categories[0];

  const handleUnlock = (key: string, remember: boolean) => {
    if (remember) setSettings((s) => ({ ...s, apiKey: key }));
    else setSessionKey(key);
  };

  const clearKey = () => {
    setSettings((s) => ({ ...s, apiKey: '' }));
    setSessionKey(null);
    setSkipUnlock(false);
    setShowSettings(false);
  };

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
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="설정">
          ⚙
        </button>
      </header>

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
          activeCatId={activeCat?.id ?? ''}
          setActiveCatId={setActiveCatId}
        />
      )}

      {/* 대화 탭은 언마운트하지 않고 숨김 → 탭 전환해도 세션 유지 */}
      <div style={{ display: tab === 'chat' ? undefined : 'none' }}>
        <ChatTab
          category={activeCat}
          settings={effectiveSettings}
          recordFocusTurn={recordFocusTurn}
          recordFreeTurn={recordFreeTurn}
          addGrammar={addGrammar}
          studyWords={studyWords}
          openSettings={() => setShowSettings(true)}
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
          categories={categories}
          vaultSecret={vault?.secret}
          hasKey={!!effectiveKey}
          onSave={setSettings}
          onClearKey={clearKey}
          onClose={() => setShowSettings(false)}
        />
      )}

      {needUnlock && vault?.secret && (
        <UnlockModal
          secret={vault.secret}
          onUnlock={handleUnlock}
          onSkip={() => setSkipUnlock(true)}
        />
      )}

      {/* 드래그 사전 조회 팝업 */}
      <SelectionLookup
        apiKey={effectiveKey}
        model={effectiveSettings.model || 'gemini-2.5-flash-lite'}
        onAdd={addWord}
      />

      <footer className="footer">
        영어식 사고 · Gemini 2.5 Flash + Native Audio TTS · git 저장
      </footer>
    </div>
  );
}
