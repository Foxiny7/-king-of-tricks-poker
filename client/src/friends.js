import { socket } from './socket';

let pending = false;
const queue = [];

export function authFriends(name, avatar, done) {
  queue.push({ name, avatar, done });
  if (pending) return;
  sendNext();
}

function sendNext() {
  const next = queue.shift();
  if (!next) { pending = false; return; }
  pending = true;
  let token = '';
  try { token = localStorage.getItem('poker_friend_token') || ''; } catch { /* session only */ }
  socket.timeout(5000).emit('friend_auth', { token, name: next.name, avatar: next.avatar }, (error, result) => {
    if (result?.ok) {
      try { localStorage.setItem('poker_friend_token', result.token); } catch { /* session only */ }
    }
    next.done?.(error ? { ok: false, error: '好友服务连接超时' } : result);
    sendNext();
  });
}
