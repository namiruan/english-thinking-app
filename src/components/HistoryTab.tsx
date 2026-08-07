import type { HistoryEntry } from '../types';
import type { GrammarStat } from '../store';

interface Props {
  history: HistoryEntry[];
  clearHistory: () => void;
  grammarStats: Record<string, GrammarStat>;
  clearGrammar: () => void;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export default function HistoryTab({ history, clearHistory, grammarStats, clearGrammar }: Props) {
  const totalClean = history.reduce((s, h) => s + h.cleanCount, 0);
  const totalTurns = history.reduce((s, h) => s + h.turns, 0);
  const grammar = Object.values(grammarStats).sort((a, b) => b.count - a.count);
  const maxCount = grammar[0]?.count ?? 1;

  return (
    <div>
      {/* 반복되는 문법 약점 */}
      {grammar.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>
              자주 틀리는 문법
            </div>
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
                {g.example && <div className="grammar-ex">예: {g.example}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>세션</div>
          <div style={{ fontSize: 22, fontWeight: 680 }}>{history.length}</div>
        </div>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>총 대화</div>
          <div style={{ fontSize: 22, fontWeight: 680 }}>{totalTurns}</div>
        </div>
        <div className="card" style={{ flex: 1, padding: '14px 16px' }}>
          <div className="section-label" style={{ margin: 0 }}>Clean</div>
          <div style={{ fontSize: 22, fontWeight: 680, color: 'var(--good)' }}>{totalClean}</div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="empty">아직 연습 기록이 없어요. 대화 탭에서 연습을 시작해보세요.</div>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>최근 기록</div>
            <button className="btn sm ghost danger" onClick={clearHistory}>
              기록 지우기
            </button>
          </div>
          <div className="card">
            {history.map((h) => (
              <div className="hist-item" key={h.id}>
                <div>
                  <div className="h-phrase">{h.phraseText}</div>
                  <div className="h-meta">
                    {h.categoryName} · {h.mode === 'focus' ? '집중' : '자유'} · {fmtDate(h.date)}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="chip">대화 {h.turns}</span>
                  <span className="chip good">Clean {h.cleanCount}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
