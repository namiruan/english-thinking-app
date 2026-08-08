import type { WordEntry } from '../types';
import { catHue } from '../lib/ui';

interface Props {
  words: Record<string, WordEntry>;
  removeWord: (term: string) => void;
  clearWords: () => void;
}

export default function WordbookTab({ words, removeWord, clearWords }: Props) {
  const list = Object.values(words).sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1));

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="section-label" style={{ margin: 0 }}>단어장</div>
        {list.length > 0 && (
          <button className="btn sm ghost danger" onClick={clearWords}>
            모두 지우기
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        모르는 단어를 저장해 자주 복습하세요. 저장한 단어는 대화 중 자연스럽게 다시 등장해요. (대화의
        영어 단어를 <b>드래그</b>하면 뜻을 보고 저장할 수 있어요.)
      </p>

      {list.length === 0 ? (
        <div className="empty">
          아직 저장한 단어가 없어요.
          <br />
          대화 탭에서 영어 단어·숙어를 드래그해보세요.
        </div>
      ) : (
        <div className="card">
          {list.map((w) => (
            <div className="word-item" key={w.term}>
              <div className="word-top">
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <span className="word-term">{w.term}</span>
                  {w.sourceLabel &&
                    (w.source === 'chat' ? (
                      <span className="cat-badge" style={{ ['--h' as string]: 265 }}>
                        💬 {w.sourceLabel}
                      </span>
                    ) : (
                      <span className="cat-badge" style={{ ['--h' as string]: catHue(w.sourceLabel) }}>
                        📁 {w.sourceLabel}
                      </span>
                    ))}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="chip accent">{w.count}회</span>
                  <button className="btn sm ghost danger" onClick={() => removeWord(w.term)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="word-en">{w.english}</div>
              <div className="word-ko">{w.korean}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
