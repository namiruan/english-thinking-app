import type { Category, Settings, WordEntry } from '../types';
import type { GrammarStat, Progress } from '../store';
import { encryptSecret, decryptSecret, type EncryptedBlob } from './crypto';
import { commitFile, type GitHubConfig } from './github';
import { buildVaultJson } from './vault';

/** 기기 간 동기화되는 전체 데이터 묶음 */
export interface SyncData {
  categories: Category[];
  selectedCatIds: string[];
  wordbook: Record<string, WordEntry>;
  progress: Progress;
  grammar: Record<string, GrammarStat>;
  settings: Settings; // apiKey·github(token)·tts 포함 (암호문으로만 저장됨)
  updatedAt?: number; // 마지막 저장 시각(ms). 로컬이 더 최신이면 vault로 덮어쓰지 않음.
}

/** 항상 같은 키 순서로 직렬화 (스냅샷 비교/커밋 안정화) */
export function makeSyncData(v: SyncData): SyncData {
  return {
    categories: v.categories,
    selectedCatIds: v.selectedCatIds,
    wordbook: v.wordbook,
    progress: v.progress,
    grammar: v.grammar,
    settings: v.settings,
  };
}

export function snapshot(v: SyncData): string {
  return JSON.stringify(makeSyncData(v));
}

export async function encryptData(v: SyncData, password: string): Promise<EncryptedBlob> {
  return encryptSecret(JSON.stringify(makeSyncData(v)), password);
}

export async function decryptData(blob: EncryptedBlob, password: string): Promise<SyncData> {
  return JSON.parse(await decryptSecret(blob, password)) as SyncData;
}

/** 암호화된 전체 데이터를 GitHub vault.json 에 커밋. 성공 시 커밋 URL. */
export async function pushVault(
  cfg: GitHubConfig,
  password: string,
  data: SyncData,
  updatedAt: number,
): Promise<string> {
  // updatedAt 을 함께 암호화 저장 → 다른 기기/재로딩 시 최신 여부 판단
  const payload = { ...makeSyncData(data), updatedAt };
  const dataEnc = await encryptSecret(JSON.stringify(payload), password);
  const apiKey = data.settings.apiKey?.trim();
  const secret = apiKey ? await encryptSecret(apiKey, password) : undefined;
  const content = buildVaultJson({ dataEnc, secret });
  try {
    return await commitFile(cfg, content, 'Sync vault via app');
  } catch (e) {
    // 동시 편집 등으로 sha 충돌(409) 시 한 번 재시도 (마지막 저장 우선)
    if (e instanceof Error && /\(409\)/.test(e.message)) {
      return await commitFile(cfg, content, 'Sync vault via app (retry)');
    }
    throw e;
  }
}
