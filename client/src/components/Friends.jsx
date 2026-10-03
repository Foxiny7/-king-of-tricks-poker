import { useEffect, useState } from 'react';
import GameWindow from './GameWindow';
import Avatar from './Avatar';
import { socket } from '../socket';
import { authFriends } from '../friends';

const TABS = [{ id: 'friends', label: '好友' }, { id: 'online', label: '在线玩家' }, { id: 'requests', label: '申请' }];
const WHERE = { idle: '在线', room: '房间中', playing: '牌局中' };

export default function Friends({ name, avatar, roomCode, onClose }) {
  const [tab, setTab] = useState('friends');
  const [data, setData] = useState({ code: '', friends: [], requests: [] });
  const [online, setOnline] = useState(null);
  const [code, setCode] = useState('');
  // A game-style notice that flashes up and goes, rather than a line that stays on every tab.
  const [toast, setToast] = useState(null);
  const notify = (text, failed = false) => setToast({ id: Date.now() + Math.random(), text, failed });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  function refresh() {
    socket.emit('friend_list', {}, (result) => {
      if (result?.ok) setData(result);
      else notify(result?.error || '好友列表读取失败', true);
    });
    refreshOnline();
  }
  function refreshOnline() {
    socket.emit('online_players', {}, (result) => { if (result?.ok) setOnline(result.players); });
  }
  useEffect(() => {
    authFriends(name, avatar, (result) => { if (result?.ok) refresh(); else notify(result?.error || '连接失败', true); });
    socket.on('friend_update', refresh);
    socket.on('online_update', refreshOnline);
    return () => {
      socket.off('friend_update', refresh);
      socket.off('online_update', refreshOnline);
    };
  }, [name, avatar]);
  // Joining or leaving a room isn't announced, so the open list re-reads now and then.
  useEffect(() => {
    if (tab !== 'online') return;
    refreshOnline();
    const timer = setInterval(refreshOnline, 15000);
    return () => clearInterval(timer);
  }, [tab]);

  function send(event) {
    event.preventDefault();
    request(code, () => setCode(''));
  }
  function request(target, onSent) {
    socket.emit('friend_request', { code: target }, (result) => {
      notify(result?.ok ? '好友申请已发送' : result?.error || '发送失败', !result?.ok);
      if (result?.ok) onSent?.();
      refreshOnline();
    });
  }
  function reply(target, accept) {
    socket.emit('friend_reply', { code: target, accept }, (result) => {
      notify(result?.ok ? (accept ? '已添加好友' : '已拒绝') : result?.error || '操作失败', !result?.ok);
      refresh();
    });
  }
  function invite(target) {
    socket.emit('friend_invite', { code: target }, (result) => {
      notify(result?.ok ? '邀请已发送' : result?.error || '邀请失败', !result?.ok);
    });
  }

  return <GameWindow title="好友" tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} className="friends-window">
    {tab === 'friends' ? <>
      <div className="friend-code">我的好友编号 <strong>{data.code || '连接中'}</strong>
        {data.code && <button type="button" onClick={() => navigator.clipboard?.writeText(data.code).then(() => notify('编号已复制')).catch(() => notify('请手动复制编号', true))}>复制</button>}
      </div>
      <form className="friend-add" onSubmit={send}>
        <input aria-label="好友编号" placeholder="输入好友编号" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} />
        <button type="submit" disabled={code.trim().length !== 8}>加好友</button>
      </form>
      {!data.friends.length && <p className="friend-empty">还没有好友</p>}
      <div className="friend-list">{data.friends.map((friend) => <div className="friend-item" key={friend.code}>
        <span className={`friend-avatar ${friend.online ? 'online' : 'offline'}`} title={friend.online ? '在线' : '离线'}>
          <Avatar avatar={friend.avatar} name={friend.name} />
        </span>
        <span><strong>{friend.name}</strong><small>{friend.code}</small></span>
        {roomCode && <button type="button" disabled={!friend.online} onClick={() => invite(friend.code)}>邀请</button>}
      </div>)}</div>
    </> : tab === 'online' ? <>
      {online && !online.length && <p className="friend-empty">现在没有其他人在线</p>}
      <div className="friend-list">{(online || []).map((person) => <div className="friend-item" key={person.code}>
        <span className="friend-avatar online" title="在线"><Avatar avatar={person.avatar} name={person.name} /></span>
        <span><strong>{person.name}</strong><small>{person.code}{person.where !== 'idle' ? ` · ${WHERE[person.where]}` : ''}</small></span>
        {person.relation === 'friend' ? <button type="button" disabled>已是好友</button>
          : person.relation === 'requested' ? <button type="button" disabled>已申请</button>
          : person.relation === 'incoming' ? <button type="button" onClick={() => reply(person.code, true)}>同意申请</button>
          : <button type="button" onClick={() => request(person.code)}>加好友</button>}
      </div>)}</div>
    </> : <>
      {!data.requests.length && <p className="friend-empty">没有待处理申请</p>}
      <div className="friend-list">{data.requests.map((friend) => <div className="friend-item" key={friend.code}>
        <Avatar avatar={friend.avatar} name={friend.name} /><span><strong>{friend.name}</strong><small>{friend.code}</small></span>
        <button type="button" onClick={() => reply(friend.code, true)}>同意</button>
        <button type="button" onClick={() => reply(friend.code, false)}>拒绝</button>
      </div>)}</div>
    </>}
    {toast && <p key={toast.id} className={`game-toast${toast.failed ? ' failed' : ''}`} role="status">{toast.text}</p>}
  </GameWindow>;
}
