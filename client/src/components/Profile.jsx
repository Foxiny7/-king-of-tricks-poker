import { useEffect, useState } from 'react';
import { socket } from '../socket';
import GameWindow from './GameWindow';
import Avatar from './Avatar';
import AvatarPicker from './AvatarPicker';
import Card from './Card';
import { translateHandName } from '../handNames';
import { NAMEPLATES, nameplateOf, nameplateProps } from '../nameplates';
import { BIO_MAX_LENGTH } from '../bio';

const TABS = [
  { id: 'info', label: '资料' },
  { id: 'record', label: '战绩' },
  { id: 'plate', label: '铭牌' },
];
// Skins are picked in 藏品 (Collection.jsx).
const MODES = [
  { id: 'all', label: '全部' },
  { id: 'normal', label: '经典牌局' },
  { id: 'tricks', label: '千术模式' },
];
const MODE_NAME = { normal: '经典', tricks: '千术' };
const DAY_MS = 24 * 60 * 60 * 1000;
const beijingParts = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Every date on this page is Beijing time, the same clock the weekly reset uses.
function beijing(ms) {
  const part = Object.fromEntries(beijingParts.formatToParts(ms).map(({ type, value }) => [type, value]));
  return { day: `${part.month}月${part.day}日`, moment: `${part.month}月${part.day}日 ${part.weekday} ${part.hour}:${part.minute}` };
}

