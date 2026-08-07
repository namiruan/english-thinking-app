import { useState } from 'react';
import type { EncryptedBlob } from '../lib/crypto';
import { decryptSecret } from '../lib/crypto';

interface Props {
  secret: EncryptedBlob;
  onUnlock: (apiKey: string, remember: boolean) => void;
  onSkip: () => void;
}

export default function UnlockModal({ secret, onUnlock, onSkip }: Props) {
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      const key = await decryptSecret(secret, pw);
      onUnlock(key, remember);
    } catch {
      setError('비밀번호가 올바르지 않아요.');
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔒 잠금 해제</h3>
        <p className="hint">
          이 앱에는 암호화된 API 키가 저장돼 있어요. 비밀번호를 입력하면 대화를 시작할 수 있어요.
        </p>

        <div className="field">
          <label>비밀번호</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="비밀번호 입력"
          />
          {error && (
            <p className="hint" style={{ color: 'var(--danger)', margin: '6px 0 0' }}>
              {error}
            </p>
          )}
        </div>

        <label className="toggle" style={{ marginBottom: 20 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          이 브라우저에서 잠금 해제 상태 유지
        </label>

        <div className="row between">
          <button className="btn ghost" onClick={onSkip}>
            비밀번호 없이 계속
          </button>
          <button className="btn primary" onClick={submit} disabled={!pw || busy}>
            {busy ? <span className="spinner" /> : '잠금 해제'}
          </button>
        </div>
      </div>
    </div>
  );
}
