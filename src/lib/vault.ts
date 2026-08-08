import type { Category } from '../types';
import type { EncryptedBlob } from './crypto';

/** git에 저장되는 데이터 묶음 (public/vault.json) */
export interface Vault {
  version: number;
  phrases?: Category[]; // 평문 구문 (레거시/공개)
  phrasesEnc?: EncryptedBlob; // 비밀번호로 암호화된 구문 (비공개)
  secret?: EncryptedBlob; // 비밀번호로 암호화된 API 키
}

/** 배포된 vault.json 을 불러온다. 없으면 null. */
export async function loadVault(): Promise<Vault | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}vault.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Vault;
  } catch {
    return null;
  }
}

/** git에 커밋할 vault.json 문자열 생성 */
export function buildVaultJson(opts: {
  phrases?: Category[];
  phrasesEnc?: EncryptedBlob;
  secret?: EncryptedBlob;
}): string {
  const vault: Vault = { version: 1 };
  if (opts.phrasesEnc) vault.phrasesEnc = opts.phrasesEnc;
  else if (opts.phrases) vault.phrases = opts.phrases;
  if (opts.secret) vault.secret = opts.secret;
  return JSON.stringify(vault, null, 2) + '\n';
}