function useProfileRecord(nickname) {
  const [record, setRecord] = useState(() => ({ status: nickname ? 'loading' : 'no-name' }));
  useEffect(() => {
    if (!nickname) {
      setRecord({ status: 'no-name' });
      return undefined;
    }
    let live = true;
    // Typing a new nickname re-reads that name's record once the typing pauses.
    const timer = setTimeout(() => {
      socket.timeout(5000).emit('get_profile', { name: nickname }, (err, res) => {
        if (!live) return;
        if (err || !res?.ok) setRecord({ status: 'error' });
        else setRecord({ status: 'ready', ...res });
      });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [nickname]);
  return record;
}

function StatTile({ value, label }) {
  return <div className="profile-stat"><strong>{value}</strong><span>{label}</span></div>;
}

function StatTiles({ record }) {
  const ready = record.status === 'ready';
  return (
    <div className="profile-stats">
      <StatTile value={ready ? record.stats?.played ?? 0 : '—'} label="总对局数" />
      <StatTile value={ready && record.stats?.bestScore != null ? record.stats.bestScore.toLocaleString() : '—'} label="最高得分" />
      <StatTile value={ready && record.matches?.[0] ? record.matches[0].score.toLocaleString() : '—'} label="最近得分" />
      <StatTile value={ready && record.best ? translateHandName(record.best.handName) : '—'} label="本周最大牌型" />
    </div>
  );
}

function InfoPage({ name, onName, avatar, onAvatar, bio, onBio, plate, record }) {
  const [picking, setPicking] = useState(false);
  const look = nameplateProps(plate.id);
  return (
    <>
      <section className={`profile-card ${look.className}`} style={look.style}>
        <div className="profile-card-avatar">
          <Avatar avatar={avatar} name={name} className="profile-avatar" />
          <button type="button" className="profile-avatar-change" aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}>{picking ? '收起' : '更换'}</button>
        </div>
        <div className="profile-card-fields">
          <label className="profile-field">
            <span>昵称</span>
            <input type="text" value={name} maxLength={20} placeholder="你的名字" onChange={(e) => onName(e.target.value)} />
          </label>
          <label className="profile-field">
            <span>个人介绍</span>
            <input type="text" value={bio} maxLength={BIO_MAX_LENGTH} placeholder="一句话介绍自己" onChange={(e) => onBio(e.target.value)} />
          </label>
        </div>
      </section>
      {picking && <AvatarPicker avatar={avatar} name={name} onPick={(next) => { onAvatar(next); setPicking(false); }} />}
      <StatTiles record={record} />
    </>
  );
}

function RecordStatus({ record }) {
  if (record.status === 'no-name') return <p className="profile-empty">还没有填写昵称</p>;
  if (record.status === 'loading') return <p className="profile-empty">正在读取记录…</p>;
  return <p className="profile-empty">暂时无法读取记录</p>;
}

function RecordPage({ record }) {
  const [mode, setMode] = useState('all');
  if (record.status !== 'ready') return <RecordStatus record={record} />;
  const matches = (record.matches || []).filter((match) => mode === 'all' || match.mode === mode);
  const week = `${beijing(record.weekStart).day} – ${beijing(record.weekStart + 6 * DAY_MS).day}`;
  return (
    <>
      <section className="profile-best">
        <header><h3>本周最大牌型</h3><span>{week}</span></header>
        {record.best ? (
          <div className="profile-best-hand">
            <strong>{translateHandName(record.best.handName)}</strong>
            <div className="profile-best-cards">
              {record.best.cards.map((code, index) => <Card key={code} code={code} delay={index * 0.06} />)}
            </div>
            <small>{beijing(record.best.at).moment}</small>
          </div>
        ) : <p className="profile-empty">本周还没有记录</p>}
      </section>
      <div className="window-subtabs" role="tablist" aria-label="按模式筛选">
        {MODES.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={mode === item.id}
            className={mode === item.id ? 'active' : ''} onClick={() => setMode(item.id)}>{item.label}</button>
        ))}
      </div>
      {matches.length ? (
        <ol className="profile-matches">
          {matches.map((match) => (
            <li key={match.at}>
              <time>{beijing(match.at).moment}</time>
              <span className={`profile-match-mode mode-${match.mode}`}>{MODE_NAME[match.mode] || '经典'}</span>
              <strong>{match.score.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      ) : <p className="profile-empty">还没有对局记录</p>}
    </>
  );
}

function PlatePage({ plate, onNameplate }) {
  return (
    <div className="nameplate-grid">
      {NAMEPLATES.map((option) => {
        const look = nameplateProps(option.id);
        const active = option.id === plate.id;
        return (
          <button key={option.id} type="button" className={`nameplate-option${active ? ' active' : ''}`}
            aria-pressed={active} onClick={() => onNameplate(option.id)}>
            <span className={`nameplate-swatch ${look.className}`} style={look.style} />
            <span className="nameplate-option-name">{option.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Profile({ name, onName, avatar, onAvatar, bio, onBio, nameplate, onNameplate, onClose }) {
  const [tab, setTab] = useState('info');
  const plate = nameplateOf(nameplate);
  const record = useProfileRecord(name.trim());

  return (
    <GameWindow title="个人页面" tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} className="profile-window">
      {tab === 'info' && <InfoPage name={name} onName={onName} avatar={avatar} onAvatar={onAvatar}
        bio={bio} onBio={onBio} plate={plate} record={record} />}
      {tab === 'record' && <RecordPage record={record} />}
      {tab === 'plate' && <PlatePage plate={plate} onNameplate={onNameplate} />}
    </GameWindow>
  );
}

// Another player's profile, opened from their seat: the same card and record, read only.
const PLAYER_TABS = TABS.slice(0, 2);

export function PlayerProfile({ player, onClose }) {
  const [tab, setTab] = useState('info');
  const plate = nameplateOf(player.nameplate);
  const look = nameplateProps(plate.id);
  const record = useProfileRecord(player.name);
  return (
    <GameWindow title="个人页面" tabs={PLAYER_TABS}
      tab={tab} onTab={setTab} onClose={onClose} className="profile-window">
      {tab === 'info' && (
        <>
          <section className={`profile-card ${look.className}`} style={look.style}>
            <div className="profile-card-avatar">
              <Avatar avatar={player.avatar} name={player.name} className="profile-avatar" />
            </div>
            <div className="profile-card-read">
              <strong>{player.name}</strong>
              {player.bio && <p>{player.bio}</p>}
              <span>{plate.name}</span>
            </div>
          </section>
          <StatTiles record={record} />
        </>
      )}
      {tab === 'record' && <RecordPage record={record} />}
    </GameWindow>
  );
}
