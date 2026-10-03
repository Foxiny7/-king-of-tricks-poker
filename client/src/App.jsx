import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from './socket';
import Home from './components/Home';
import RoomSetup from './components/RoomSetup';
import Table from './components/Table';
import TrickSelection from './components/TrickSelection';
import VoiceChat from './components/VoiceChat';
import Notification from './components/Notification';
import WeChatBanner from './components/WeChatBanner';
import Friends from './components/Friends';
import { authFriends } from './friends';
import { DEFAULT_AVATAR } from './components/Avatar';
import { loadNameplate, saveNameplate } from './nameplates';
import { loadBio } from './bio';
import { ThemeProvider } from './ThemeContext';
import { speakMatchStart, speakTitle, speakTrickPick, speakTrickUsed, unlockSpeech } from './speech';
import { unlockAudioContext } from './sounds';
import { useSetting } from './settings';
import { localizePage } from './localize';
import './App.css';
import './experience.css';
import './polish.css';
import './title.css';
import './comic.css';
import './window.css';
import './fit.css';
import './pov.css';

function loadMe() {
  try {
    const playerId = localStorage.getItem('poker_playerId');
    const roomCode = localStorage.getItem('poker_roomCode');
    const name = localStorage.getItem('poker_name');
    const avatar = localStorage.getItem('poker_avatar') || localStorage.getItem('poker_lastAvatar') || DEFAULT_AVATAR;
    if (playerId && roomCode) return { playerId, roomCode, name, avatar };
  } catch {
    // storage unavailable, ignore
  }
  return null;
}

function saveMe(me) {
  try {
    localStorage.setItem('poker_playerId', me.playerId);
    localStorage.setItem('poker_roomCode', me.roomCode);
    localStorage.setItem('poker_name', me.name || '');
    localStorage.setItem('poker_lastName', me.name || '');
    localStorage.setItem('poker_avatar', me.avatar || DEFAULT_AVATAR);
    localStorage.setItem('poker_lastAvatar', me.avatar || DEFAULT_AVATAR);
  } catch {
    // storage unavailable, ignore
  }
}

function clearMe() {
  try {
    localStorage.removeItem('poker_playerId');
    localStorage.removeItem('poker_roomCode');
    localStorage.removeItem('poker_name');
    localStorage.removeItem('poker_avatar');
  } catch {
    // storage unavailable, ignore
  }
}

