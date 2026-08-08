import { useState } from 'react';
import type { GitHubConfig, Settings } from '../types';
import { CHAT_MODELS } from '../lib/gemini';
import {
  CLOUD_MODELS,
  TTS_ENGINES,
  synthCloud,
  voicesForEngine,
  defaultVoiceForEngine,
  defaultVoiceForModel,
  isQuotaError,
  markQuotaHit,
  isQuotaLocked,
} from '../lib/cloudtts';
import { encryptSecret } from '../lib/crypto';
import { buildVaultJson } from '../lib/vault';
import { encryptData, pushVault, type SyncData } from '../lib/sync';
import { speakBrowser, browserTtsSupported } from '../lib/browsertts';
import { defaultGitHub } from '../store';

interface Props {
  settings: Settings;
  syncData: SyncData;
  hasKey: boolean;
  sessionPassword: string | null;
  onSave: (s: Settings) => void;
  onSynced: (password: string) => void;
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
  syncData,
  hasKey,
  sessionPassword,
  onSave,
  onSynced,
  onClearKey,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Settings>({
    ...settings,
    github: settings.github ?? defaultGitHub,
  });

  const [cloudMsg, setCloudMsg] = useState('');
  const [, bumpQuota] = useState(0); // 미리듣기 한도감지 시 재렌더용

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

  const engine = draft.ttsEngine ?? 'cloudflare';
  const quotaLocked = isQuotaLocked(engine);

  /** 전체 동기화 데이터(구문·단어장·진도·설정·토큰)를 draft 기준으로 구성 */
  const buildFullData = (): SyncData => {
    const apiKey = (expKey.trim() || draft.apiKey || '').trim();
    return { ...syncData, settings: { ...draft, apiKey, github: gh } };
  };
  // 암호화에 쓸 비밀번호: 이미 잠금 해제됐으면 그 비번 재사용, 아니면 입력값 검증
  const resolvePassword = (): string => {
    if (sessionPassword) return sessionPassword;
    if (pw.length < 8) throw new Error('비밀번호는 8자 이상을 권장해요. (길수록 안전)');
    if (pw !== pw2) throw new Error('비밀번호 확인이 일치하지 않아요.');
    return pw;
  };

  const makeFile = async () => {
    setMsg('');
    setCommitUrl('');
    setBusy(true);
    try {
      const data = buildFullData();
      const password = resolvePassword();
      const dataEnc = await encryptData(data, password);
      const secret = data.settings.apiKey ? await encryptSecret(data.settings.apiKey, password) : undefined;
      setGenerated(buildVaultJson({ dataEnc, secret }));
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
      const data = buildFullData();
      const password = resolvePassword();
      onSave(data.settings); // 토큰·설정·API키 저장(브라우저)
      const url = await pushVault({ ...defaultGitHub, ...gh }, password, data);
      onSynced(password); // 세션 비번 유지 → 이후 자동 동기화
      setCommitUrl(url);
      setMsg('✅ GitHub에 저장했어요! 이제 변경할 때마다 자동으로 동기화돼요.');
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
          <label>음성 (클라우드 TTS)</label>
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
          {/* 엔진 선택 */}
          <select
            className="select"
            style={{ marginTop: 8 }}
            value={engine}
            onChange={(e) => {
              const ng = e.target.value as 'cloudflare' | 'google';
              setDraft({ ...draft, ttsEngine: ng, cloudVoice: defaultVoiceForEngine(ng, draft.ttsModel) });
            }}
          >
            {TTS_ENGINES.map((en) => (
              <option key={en.id} value={en.id}>
                {en.label}
              </option>
            ))}
          </select>
          {engine === 'cloudflare' && (
            <select
              className="select"
              style={{ marginTop: 8 }}
              value={draft.ttsModel ?? 'aura-1'}
              disabled={quotaLocked}
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
          )}
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <select
                className="select"
                style={{ flex: 1 }}
                value={draft.cloudVoice ?? defaultVoiceForEngine(engine, draft.ttsModel)}
                disabled={quotaLocked}
                onChange={(e) => setDraft({ ...draft, cloudVoice: e.target.value })}
              >
                {voicesForEngine(engine, draft.ttsModel).map((v) => (
                  <option key={v.id} value={v.id}>
                    {quotaLocked ? `🔒 ${v.label}` : v.label}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                type="button"
                disabled={quotaLocked}
                onClick={async () => {
                  setCloudMsg('재생 중…');
                  try {
                    const url = await synthCloud(
                      draft.ttsUrl || '',
                      draft.ttsSecret || '',
                      "I'm starting to like this app.",
                      draft.cloudVoice,
                      draft.ttsModel,
                      engine,
                    );
                    const audio = new Audio(url);
                    try {
                      await audio.play();
                      setCloudMsg('✓ 재생됐어요');
                    } catch {
                      setCloudMsg('브라우저가 재생을 막았어요. 한 번 더 눌러주세요.');
                    }
                  } catch (e) {
                    const emsg = (e instanceof Error ? e.message : String(e)).slice(0, 120);
                    if (isQuotaError(e)) {
                      markQuotaHit(engine);
                      bumpQuota((n) => n + 1);
                    }
                    // 폴백으로 브라우저 음성이 나더라도 '진짜 실패 이유'를 보여준다
                    if (browserTtsSupported()) speakBrowser("I'm starting to like this app.");
                    setCloudMsg('실패: ' + emsg + ' (브라우저 음성으로 대체 재생)');
                  }
                }}
              >
                ▶ 미리듣기
              </button>
            </div>
            {quotaLocked && (
              <p className="hint" style={{ margin: '8px 0 0', color: 'var(--muted)' }}>
                🔒 오늘 무료 음성 한도를 다 썼어요. 내일 리셋되며, 그동안 대화에서는 브라우저 음성으로
                재생돼요.
              </p>
            )}
            {cloudMsg && (
              <p className="hint" style={{ margin: '6px 0 0', color: cloudMsg.startsWith('✓') ? 'var(--good)' : cloudMsg.startsWith('실패') ? 'var(--danger)' : 'var(--muted)' }}>
                {cloudMsg}
              </p>
            )}
            {engine === 'google' ? (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                Google Cloud TTS는 <b>매월 100만 자 무료</b>. 워커에 <code>GOOGLE_TTS_KEY</code> 시크릿을
                넣고 재배포해야 동작해요 (<code>worker/README.md</code> 참고). 주소는 지금 것 그대로 사용.
              </p>
            ) : (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                무료 서버는 <code>worker/README.md</code> 안내대로 Cloudflare에 배포하면 돼요. 아이폰/패드/맥
                모두 빠르고 자연스러워요.
              </p>
            )}
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
          <div className="section-label">☁ 기기 간 동기화 (GitHub)</div>
          <p className="hint" style={{ margin: '0 0 14px' }}>
            구문·단어장·진도·설정·API 키를 <b>비밀번호로 암호화</b>해 저장하고, 이후엔{' '}
            <b>변경할 때마다 자동으로 동기화</b>돼요. 공개 저장소엔 암호문만 올라가고, GitHub 토큰도
            암호화되어 함께 저장돼서 다른 기기에선 <b>비밀번호만</b> 넣으면 이어서 볼 수 있어요.
          </p>

          {sessionPassword ? (
            <p className="hint" style={{ margin: '0 0 14px', color: 'var(--good)' }}>
              ✓ 이미 잠금 해제됨 — 비밀번호 재입력 없이 저장돼요.
            </p>
          ) : (
            <>
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
            </>
          )}

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
              {busyGit ? <span className="spinner" /> : '☁ 동기화 켜기 / 지금 저장'}
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
