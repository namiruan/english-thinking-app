import { useState } from 'react';
import type { Settings } from '../types';
import { TTS_VOICES } from '../lib/gemini';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsModal({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>설정</h3>
        <p className="hint">Gemini API 키는 이 브라우저에만 저장돼요. 외부로 전송되지 않습니다.</p>

        <div className="field">
          <label>Gemini API 키</label>
          <input
            className="input"
            type="password"
            placeholder="AIza..."
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value.trim() })}
          />
          <p className="hint" style={{ margin: '6px 0 0' }}>
            무료 발급:{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>
          </p>
        </div>

        <div className="field">
          <label>원어민 음성 (Native TTS)</label>
          <select
            className="select"
            value={draft.voice}
            onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
          >
            {TTS_VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <label className="toggle" style={{ marginBottom: 20 }}>
          <input
            type="checkbox"
            checked={draft.autoSpeak}
            onChange={(e) => setDraft({ ...draft, autoSpeak: e.target.checked })}
          />
          AI 영어 문장 자동 재생
        </label>

        <div className="row between">
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
