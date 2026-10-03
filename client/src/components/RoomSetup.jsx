import { useState } from 'react';
import Settings from './Settings';
import TrickCatalog from './TrickCatalog';
import RoomChat from './RoomChat';
import PlayerMenu from './PlayerMenu';
import { voiceSlotRef } from '../voiceSlot';
import { PlayerProfile } from './Profile';
import Avatar from './Avatar';
import { nameplateProps } from '../nameplates';

const MAX_BUY_IN = 10000;

// Fixed blind tiers -- these do NOT scale with buy-in, by design. Anything else is 'custom'.
const BLIND_PRESETS = [
  { id: 't1', label: '10 / 20', smallBlind: 10, bigBlind: 20 },
  { id: 't2', label: '20 / 40', smallBlind: 20, bigBlind: 40 },
];

// Hands per normal match, as the server's normalizeHandLimit: none, or a whole number 2 to 99.
const HAND_LIMITS = [['none', '不限'], ['8', '8 局'], ['16', '16 局'], ['custom', '自定义']];
const normalizeHandLimit = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(99, Math.max(2, n)) : '';
};

// The server's customBlinds rules: whole tens, a small blind of at least 10, a big blind no smaller.
function normalizeBlinds(smallBlind, bigBlind) {
  const tens = (value) => (Number(value) > 0 ? Math.round(Number(value) / 10) * 10 : null);
  const small = Math.min(MAX_BUY_IN, Math.max(10, tens(smallBlind) ?? 10));
  const big = Math.min(MAX_BUY_IN, Math.max(small, tens(bigBlind) ?? small * 2));
  return { smallBlind: small, bigBlind: big };
}

