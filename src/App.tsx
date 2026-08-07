import { useState } from 'react';
import type { Category, Settings } from './types';
import { defaultSettings, seedCategories, useHistory, useLocalStorage } from './store';
import ChatTab from './components/ChatTab';
import RegisterTab from './components/RegisterTab';
import HistoryTab from './components/HistoryTab';
import SettingsModal from './components/SettingsModal';

type Tab = 'register' | 'chat' | 'history';

export default function App() {
  const [categories, setCategories] = useLocalStorage<Category[]>('et.categories', seedCategories);
  const [settings, setSettings] = useLocalStorage<Settings>('et.settings', defaultSettings);
  const [activeCatId, setActiveCatId] = useLocalStorage<string>(
    'et.activeCat',
    seedCategories[0]?.id ?? '',
  );
  const { history, addHistory, clearHistory } = useHistory();

  const [tab, setTab] = useState<Tab>('chat');
  const [showSettings, setShowSettings] = useState(false);

  const activeCat =
    categories.find((c) => c.id === activeCatId) ?? categories[0];

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
      </nav>

      {tab === 'register' && (
        <RegisterTab
          categories={categories}
          setCategories={setCategories}
          activeCatId={activeCat?.id ?? ''}
          setActiveCatId={setActiveCatId}
        />
      )}

      {tab === 'chat' && (
        <ChatTab
          category={activeCat}
          settings={settings}
          addHistory={addHistory}
          openSettings={() => setShowSettings(true)}
        />
      )}

      {tab === 'history' && <HistoryTab history={history} clearHistory={clearHistory} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      <footer className="footer">
        영어식 사고 · Gemini 2.5 Flash + Native Audio TTS · 로컬 저장
      </footer>
    </div>
  );
}
