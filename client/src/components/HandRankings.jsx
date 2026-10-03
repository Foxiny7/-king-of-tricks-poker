import Card from './Card';
import { HAND_RANKINGS_ZH } from '../handNames';

export default function HandRankings({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>牌型大小（从大到小）</h3>
          <button className="link-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <ol className="hand-rankings">
          {HAND_RANKINGS_ZH.map(({ name, nameEn, cards }, i) => (
            <li key={name}>
              <span className="rank-pos">{i + 1}</span>
              <span className="rank-name-col">
                {name}
                <small className="rank-name-en">{nameEn}</small>
              </span>
              <span className="rank-example">
                {cards.map((c, j) => (
                  <Card key={j} code={c} />
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
