import { useState } from 'react';
import type { GrammarStat, Progress } from '../store';
import { computeStreak, weekCount, todayKey } from '../store';

interface Props {
  progress: Progress;
  clearProgress: () => void;
  grammarStats: Record<string, GrammarStat>;
  clearGrammar: () => void;
}

// 숙련 기준: Bloom 완전학습(Mastery Learning)의 80% + 성공률이 의미있으려면 최소 시도 수
const MASTERY_RATE = 0.8;
const MIN_ATTEMPTS = 5;

interface PhraseStat {
  text: string;
  clean: number;
  attempts: number;
  rate: number;
  pct: number;
  mastered: boolean;
  label: string;
  tone: string;
}

function mastery(text: string, clean: number, attempts: number): PhraseStat {
  const rate = attempts ? clean / attempts : 0;
  const pct = Math.round(rate * 100);
  const mastered = attempts >= MIN_ATTEMPTS && rate >= MASTERY_RATE;
  let label = '더 연습 필요';
  let tone = '';
  if (mastered) {
    label = '숙련 완료 ✓';
    tone = 'good';
  } else if (attempts < MIN_ATTEMPTS) {
    label = `연습 중 (${attempts}/${MIN_ATTEMPTS}회)`;
    tone = '';
  } else if (rate >= 0.5) {
    label = '익어가는 중';
    tone = 'accent';
  }
  return { text, clean, attempts, rate, pct, mastered, label, tone };
}

function PhraseRow({ p }: { p: PhraseStat }) {
  return (
    <div className="grammar-item">
      <div className="grammar-top">
        <span className="grammar-cat" style={{ fontFamily: 'var(--mono)' }}>{p.text}</span>
        <span className={`chip ${p.tone}`}>{p.label}</span>
      </div>
      <div className="grammar-bar">
        <span style={{ width: `${p.pct}%`, background: p.mastered ? 'var(--good)' : 'var(--accent)' }} />
      </div>
      <div className="grammar-ex" style={{ fontFamily: 'var(--sans)' }}>
        성공률 {p.pct}% · 정확 {p.clean}/{p.attempts}
      </div>
    </div>
  );
}

export default function HistoryTab({ progress, clearProgress, grammarStats, clearGrammar }: Props) {
  const streak = computeStreak(progress.daily);
  const today = progress.daily[todayKey()] ?? 0;
  const week = weekCount(progress.daily);
  const [showMastered, setShowMastered] = useState(false);

  const grammar = Object.values(grammarStats).sort((a, b) => b.count - a.count);
  const maxCount = grammar[0]?.count ?? 1;

  const phraseStats = Object.entries(progress.phrases).map(([text, p]) =>
    mastery(text, p.clean, p.attempts),
  );
  const learning = phraseStats
    .filter((p) => !p.mastered)
    .sort((a, b) => a.rate - b.rate || b.attempts - a.attempts); // 덜 익은 것 먼저
  const mastered = phraseStats.filter((p) => p.mastered).sort((a, b) => b.rate - a.rate);
  const phraseCount = phraseStats.length;

  const hasAny = today + week + phraseCount + grammar.length > 0;

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
      {phraseCount > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>구문별 숙련도</div>
            <button className="btn sm ghost danger" onClick={clearProgress}>
              지우기
            </button>
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <span className="chip good">숙련 완료 {mastered.length}</span>
            <span className="chip accent">연습 중 {learning.length}</span>
          </div>

          {learning.length > 0 ? (
            <div className="card">
              {learning.map((p) => (
                <PhraseRow key={p.text} p={p} />
              ))}
            </div>
          ) : (
            <div className="empty" style={{ padding: '20px 16px' }}>
              모든 구문을 숙련했어요! 🎉
            </div>
          )}

          {mastered.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                className="btn sm ghost"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowMastered((v) => !v)}
              >
                {showMastered ? '▾' : '▸'} 숙련 완료 {mastered.length}개{' '}
                {showMastered ? '숨기기' : '보기'}
              </button>
              {showMastered && (
                <div className="card" style={{ marginTop: 8 }}>
                  {mastered.map((p) => (
                    <PhraseRow key={p.text} p={p} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!hasAny && (
        <div className="empty">아직 학습 기록이 없어요. 대화 탭에서 연습을 시작해보세요.</div>
      )}
    </div>
  );
}
