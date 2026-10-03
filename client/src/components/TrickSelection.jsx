import { useEffect, useState } from 'react';

const RARITY = { common: '普通', rare: '罕见', epic: '史诗', legendary: '传说' };
const KIND = { passive: '被动', read: '情报', change: '行动' };

export default function TrickSelection({ room, onChoose, onRefresh }) {
  const match = room.trickMatch;
  const selection = match.selection;
  const [remaining, setRemaining] = useState(30);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((selection.deadline - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [selection.deadline]);

  // Every selection has its own deadline. Catch-up picks can follow each other within one phase,
  // so the lock after choosing must lift with each new selection, not only a new phase.
  useEffect(() => {
    setSubmitted(false);
  }, [selection.phase, selection.deadline]);

  function choose(trickId) {
    if (submitted) return;
    setSubmitted(true);
    onChoose(trickId, () => setSubmitted(false));
  }

  return (
    <main className="trick-selection">
      <div className="trick-selection-topline">
        <span>千术模式</span>
        <span>房间 {room.code}</span>
      </div>
      <div className="trick-phase-track" aria-label="四个阶段，每阶段选一次千术并进行四局">
        {[1, 2, 3, 4].map((phase) => (
          <div key={phase} className={`trick-phase-node ${phase === selection.phase ? 'current' : phase < selection.phase ? 'done' : ''}`}>
            <span className="trick-phase-number">{phase}-1</span>
            <span>{phase === selection.phase ? '选千术' : phase < selection.phase ? '已完成' : '待开启'}</span>
          </div>
        ))}
      </div>

      <section className="trick-selection-main" aria-labelledby="trick-select-title">
        <div className="trick-selection-heading">
          <div>
            <h1 id="trick-select-title">{selection.catchup ? '补选千术' : `第 ${selection.phase} 阶段：选择千术`}</h1>
          </div>
          <div className="trick-selection-clock" aria-live="off">
            <strong>{remaining}</strong><span>秒后自动选择</span>
          </div>
        </div>

        {selection.chosen ? (
          <div className="trick-selection-waiting" role="status">
            <h2>已选择</h2>
            <p>等待其他玩家（{selection.chosenCount}/{selection.totalCount}）</p>
          </div>
        ) : selection.offers.length ? (
          <div className="trick-offer-grid">
            {selection.offers.map((trick, index) => (
              <div key={trick.slotIndex} className="trick-offer-slot">
              <button type="button" className={`trick-offer-card rarity-${trick.rarity}`}
                disabled={submitted} onClick={() => choose(trick.id)}>
                <span className="trick-card-meta">
                  <span className="trick-card-rarity">{RARITY[trick.rarity]}</span>
                  <span className="trick-card-kind">{KIND[trick.kind]}</span>
                </span>
                <strong>{trick.name}</strong>
                <span className="trick-card-description">{trick.description}</span>
                <span className="trick-card-details">
                  {(trick.kind !== 'passive' || trick.id === 'trick_reflect' || trick.id === 'strategy_card') &&
                    <span><b>次数</b>{trick.usage}</span>}
                  <span><b>条件</b>{trick.condition}</span>
                </span>
                {trick.autoUpgradeTo && <span className="trick-card-upgrade">选中后升级为 {trick.autoUpgradeTo}</span>}
                {trick.bonusCommon && <span className="trick-card-upgrade">选中后额外赠送一项随机普通千术</span>}
                <span className="trick-card-select">选择</span>
              </button>
              <button type="button" className="trick-offer-refresh"
                aria-label={`刷新候选 ${index + 1}`}
                disabled={submitted || (selection.refreshCounts?.[trick.slotIndex] || 0) >= selection.refreshLimit}
                onClick={() => onRefresh(trick.slotIndex)}>
                {(selection.refreshCounts?.[trick.slotIndex] || 0) >= selection.refreshLimit
                  ? '已无刷新次数' : `换一张（剩 ${selection.refreshLimit - (selection.refreshCounts?.[trick.slotIndex] || 0)} 次）`}
              </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="trick-selection-waiting" role="status">等待本阶段选术结束</div>
        )}

      </section>

      {match.owned.length > 0 && (
        <aside className="trick-owned-summary" aria-label="我的千术">
          <span>已持有</span>
          {match.owned.map((trick) => <span key={trick.id} className={`rarity-${trick.rarity}`}>{trick.name}</span>)}
        </aside>
      )}
    </main>
  );
}
