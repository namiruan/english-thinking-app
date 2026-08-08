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
import { decryptSecret } from './lib/crypto';

const REMEMBER_PW_KEY = 'et.rememberedPw';
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
  const [selectedCatIds, setSelectedCatIds] = useLocalStorage<string[]>(
    'et.selectedCats',
    seedCategories[0]?.id ? [seedCategories[0].id] : [],
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
  const [unlocked, setUnlocked] = useState(false);

  // 부팅: vault 로드 + 최초 구문 시드
  useEffect(() => {
    let alive = true;
    (async () => {
      const v = await loadVault();
      if (!alive) return;
      setVault(v);
      // 암호화된 구문(phrasesEnc)이면 잠금 해제 후 채워짐 → 여기선 시드 안 함
      if (!v?.phrasesEnc && !localStorage.getItem('et.initialized')) {
        const phrases = v?.phrases?.length ? v.phrases : seedCategories;
        setCategories(phrases);
        setSelectedCatIds(phrases[0]?.id ? [phrases[0].id] : []);
        localStorage.setItem('et.initialized', '1');
      }
      // 이 기기에 기억된 비밀번호가 있으면 자동으로 잠금 해제
      if (v && (v.secret || v.phrasesEnc)) {
        const remembered = localStorage.getItem(REMEMBER_PW_KEY);
        if (remembered) {
          try {
            let apiKey: string | null = null;
            let cats: Category[] | null = null;
            if (v.secret) apiKey = await decryptSecret(v.secret, remembered);
            if (v.phrasesEnc) cats = JSON.parse(await decryptSecret(v.phrasesEnc, remembered)) as Category[];
            if (!alive) return;
            handleUnlock(apiKey, cats);
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

  // 비번 강제: vault에 암호화 자료가 있으면 잠금 해제 전까지 앱을 막음
  const locked = booted && !!(vault?.secret || vault?.phrasesEnc) && !unlocked;

  // 연습 대상 = 선택된 카테고리들의 구문 합집합
  const selectedCats = categories.filter((c) => selectedCatIds.includes(c.id));
  const practicePhrases = selectedCats.flatMap((c) => c.phrases);
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

  const handleUnlock = (key: string | null, cats: Category[] | null) => {
    if (key) setSessionKey(key);
    if (cats && cats.length) {
      setCategories(cats);
      setSelectedCatIds(cats[0]?.id ? [cats[0].id] : []);
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
    setUnlocked(false);
  };
  const hasLock = !!(vault?.secret || vault?.phrasesEnc);

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
              apiKey={effectiveKey}
              model={effectiveSettings.model?.trim() || 'gemini-3.5-flash-lite'}
            />
          )}

          {/* 대화 탭은 언마운트하지 않고 숨김 → 탭 전환해도 세션 유지 */}
          <div style={{ display: tab === 'chat' ? undefined : 'none' }}>
            <ChatTab
              phrases={practicePhrases}
              poolLabel={poolLabel}
              poolKey={poolKey}
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

          {/* 드래그 사전 조회 팝업 */}
          <SelectionLookup
            apiKey={effectiveKey}
            model={effectiveSettings.model?.trim() || 'gemini-3.5-flash-lite'}
            onAdd={addWord}
          />
        </>
      )}

      <footer className="footer">
        영어식 사고 · Gemini 2.5 Flash + Native Audio TTS · git 저장
      </footer>
    </div>
  );
}
