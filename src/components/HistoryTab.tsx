import type { GrammarStat, Progress } from '../store';
import { computeStreak, weekCount, todayKey } from '../store';

interface Props {
  progress: Progress;
  clearProgress: () => void;
  grammarStats: Record<string, GrammarStat>;
  clearGrammar: () => void;
}

function mastery(clean: number): { label: string; pct: number } {
  const pct = Math.min(clean / 5, 1) * 100;
  if (clean >= 5) return { label: '숙련 ✓', pct };
  if (clean >= 3) return { label: '익어가는 중', pct };
  if (clean >= 1) return { label: '연습 중', pct };
  return { label: '더 연습 필요', pct };
}

export default function HistoryTab({ progress, clearProgress, grammarStats, clearGrammar }: Props) {
  const streak = computeStreak(progress.daily);
  const today = progress.daily[todayKey()] ?? 0;
  const week = weekCount(progress.daily);

  const grammar = Object.values(grammarStats).sort((a, b) => b.count - a.count);
  const maxCount = grammar[0]?.count ?? 1;

  const phrases = Object.entries(progress.phrases)
    .map(([text, p]) => ({ text, ...p }))
    .sort((a, b) => a.clean - b.clean || b.attempts - a.attempts); // 덜 익은 것 먼저

  const hasAny = today + week + phrases.length + grammar.length > 0;

  return (
    <div>
      {/* 학습 습관 */}
      <div className="row" style={{ gap: 10, marginBottom: 20 }}>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>연속</div>
          <div style={{ fontSize: 22, fontWeight: 680, whiteSpace: 'nowrap' }}>🔥 {streak}일</div>
        </div>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>오늘</div>
          <div style={{ fontSize: 22, fontWeight: 680 }}>{today}</div>
        </div>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>이번 주</div>
          <div style={{ fontSize: 22, fontWeight: 680 }}>{week}</div>
        </div>
      </div>

      {/* 자주 틀리는 문법 */}
      {grammar.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>자주 틀리는 문법</div>
            <button className="btn sm ghost danger" onClick={clearGrammar}>
              지우기
            </button>
          </div>
          <p className="hint" style={{ margin: '0 0 10px' }}>
            반복해서 나오는 문법은 집중 학습이 필요해요. 오타는 제외했어요.
          </p>
          <div className="card">
            {grammar.map((g) => (
              <div className="grammar-item" key={g.category}>
                <div className="grammar-top">
                  <span className="grammar-cat">{g.category}</span>
                  <span className="chip accent">{g.count}회</span>
                </div>
                <div className="grammar-bar">
                  <span style={{ width: `${Math.round((g.count / maxCount) * 100)}%` }} />
                </div>
                {g.notes && Object.keys(g.notes).length > 0 && (
                  <div className="grammar-notes">
                    {Object.entries(g.notes)
                      .sort((a, b) => b[1] - a[1])
                      .map(([note, cnt]) => (
                        <span className="chip" key={note}>
                          {note} {cnt}
                        </span>
                      ))}
                  </div>
                )}
                {g.example && <div className="grammar-ex">예: {g.example}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 구문별 숙련도 */}
      {phrases.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>구문별 숙련도</div>
            <button className="btn sm ghost danger" onClick={clearProgress}>
              지우기
            </button>
          </div>
          <p className="hint" style={{ margin: '0 0 10px' }}>
            올바르게 쓴 횟수 기준. 덜 익은 구문이 위에 있어요. (5회 = 숙련)
          </p>
          <div className="card">
            {phrases.map((p) => {
              const m = mastery(p.clean);
              return (
                <div className="grammar-item" key={p.text}>
                  <div className="grammar-top">
                    <span className="grammar-cat" style={{ fontFamily: 'var(--mono)' }}>{p.text}</span>
                    <span className={`chip ${p.clean >= 5 ? 'good' : ''}`}>{m.label}</span>
                  </div>
                  <div className="grammar-bar">
                    <span
                      style={{
                        width: `${m.pct}%`,
                        background: p.clean >= 5 ? 'var(--good)' : 'var(--accent)',
                      }}
                    />
                  </div>
                  <div className="grammar-ex" style={{ fontFamily: 'var(--sans)' }}>
                    정확 {p.clean} / 시도 {p.attempts}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasAny && (
        <div className="empty">아직 학습 기록이 없어요. 대화 탭에서 연습을 시작해보세요.</div>
      )}
    </div>
  );
}
