import { useState } from 'react';
import type { Category, GitHubConfig, Settings } from '../types';
import { CHAT_MODELS } from '../lib/gemini';
import {
  CLOUD_MODELS,
  synthCloud,
  voicesForModel,
  defaultVoiceForModel,
} from '../lib/cloudtts';
import { encryptSecret, type EncryptedBlob } from '../lib/crypto';
import { buildVaultJson } from '../lib/vault';
import { commitFile } from '../lib/github';
import { defaultGitHub } from '../store';

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
  const [draft, setDraft] = useState<Settings>({
    ...settings,
    github: settings.github ?? defaultGitHub,
  });

  const [cloudMsg, setCloudMsg] = useState('');

  // vault 생성용
  const [expKey, setExpKey] = useState(settings.apiKey || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [generated, setGenerated] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyGit, setBusyGit] = useState(false);
  const [msg, setMsg] = useState('');
  const [commitUrl, setCommitUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const gh: GitHubConfig = draft.github ?? defaultGitHub;
  const setGh = (patch: Partial<GitHubConfig>) => setDraft({ ...draft, github: { ...gh, ...patch } });

  /** 새 secret 계산 (키 입력 시 암호화, 아니면 기존 잠금 유지) */
  const resolveSecret = async (): Promise<EncryptedBlob | undefined> => {
    if (expKey.trim()) {
      if (pw.length < 8) throw new Error('비밀번호는 8자 이상을 권장해요. (길수록 안전)');
      if (pw !== pw2) throw new Error('비밀번호 확인이 일치하지 않아요.');
      return encryptSecret(expKey.trim(), pw);
    }
    return vaultSecret; // 구문만 갱신, 기존 잠금 유지
  };

  const makeFile = async () => {
    setMsg('');
    setCommitUrl('');
    setBusy(true);
    try {
      const secret = await resolveSecret();
      setGenerated(buildVaultJson(categories, secret));
      setMsg('파일을 만들었어요. 다운로드하거나 GitHub에 바로 저장하세요.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveToGitHub = async () => {
    setMsg('');
    setCommitUrl('');
    if (!gh.token) {
      setMsg('GitHub 토큰을 입력해주세요.');
      return;
    }
    setBusyGit(true);
    try {
      const secret = await resolveSecret();
      const content = buildVaultJson(categories, secret);
      setGenerated(content);
      onSave(draft); // 토큰·설정 저장(브라우저)
      const url = await commitFile(gh, content, 'Update vault via app');
      setCommitUrl(url);
      setMsg('✅ GitHub에 저장했어요! 약 30초 후 라이브에 반영됩니다.');
    } catch (e) {
      setMsg('저장 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyGit(false);
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
          <label>대화·사전 모델</label>
          {(() => {
            const cur = draft.model || 'gemini-3.5-flash-lite';
            const isPreset = CHAT_MODELS.some((m) => m.id === cur);
            return (
              <>
                <select
                  className="select"
                  value={isPreset ? cur : '__custom__'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: e.target.value === '__custom__' ? ' ' : e.target.value,
                    })
                  }
                >
                  {CHAT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  <option value="__custom__">직접 입력…</option>
                </select>
                {!isPreset && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    placeholder="모델 ID 직접 입력 (예: gemini-3.6-flash)"
                    value={(draft.model ?? '').trim()}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })}
                    autoFocus
                  />
                )}
              </>
            );
          })()}
          <p className="hint" style={{ margin: '6px 0 0' }}>
            "모델을 쓸 수 없다"(404)거나 한도(429)가 자주 뜨면 다른 모델로 바꾸세요. 계정에서 지원하는
            정확한 ID는{' '}
            <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">
              대시보드
            </a>
            에서 확인.
          </p>
        </div>

        <div className="field">
          <label>음성 (클라우드 TTS · Cloudflare)</label>
          <input
            className="input"
            placeholder="https://et-tts.xxx.workers.dev"
            value={draft.ttsUrl ?? ''}
            onChange={(e) => setDraft({ ...draft, ttsUrl: e.target.value.trim() })}
          />
          <input
            className="input"
            style={{ marginTop: 8 }}
            type="password"
            placeholder="시크릿 (설정했다면)"
            value={draft.ttsSecret ?? ''}
            onChange={(e) => setDraft({ ...draft, ttsSecret: e.target.value })}
          />
          <select
            className="select"
            style={{ marginTop: 8 }}
            value={draft.ttsModel ?? 'aura-1'}
            onChange={(e) =>
              setDraft({
                ...draft,
                ttsModel: e.target.value,
                cloudVoice: defaultVoiceForModel(e.target.value),
              })
            }
          >
            {CLOUD_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <select
                className="select"
                style={{ flex: 1 }}
                value={draft.cloudVoice ?? defaultVoiceForModel(draft.ttsModel)}
                onChange={(e) => setDraft({ ...draft, cloudVoice: e.target.value })}
              >
                {voicesForModel(draft.ttsModel).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  setCloudMsg('재생 중…');
                  try {
                    const url = await synthCloud(
                      draft.ttsUrl || '',
                      draft.ttsSecret || '',
                      "I'm starting to like this app.",
                      draft.cloudVoice,
                      draft.ttsModel,
                    );
                    new Audio(url).play();
                    setCloudMsg('✓ 연결 성공');
                  } catch (e) {
                    setCloudMsg('실패: ' + (e instanceof Error ? e.message : String(e)));
                  }
                }}
              >
                ▶ 미리듣기
              </button>
            </div>
            {cloudMsg && (
              <p className="hint" style={{ margin: '6px 0 0', color: cloudMsg.startsWith('✓') ? 'var(--good)' : cloudMsg.startsWith('실패') ? 'var(--danger)' : 'var(--muted)' }}>
                {cloudMsg}
              </p>
            )}
            <p className="hint" style={{ margin: '8px 0 0' }}>
              무료 서버는 <code>worker/README.md</code> 안내대로 Cloudflare에 배포하면 돼요. 아이폰/패드/맥
              모두 빠르고 자연스러워요.
            </p>
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

        {/* ── git에 저장 (암호화 + 자동 커밋) ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <div className="section-label">🔐 git에 저장 (vault.json)</div>
          <p className="hint" style={{ margin: '0 0 14px' }}>
            API 키를 <b>비밀번호로 암호화</b>해 저장해요. 원본 키는 저장되지 않고, 공개돼도 비밀번호
            없이는 열 수 없어요. 구문도 함께 저장됩니다. (키를 비우면 기존 잠금은 그대로 두고 구문만
            갱신)
          </p>

          <div className="field" style={{ marginBottom: 10 }}>
            <label>암호화할 API 키 (선택)</label>
            <input
              className="input"
              type="password"
              placeholder="새로 잠글 Gemini API 키"
              value={expKey}
              onChange={(e) => setExpKey(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
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

          {/* GitHub 자동 저장 */}
          <div className="field" style={{ marginBottom: 8 }}>
            <label>GitHub 토큰 (자동 저장용)</label>
            <input
              className="input"
              type="password"
              placeholder="github_pat_..."
              value={gh.token}
              onChange={(e) => setGh({ token: e.target.value.trim() })}
            />
            <p className="hint" style={{ margin: '6px 0 0' }}>
              이 저장소 <b>Contents 쓰기</b> 권한만 있는{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                fine-grained 토큰
              </a>{' '}
              권장. 토큰은 이 브라우저에만 저장돼요.{' '}
              <a style={{ cursor: 'pointer' }} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '고급 숨기기' : '고급 설정'}
              </a>
            </p>
          </div>

          {showAdvanced && (
            <div className="row" style={{ marginBottom: 12, gap: 8 }}>
              <input className="input" placeholder="owner" value={gh.owner} onChange={(e) => setGh({ owner: e.target.value.trim() })} style={{ flex: 1 }} />
              <input className="input" placeholder="repo" value={gh.repo} onChange={(e) => setGh({ repo: e.target.value.trim() })} style={{ flex: 1 }} />
              <input className="input" placeholder="branch" value={gh.branch} onChange={(e) => setGh({ branch: e.target.value.trim() })} style={{ width: 90 }} />
            </div>
          )}

          <div className="row">
            <button className="btn primary" onClick={saveToGitHub} disabled={busyGit || busy}>
              {busyGit ? <span className="spinner" /> : '🚀 GitHub에 바로 저장'}
            </button>
            <button className="btn" onClick={makeFile} disabled={busy || busyGit}>
              {busy ? <span className="spinner" /> : '파일만 만들기'}
            </button>
          </div>

          {msg && (
            <p className="hint" style={{ margin: '10px 0 0', color: msg.startsWith('✅') ? 'var(--good)' : msg.startsWith('저장 실패') || msg.includes('일치') || msg.includes('8자') || msg.includes('토큰') ? 'var(--danger)' : 'var(--accent)' }}>
              {msg}
              {commitUrl && (
                <>
                  {' '}
                  <a href={commitUrl} target="_blank" rel="noreferrer">
                    커밋 보기
                  </a>
                </>
              )}
            </p>
          )}

          {generated && (
            <div style={{ marginTop: 12 }}>
              <textarea className="input" readOnly rows={5} value={generated} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => download('vault.json', generated)}>
                  ⬇ 다운로드
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
