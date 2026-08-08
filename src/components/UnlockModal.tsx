import { useState } from 'react';
import type { EncryptedBlob } from '../lib/crypto';
import { decryptSecret } from '../lib/crypto';
import type { Category } from '../types';

interface Props {
  secret?: EncryptedBlob;
  phrasesEnc?: EncryptedBlob;
  onUnlock: (apiKey: string | null, categories: Category[] | null) => void;
}

export default function UnlockModal({ secret, phrasesEnc, onUnlock }: Props) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError('');
    try {
      let apiKey: string | null = null;
      let categories: Category[] | null = null;
      if (secret) apiKey = await decryptSecret(secret, pw);
      if (phrasesEnc) categories = JSON.parse(await decryptSecret(phrasesEnc, pw)) as Category[];
      onUnlock(apiKey, categories);
    } catch {
      setError('비밀번호가 올바르지 않아요.');
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔒 잠금 해제</h3>
        <p className="hint">이 앱은 비밀번호로 잠겨 있어요. 비밀번호를 입력하면 시작할 수 있어요.</p>

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

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={submit} disabled={!pw || busy}>
            {busy ? <span className="spinner" /> : '잠금 해제'}
          </button>
        </div>
      </div>
    </div>
  );
}