export default function App() {
  const [language] = useSetting('language');
  useLayoutEffect(() => localizePage(language), [language]);
  const [me, setMe] = useState(null);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [nameplate, setNameplate] = useState(loadNameplate);
  const [showFriends, setShowFriends] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [inviteCode, setInviteCode] = useState('');
  const meRef = useRef(null);
  meRef.current = me;

  useEffect(() => {
    // The first tap is the earliest the browser lets the page speak, so the title is read then.
    const unlock = () => {
      unlockSpeech();
      unlockAudioContext();
      if (!meRef.current) speakTitle();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // The announcer opens each match as the room leaves the lobby (not on a reconnect mid-game),
  // and calls each trick pick this player still has to make. A layout effect, so it speaks before
  // the table's own effects queue the first turn behind it.
  const lastStatusRef = useRef(null);
  const lastPickRef = useRef(null);
  const selection = room?.trickMatch?.selection;
  const pick = selection && !selection.chosen && selection.offers?.length ? `${selection.phase}${selection.catchup ? '+' : ''}` : null;
  useLayoutEffect(() => {
    const status = room?.status || null;
    const newPick = !!pick && pick !== lastPickRef.current;
    if (lastStatusRef.current === 'LOBBY' && status === 'PLAYING') speakMatchStart({ trickPick: newPick });
    else if (newPick) speakTrickPick();
    lastStatusRef.current = status;
    lastPickRef.current = pick;
  }, [room?.status, pick]);

  useEffect(() => {
    socket.on('room_state', setRoom);

    const onKicked = (payload) => {
      clearMe();
      setMe(null);
      setRoom(null);
      setError(payload?.error || '你已被房主移出房间');
    };
    socket.on('kicked', onKicked);

    const reclaim = () => {
      setConnected(true);
      const current = meRef.current || loadMe();
      let savedName = '';
      let savedAvatar = DEFAULT_AVATAR;
      try {
        savedName = localStorage.getItem('poker_lastName') || '';
        savedAvatar = localStorage.getItem('poker_lastAvatar') || DEFAULT_AVATAR;
      } catch { /* storage unavailable */ }
      authFriends(current?.name || savedName, current?.avatar || savedAvatar);
      if (!current) return;
      setConnecting(true);
      socket.emit(
        'join_room',
        { code: current.roomCode, name: current.name, avatar: current.avatar, nameplate: loadNameplate(), bio: loadBio(), playerId: current.playerId },
        (res) => {
          setConnecting(false);
          if (res.ok) {
            const restored = { playerId: res.playerId, roomCode: res.roomCode, name: current.name, avatar: current.avatar };
            saveMe(restored);
            setMe(restored);
          } else {
            clearMe();
            setMe(null);
            setRoom(null);
            setError(res.error || '无法恢复房间，请重新加入');
          }
        }
      );
    };

    socket.on('connect', reclaim);
    const onInvitation = (payload) => setInvitation(payload);
    socket.on('friend_invite', onInvitation);
    const onDisconnected = () => setConnected(false);
    socket.on('disconnect', onDisconnected);
    socket.on('connect_error', onDisconnected);
    socket.connect();
    if (socket.connected) reclaim();

    return () => {
      socket.off('room_state', setRoom);
      socket.off('kicked', onKicked);
      socket.off('connect', reclaim);
      socket.off('friend_invite', onInvitation);
      socket.off('disconnect', onDisconnected);
      socket.off('connect_error', onDisconnected);
    };
  }, []);

  const handleListRooms = useCallback((cb) => {
    socket.emit('list_rooms', {}, (res) => {
      cb(res.ok ? res.rooms : []);
    });
  }, []);

  const handleCreate = useCallback((name, avatar) => {
    setError('');
    authFriends(name, avatar);
    socket.emit('create_room', { name, avatar, nameplate: loadNameplate(), bio: loadBio() }, (res) => {
      if (res.ok) {
        const next = { playerId: res.playerId, roomCode: res.roomCode, name, avatar };
        saveMe(next);
        setMe(next);
      } else {
        setError(res.error || '创建失败');
      }
    });
  }, []);

  const handleJoin = useCallback((code, name, avatar) => {
    setError('');
    authFriends(name, avatar);
    socket.emit('join_room', { code, name, avatar, nameplate: loadNameplate(), bio: loadBio() }, (res) => {
      if (res.ok) {
        const next = { playerId: res.playerId, roomCode: res.roomCode, name, avatar };
        saveMe(next);
        setMe(next);
      } else {
        setError(res.error || '加入失败');
      }
    });
  }, []);

  const handleNameplate = useCallback((id) => {
    saveNameplate(id);
    setNameplate(id);
    if (meRef.current) socket.emit('set_nameplate', { nameplate: id });
  }, []);

  const handleConfig = useCallback((config) => {
    socket.emit('set_room_config', config);
  }, []);

  const handleStart = useCallback(() => {
    socket.emit('start_game', {}, (res) => {
      if (!res.ok) setError(res.error || '无法开始');
    });
  }, []);

  const handleAction = useCallback((type, amount) => {
    if (!socket.connected) return setError('连接已断开，请等待重连后操作');
    socket.volatile.timeout(5000).emit('player_action', { type, amount }, (err, res) => {
      if (err) return setError('尚未收到操作结果，请以牌桌最新状态为准');
      if (!res.ok) setError(res.error || '操作失败');
    });
  }, []);

  const handleReturnToLobby = useCallback(() => {
    socket.emit('return_to_lobby', {});
  }, []);

  const handleKick = useCallback((playerId) => {
    socket.emit('kick_player', { playerId }, (res) => {
      if (!res.ok) setError(res.error || '踢出失败');
    });
  }, []);

  // The outcome shows as the usual game notification.
  const handleAddFriend = useCallback((playerId) => {
    socket.emit('friend_request_player', { playerId }, (res) => {
      setError(res?.ok ? (res.accepted ? '已互相添加为好友' : '好友申请已发送') : res?.error || '好友申请发送失败');
    });
  }, []);

  const handleAddBot = useCallback(() => {
    socket.emit('add_bot', {}, (res) => {
      if (!res?.ok) setError(res?.error || '添加机器人失败');
    });
  }, []);

  const handleRebuy = useCallback((playerId) => {
    socket.emit('rebuy_player', { playerId }, (res) => {
      if (!res.ok) setError(res.error || '操作失败');
    });
  }, []);

  const handleReady = useCallback(() => {
    socket.emit('ready_for_next_hand', {}, (res) => {
      if (!res.ok) setError(res.error || '操作失败');
    });
  }, []);

  const handleChooseTrick = useCallback((trickId, onFailure) => {
    socket.timeout(5000).emit('choose_trick', { trickId }, (err, res) => {
      if (err) {
        setError('未收到选术结果，请以最新房间状态为准');
        onFailure?.();
      } else if (!res.ok) {
        setError(res.error || '选术失败');
        onFailure?.();
      }
    });
  }, []);

  const handleRefreshTrick = useCallback((slotIndex) => {
    socket.timeout(5000).emit('refresh_trick_offer', { slotIndex }, (err, res) => {
      if (err) return setError('未收到刷新结果，请以最新候选为准');
      if (!res.ok) setError(res.error || '刷新失败');
    });
  }, []);

  const handleUseTrick = useCallback((trickId, options = {}, onResult) => {
    if (!socket.connected) {
      setError('连接已断开，请等待重连后操作');
      onResult?.(false);
      return;
    }
    socket.timeout(5000).emit('use_trick', { trickId, options }, (err, res) => {
      if (err) setError('未收到千术结果，请以最新牌桌状态为准');
      else if (!res.ok) setError(res.error || '千术使用失败');
      else speakTrickUsed(); // heard only by the player who used it
      onResult?.(!err && !!res?.ok);
    });
  }, []);

  const handlePeek = useCallback((playerId) => {
    socket.emit('peek_folded_cards', { playerId }, (res) => {
      if (!res.ok) setError(res.error || '看牌失败');
    });
  }, []);

  const handleReveal = useCallback(() => {
    socket.emit('reveal_folded_cards', {}, (res) => {
      if (!res.ok) setError(res.error || '公开失败');
    });
  }, []);

  const handleLeave = useCallback(() => {
    clearMe();
    setMe(null);
    setRoom(null);
    socket.disconnect();
    socket.connect();
  }, []);

  function acceptInvitation() {
    const code = invitation.roomCode;
    setInvitation(null);
    if (meRef.current) return;
    let name = '';
    let avatar = DEFAULT_AVATAR;
    try {
      name = localStorage.getItem('poker_lastName') || '';
      avatar = localStorage.getItem('poker_lastAvatar') || DEFAULT_AVATAR;
    } catch { /* storage unavailable */ }
    if (name.trim()) handleJoin(code, name.trim(), avatar);
    else setInviteCode(code);
  }

  const invitePrompt = invitation && <div className="friend-invite" role="alertdialog" aria-label="房间邀请">
    <strong>{invitation.from?.name || '好友'} 邀请你加入 {invitation.roomCode}</strong>
    {!me && <button type="button" onClick={acceptInvitation}>加入</button>}
    <button type="button" onClick={() => setInvitation(null)}>关闭</button>
  </div>;
  const landscapeGate = createPortal(
    <div className="landscape-gate" role="status" aria-live="polite">
      <span aria-hidden="true">↻</span>
      <strong>横屏入座</strong>
      <p>请旋转手机，或调宽浏览器窗口。</p>
    </div>,
    document.body,
  );

  if (!me || !room) {
    const params = new URLSearchParams(window.location.search);
    return (
      <ThemeProvider>
        {landscapeGate}
        <WeChatBanner />
        {(!connected || connecting) && <div className="connection-notice" role="status">{connecting ? '正在恢复房间…' : '正在连接服务器…'}</div>}
        <Home key={inviteCode} 
          onCreate={handleCreate}
          onJoin={handleJoin}
          onListRooms={handleListRooms}
          initialCode={inviteCode || params.get('room') || ''}
          nameplate={nameplate}
          onNameplate={handleNameplate}
        />
        {invitePrompt}
        <Notification message={connecting ? '' : error} onDone={() => setError('')} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {landscapeGate}
      <WeChatBanner />
      {invitePrompt}
      {showFriends && <Friends name={me.name} avatar={me.avatar} roomCode={room.code} onClose={() => setShowFriends(false)} />}
      {(!connected || connecting) && <div className="connection-notice" role="status">连接恢复中… 当前牌桌暂不可操作</div>}
      <div className="game-session" inert={!connected || connecting}>
      <VoiceChat room={room} me={me} />
      {room.status === 'LOBBY' && (
        <RoomSetup
          room={room}
          me={me}
          onConfig={handleConfig}
          onStart={handleStart}
          onLeave={handleLeave}
          onKick={handleKick}
          onAddBot={handleAddBot}
          onAddFriend={handleAddFriend}
          onOpenFriends={() => setShowFriends(true)}
        />
      )}
      {room.status === 'PLAYING' && room.trickMatch?.selection && (
        <TrickSelection room={room} onChoose={handleChooseTrick} onRefresh={handleRefreshTrick} />
      )}
      {room.status === 'PLAYING' && !room.trickMatch?.selection && room.hand && (
        <Table
          room={room}
          me={me}
          onAction={handleAction}
          onReturnToLobby={handleReturnToLobby}
          onKick={handleKick}
          onAddBot={handleAddBot}
          onAddFriend={handleAddFriend}
          onRebuy={handleRebuy}
          onReady={handleReady}
          onPeek={handlePeek}
          onReveal={handleReveal}
          onUseTrick={handleUseTrick}
          onOpenFriends={() => setShowFriends(true)}
        />
      )}
      </div>
      <Notification message={error} onDone={() => setError('')} />
    </ThemeProvider>
  );
}
