/**
 * GitHub Contents API로 파일을 직접 커밋한다. (브라우저에서 호출)
 * - 토큰은 이 저장소 Contents 쓰기 권한만 가진 fine-grained PAT 권장.
 * - 토큰은 vault.json에 저장되지 않으며(설정 localStorage에만), 커밋 내용에도 포함되지 않는다.
 */

const API = 'https://api.github.com';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function errorMessage(res: Response): Promise<string> {
  let detail = res.statusText;
  try {
    const j = await res.json();
    if (j?.message) detail = j.message;
  } catch {
    /* ignore */
  }
  if (res.status === 401) return '토큰이 유효하지 않거나 만료됐어요. (401)';
  if (res.status === 403) return '권한이 부족해요. 토큰에 이 저장소의 Contents(쓰기) 권한이 있는지 확인하세요. (403)';
  if (res.status === 404) return '저장소/경로를 찾을 수 없어요. owner·repo·branch를 확인하세요. (404)';
  if (res.status === 409) return '충돌이 발생했어요. 잠시 후 다시 시도해주세요. (409)';
  return `GitHub 오류 (${res.status}): ${detail}`;
}

/** 현재 파일의 sha (업데이트에 필요). 없으면 null(신규 파일). */
async function getFileSha(cfg: GitHubConfig): Promise<string | null> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${encodeURIComponent(
    cfg.branch,
  )}`;
  const res = await fetch(url, { headers: authHeaders(cfg.token), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorMessage(res));
  const json = await res.json();
  return (json?.sha as string) ?? null;
}

/** vault.json 등 파일을 커밋한다. 성공 시 커밋 URL 반환. */
export async function commitFile(
  cfg: GitHubConfig,
  content: string,
  message: string,
): Promise<string> {
  if (!cfg.token) throw new Error('GitHub 토큰을 입력해주세요.');
  const sha = await getFileSha(cfg);
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
    method: 'PUT',
    headers: { ...authHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(content),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  const json = await res.json();
  return (json?.commit?.html_url as string) ?? '';
}