export default function RoomSetup({ room, me, onConfig, onStart, onLeave, onKick, onAddBot, onAddFriend, onOpenFriends }) {
  const isHost = room.hostPlayerId === me.playerId;
  const [buyIn, setBuyIn] = useState(room.buyIn);
  const [presetId, setPresetId] = useState(() =>
    BLIND_PRESETS.find((p) => p.smallBlind === room.smallBlind && p.bigBlind === room.bigBlind)?.id || 'custom'
  );
  const [customBlinds, setCustomBlinds] = useState({ smallBlind: room.smallBlind, bigBlind: room.bigBlind });
  const [raiseMode, setRaiseMode] = useState(room.raiseMode || 'unlimited');
  const [gameMode, setGameMode] = useState(room.gameMode || 'normal');
  const [handLimit, setHandLimit] = useState(room.handLimit || '');
  const [limitMode, setLimitMode] = useState(() =>
    !room.handLimit ? 'none' : [8, 16].includes(room.handLimit) ? String(room.handLimit) : 'custom');
  const [customLimit, setCustomLimit] = useState(room.handLimit || 24);
  const [maxPotPerRound, setMaxPotPerRound] = useState(room.maxPotPerRound || '');
  const [maxPotPerHand, setMaxPotPerHand] = useState(room.maxPotPerHand || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [pane, setPane] = useState('players');
  const [profilePlayer, setProfilePlayer] = useState(null);

  const count = room.players.length;
  const sufficientBuyIn = room.buyIn >= room.bigBlind;
  const canStart = count >= 2 && count <= 10 && sufficientBuyIn;

  function applyConfig(next) {
    const merged = {
      buyIn,
      blindPresetId: presetId,
      ...customBlinds,
      raiseMode,
      gameMode,
      handLimit,
      maxPotPerRound,
      maxPotPerHand,
      ...next,
    };
    setBuyIn(merged.buyIn);
    setPresetId(merged.blindPresetId);
    setCustomBlinds({ smallBlind: merged.smallBlind, bigBlind: merged.bigBlind });
    setRaiseMode(merged.raiseMode);
    setGameMode(merged.gameMode);
    setHandLimit(merged.handLimit);
    setMaxPotPerRound(merged.maxPotPerRound);
    setMaxPotPerHand(merged.maxPotPerHand);
    onConfig(merged);
  }

  function chooseLimit(mode) {
    setLimitMode(mode);
    applyConfig({ handLimit: mode === 'none' ? '' : mode === 'custom' ? normalizeHandLimit(customLimit) : Number(mode) });
  }

  return (
    <div className="room-setup">
      <div className="room-code-banner">
        <div><span className="eyebrow">房间号</span><div className="room-code">{room.code}</div></div>
        <div className="room-code-tools">
          <span className="voice-slot" ref={voiceSlotRef} />
          <button className="subtle-btn" onClick={onOpenFriends}>邀请好友</button>
          <button className="subtle-btn" onClick={() => setShowSettings(true)}>设置</button>
        </div>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showCatalog && <TrickCatalog onClose={() => setShowCatalog(false)} />}
      {profilePlayer && room.players.some((p) => p.id === profilePlayer) && (
        <PlayerProfile player={room.players.find((p) => p.id === profilePlayer)} onClose={() => setProfilePlayer(null)} />
      )}
      {/* On a phone the two panels share the screen through these tabs; the actions stay pinned below. */}
      <div className={`setup-layout show-${pane}`}>
      <div className="setup-tabs" role="tablist" aria-label="房间内容">
        <button type="button" role="tab" aria-selected={pane === 'players'} className={pane === 'players' ? 'active' : ''}
          onClick={() => setPane('players')}>同桌玩家 {count}</button>
        <button type="button" role="tab" aria-selected={pane === 'rules'} className={pane === 'rules' ? 'active' : ''}
          onClick={() => setPane('rules')}>牌局规则</button>
      </div>
      <section className="setup-rules" aria-labelledby="rules-heading">
      <div className="section-heading"><h2 id="rules-heading">牌局规则</h2></div>
      {isHost ? (
        <div className="host-config">
          <label>
            <span className="field-caption">初始筹码 <small>每人最多 {MAX_BUY_IN}</small></span>
            <input
              type="number"
              min={100}
              max={MAX_BUY_IN}
              step={10}
              value={buyIn}
              onChange={(e) =>
                applyConfig({ buyIn: Math.min(MAX_BUY_IN, Number(e.target.value) || 0) })
              }
            />
          </label>
          <div className="blind-field"><span className="field-caption">盲注 <small>小盲 / 大盲</small></span>
          <div className="blind-presets blind-tiers">
            {BLIND_PRESETS.map((p) => (
              <button
                key={p.id}
                className={presetId === p.id ? 'active' : ''}
                aria-pressed={presetId === p.id}
                onClick={() => applyConfig({ blindPresetId: p.id })}
              >
                {p.label}
              </button>
            ))}
            <button className={presetId === 'custom' ? 'active' : ''} aria-pressed={presetId === 'custom'}
              onClick={() => applyConfig({ blindPresetId: 'custom', ...normalizeBlinds(customBlinds.smallBlind, customBlinds.bigBlind) })}>
              自定义
            </button>
          </div>
          {presetId === 'custom' && (
            // Sent when a field is left, so a half-typed number is never rounded under the cursor.
            <div className="custom-blinds">
              {[['smallBlind', '小盲'], ['bigBlind', '大盲']].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input type="number" min={10} max={MAX_BUY_IN} step={10} value={customBlinds[key]}
                    onChange={(e) => setCustomBlinds((blinds) => ({ ...blinds, [key]: e.target.value }))}
                    onBlur={() => applyConfig({ blindPresetId: 'custom', ...normalizeBlinds(customBlinds.smallBlind, customBlinds.bigBlind) })}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                </label>
              ))}
            </div>
          )}
          </div>

          <div className="blind-field">
            <span className="field-caption">游戏模式
              <button type="button" className="field-caption-btn" onClick={() => setShowCatalog(true)}>千术图鉴</button>
            </span>
            <div className="blind-presets game-mode-options">
              <button className={gameMode === 'normal' ? 'active' : ''} aria-pressed={gameMode === 'normal'}
                onClick={() => applyConfig({ gameMode: 'normal' })}>
                <strong>经典牌局</strong><small>{handLimit ? `标准德州，共 ${handLimit} 局` : '标准德州，不限局数'}</small>
              </button>
              <button className={gameMode === 'tricks' ? 'active' : ''} aria-pressed={gameMode === 'tricks'}
                onClick={() => applyConfig({ gameMode: 'tricks' })}>
                <strong>千术模式</strong><small>共 16 局</small>
              </button>
            </div>
          </div>

          {gameMode === 'normal' && (
            <div className="blind-field">
              <span className="field-caption">局数</span>
              <div className="blind-presets hand-limits">
                {HAND_LIMITS.map(([mode, label]) => (
                  <button key={mode} className={limitMode === mode ? 'active' : ''} aria-pressed={limitMode === mode}
                    onClick={() => chooseLimit(mode)}>{label}</button>
                ))}
              </div>
              {limitMode === 'custom' && (
                <div className="custom-blinds">
                  <label>
                    局数
                    <input type="number" min={2} max={99} step={1} value={customLimit}
                      onChange={(e) => setCustomLimit(e.target.value)}
                      onBlur={() => { const n = normalizeHandLimit(customLimit) || 24; setCustomLimit(n); applyConfig({ handLimit: n }); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="blind-field">
            <span className="field-caption">加注规则</span>
            <div className="blind-presets">
              <button
                className={raiseMode === 'unlimited' ? 'active' : ''}
                aria-pressed={raiseMode === 'unlimited'}
                onClick={() => applyConfig({ raiseMode: 'unlimited' })}
              >
                不限次数
              </button>
              <button
                className={raiseMode === 'single' ? 'active' : ''}
                aria-pressed={raiseMode === 'single'}
                onClick={() => applyConfig({ raiseMode: 'single' })}
              >
                每轮限一次
              </button>
            </div>
          </div>

          <div className="bet-limit-fields">
          <label>
            单轮下注上限
            <input
              type="number"
              min={10}
              step={10}
              placeholder="不限"
              value={maxPotPerRound}
              onChange={(e) => applyConfig({ maxPotPerRound: e.target.value })}
            />
          </label>

          <label>
            整局下注上限
            <input
              type="number"
              min={10}
              step={10}
              placeholder="不限"
              value={maxPotPerHand}
              onChange={(e) => applyConfig({ maxPotPerHand: e.target.value })}
            />
          </label>
          </div>
        </div>
      ) : (
        <dl className="room-rule-summary">
          <div><dt>初始筹码</dt><dd>{room.buyIn}</dd></div>
          <div><dt>小盲 / 大盲</dt><dd>{room.smallBlind} / {room.bigBlind}</dd></div>
          <div><dt>加注规则</dt><dd>{room.raiseMode === 'single' ? '每轮限一次' : '不限次数'}</dd></div>
          <div><dt>游戏模式</dt><dd>{room.gameMode === 'tricks' ? '千术模式（16 局）' : room.handLimit ? `经典牌局（${room.handLimit} 局）` : '经典牌局（不限局数）'}
            <button type="button" className="field-caption-btn" onClick={() => setShowCatalog(true)}>千术图鉴</button></dd></div>
          <div><dt>单轮下注上限</dt><dd>{room.maxPotPerRound || '不限'}</dd></div>
          <div><dt>整局下注上限</dt><dd>{room.maxPotPerHand || '不限'}</dd></div>
        </dl>
      )}
      </section>
      <section className="setup-players" aria-labelledby="players-heading">
      <div className="section-heading"><h2 id="players-heading">同桌玩家</h2>
        <div className="section-heading-tools">
          {isHost && count < 10 && <button type="button" className="add-bot-btn" onClick={onAddBot}>+ 机器人</button>}
          <span>{count} / 10 人</span>
        </div>
      </div>
      <ul className="player-list">
        {room.players.map((p) => {
          const plate = nameplateProps(p.nameplate);
          return (
          <li key={p.id} className={[p.connected ? '' : 'disconnected', plate.className].join(' ')} style={plate.style}>
            <Avatar avatar={p.avatar} name={p.name} className="player-avatar" />
            <span className="player-list-name">{p.name}{p.id === me.playerId && <small>你</small>}</span>
            {p.id === room.hostPlayerId && <span className="badge">房主</span>}
            {!p.connected && <span className="badge muted">离线</span>}
            {p.id !== me.playerId && (
              <PlayerMenu name={p.name} onProfile={() => setProfilePlayer(p.id)}
                onAddFriend={p.bot ? null : () => onAddFriend(p.id)}
                onKick={isHost && p.id !== room.hostPlayerId ? () => onKick(p.id) : null} />
            )}
          </li>
          );
        })}
      </ul>
        {room.history && room.history.length > 0 && (
          <div className="room-history">
            <h3>房间战绩</h3>
            {room.history
              .slice()
              .reverse()
              .map((g) => (
                <div key={g.number} className="history-round">
                  <div className="history-round-title">{`第 ${g.number} 局`}</div>
                  <ol className="ranking">
                    {g.results.map((r, i) => (
                      <li key={r.playerId}>
                        <span className="rank-pos">{i + 1}</span>
                        <span className="rank-name">{r.name}</span>
                        <span className="rank-chips">{r.chips}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        )}
      </section>
      <RoomChat me={me} />
      <div className="setup-actions">
      {isHost ? (
        <button className="primary" disabled={!canStart} onClick={onStart}>
          {!sufficientBuyIn ? `初始筹码至少需要 ${room.bigBlind}` : canStart ? '开始游戏' : '至少需要 2 名玩家'}
        </button>
      ) : (
        <div className="waiting-note">等待房主开始</div>
      )}
      <button type="button" className="leave-room-btn" onClick={onLeave}>离开房间</button>
      </div>
      </div>

    </div>
  );
}
