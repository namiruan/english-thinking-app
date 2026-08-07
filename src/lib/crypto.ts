/**
 * 비밀번호 기반 암호화 (Web Crypto)
 * - PBKDF2(SHA-256)로 비밀번호에서 키 유도 → AES-GCM 256으로 암호화
 * - 원본 API 키는 저장하지 않고, 이 암호문(EncryptedBlob)만 git에 저장한다.
 * - 비밀번호를 모르면 복호화 불가. (비밀번호는 어디에도 저장하지 않음)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 250_000;

export interface EncryptedBlob {
  v: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// TS 5.7의 엄격한 BufferSource 타입 대응
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', bs(enc.encode(password)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(plaintext: string, password: string): Promise<EncryptedBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(enc.encode(plaintext)));
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ct: bufToB64(ct),
  };
}

/** 비밀번호가 틀리면 예외를 던진다. */
export async function decryptSecret(blob: EncryptedBlob, password: string): Promise<string> {
  const salt = b64ToBytes(blob.salt);
  const iv = b64ToBytes(blob.iv);
  const key = await deriveKey(password, salt, blob.iterations);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(b64ToBytes(blob.ct)));
  return dec.decode(pt);
}
