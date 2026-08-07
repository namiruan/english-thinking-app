import { useState } from 'react';
import type { Category, Settings } from '../types';
import { TTS_VOICES } from '../lib/gemini';
import { encryptSecret, type EncryptedBlob } from '../lib/crypto';
import { buildVaultJson } from '../lib/vault';

interface Props {
  settings: Settings;
  categories: Category[];
  vaultSecret?: EncryptedBlob;
  hasKey: boolean;
  onSave: (s: Settings) => void;
  onClearKey: () => void;
  onClose: () => void;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SettingsModal({
  settings,
  categories,
  vaultSecret,
  hasKey,
  onSave,
  onClearKey,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  // 잠금 파일 생성용
  const [expKey, setExpKey] = useState(settings.apiKey || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [generated, setGenerated] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const makeVault = async (withSecret: boolean) => {
    setMsg('');
    if (withSecret) {
      if (!expKey.trim()) return setMsg('API 키를 입력해주세요.');
      if (pw.length < 8) return setMsg('비밀번호는 8자 이상을 권장해요. (길수록 안전)');
      if (pw !== pw2) return setMsg('비밀번호 확인이 일치하지 않아요.');
    }
    setBusy(true);
    try {
      let secret: EncryptedBlob | undefined;
      if (withSecret) secret = await encryptSecret(expKey.trim(), pw);
      else secret = vaultSecret; // 구문만 갱신, 기존 잠금 유지
      setGenerated(buildVaultJson(categories, secret));
      setMsg(withSecret ? '완료! 아래 파일을 저장하고 커밋하세요.' : '구문만 담은 파일을 만들었어요.');
    } catch (e) {
      setMsg('생성 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3>설정</h3>

        {/* ── 기본 설정 ── */}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Gemini API 키 (이 브라우저)</label>
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
            {hasKey && (
              <>
                {' · '}
                <a style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={onClearKey}>
                  이 브라우저에서 키 지우기(잠그기)
                </a>
              </>
            )}
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

        <label className="toggle" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={draft.autoSpeak}
            onChange={(e) => setDraft({ ...draft, autoSpeak: e.target.checked })}
          />
          AI 영어 문장 자동 재생
        </label>

        <div className="row between" style={{ marginBottom: 20 }}>
          <button className="btn ghost" onClick={onClose}>
            닫기
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

        {/* ── git 저장 (암호화) ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="section-label">🔐 git에 저장 (vault.json)</div>
          <p className="hint" style={{ margin: '0 0 14px' }}>
            API 키를 <b>비밀번호로 암호화</b>해 <code>vault.json</code>에 담아요. 원본 키는 저장되지
            않고, 공개돼도 비밀번호 없이는 열 수 없어요. 구문도 함께 저장됩니다.
          </p>

          <div className="field" style={{ marginBottom: 10 }}>
            <label>API 키</label>
            <input
              className="input"
              type="password"
              placeholder="암호화할 Gemini API 키"
              value={expKey}
              onChange={(e) => setExpKey(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              type="password"
              placeholder="비밀번호"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="input"
              type="password"
              placeholder="비밀번호 확인"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          <div className="row">
            <button className="btn primary" onClick={() => makeVault(true)} disabled={busy}>
              {busy ? <span className="spinner" /> : '암호화 파일 만들기'}
            </button>
            <button className="btn" onClick={() => makeVault(false)} disabled={busy}>
              구문만 저장 (기존 잠금 유지)
            </button>
          </div>

          {msg && (
            <p className="hint" style={{ margin: '10px 0 0', color: 'var(--accent)' }}>
              {msg}
            </p>
          )}

          {generated && (
            <div style={{ marginTop: 12 }}>
              <textarea className="input" readOnly rows={6} value={generated} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => download('vault.json', generated)}>
                  ⬇ vault.json 다운로드
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(generated);
                    setMsg('클립보드에 복사했어요.');
                  }}
                >
                  📋 복사
                </button>
              </div>
              <p className="hint" style={{ margin: '10px 0 0' }}>
                저장 방법: 이 파일을 프로젝트의 <code>public/vault.json</code>에 덮어쓴 뒤
                <br />
                <code>git add public/vault.json &amp;&amp; git commit -m "update vault" &amp;&amp; git push</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
