import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSocketHandlers } from '../src/socketHandlers.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let connect;
  registerSocketHandlers({ on: (_event, callback) => { connect = callback; } });
  const client = () => {
    const handlers = new Map();
    const socket = {
      data: {}, connected: true, chat: [],
      on: (event, callback) => handlers.set(event, callback),
      use: () => {},
      emit: (event, payload) => { if (event === 'chat') socket.chat.push(payload); },
      disconnect: () => handlers.get('disconnect')?.(),
      send: (event, payload = {}) => { let result; handlers.get(event)(payload, (response) => { result = response; }); return result; },
    };
    connect(socket);
    return socket;
  };
  const host = client();
  const code = host.send('create_room', { name: '房主' }).roomCode;
  const guest = client();
  assert(guest.send('join_room', { code, name: '客人' }).ok);
  return { host, guest, later: (ms) => t.mock.timers.tick(ms) };
}

test('chat lines reach everyone in the room, trimmed and tidied', (t) => {
  const { host, guest } = setup(t);
  assert(host.send('chat_send', { text: '  快点吧\n\n兄弟  ' }).ok);
  for (const socket of [host, guest]) {
    assert.equal(socket.chat.length, 1);
    assert.equal(socket.chat[0].kind, 'text');
    assert.equal(socket.chat[0].name, '房主');
    assert.equal(socket.chat[0].text, '快点吧 兄弟');
  }
  const long = '好'.repeat(80);
  assert(guest.send('chat_send', { text: long }).ok);
  assert.equal(host.chat.at(-1).text.length, 60);
});

test('empty, malformed and too-fast chat is refused', (t) => {
  const { host, later } = setup(t);
  assert.equal(host.send('chat_send', { text: '   ' }).ok, false);
  assert.equal(host.send('chat_send', { text: 42 }).ok, false);
  assert(host.send('chat_send', { text: '一' }).ok);
  assert.equal(host.send('chat_send', { text: '二' }).error, '发得太快了');
  later(900);
  assert(host.send('chat_send', { text: '三' }).ok);
  assert.deepEqual(host.chat.map((line) => line.text), ['一', '三']);
});

test('emotes and gifts join the chat, and the room keeps its latest lines', (t) => {
  const { host, guest, later } = setup(t);
  assert(host.send('send_gesture', { type: 'emote', icon: '👍' }).ok);
  assert(guest.send('send_gesture', { type: 'gift', icon: '🌹', targetId: host.data.playerId }).ok);
  assert.deepEqual(guest.chat.map(({ kind, name, icon, to }) => [kind, name, icon, to]),
    [['emote', '房主', '👍', undefined], ['gift', '客人', '🌹', '房主']]);
  for (let i = 0; i < 45; i++) {
    later(1000);
    assert(host.send('chat_send', { text: `第${i}句` }).ok);
  }
  const { lines } = guest.send('chat_history');
  assert.equal(lines.length, 40);
  assert.equal(lines.at(-1).text, '第44句');
});
