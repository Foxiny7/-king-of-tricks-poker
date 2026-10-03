import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerSocketHandlers } from '../src/socketHandlers.js';
import { createFriendStore } from '../src/friends.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-online-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let connect;
  registerSocketHandlers({ on: (_event, callback) => { connect = callback; } }, { friends: createFriendStore(path.join(dir, 'friends.json')) });
  return function client(name) {
    const handlers = new Map();
    const socket = {
      data: {}, connected: true, updates: 0,
      on: (event, callback) => handlers.set(event, callback),
      use: () => {},
      emit: (event) => { if (event === 'online_update') socket.updates += 1; },
      disconnect: () => { socket.connected = false; handlers.get('disconnect')?.(); },
      send: (event, payload = {}) => { let result; handlers.get(event)(payload, (response) => { result = response; }); return result; },
    };
    connect(socket);
    socket.identity = socket.send('friend_auth', { token: '', name, avatar: 'preset-1' });
    return socket;
  };
}

const listed = (socket) => socket.send('online_players').players.map(({ name, where, relation }) => `${name}:${where}:${relation}`).sort();

test('the online list shows everyone else once, where they are and how they relate', (t) => {
  const client = setup(t);
  const alice = client('Alice');
  const bob = client('Bob');
  const carol = client('Carol');
  const bobAgain = client('Bob 2nd tab');
  bobAgain.send('friend_auth', { token: bob.identity.token, name: 'Bob', avatar: 'preset-1' });

  assert.deepEqual(listed(alice), ['Bob:idle:null', 'Carol:idle:null'], 'self left out, two tabs listed once');

  assert(alice.send('friend_request', { code: bob.identity.code }).ok);
  assert.deepEqual(listed(alice), ['Bob:idle:requested', 'Carol:idle:null']);
  assert.deepEqual(listed(bob), ['Alice:idle:incoming', 'Carol:idle:null']);
  assert(bob.send('friend_reply', { code: alice.identity.code, accept: true }).ok);
  assert.deepEqual(listed(alice), ['Bob:idle:friend', 'Carol:idle:null']);

  assert(carol.send('create_room', { name: 'Carol' }).ok);
  assert.deepEqual(listed(alice), ['Bob:idle:friend', 'Carol:room:null']);
});

test('people coming online and leaving refresh every open list', (t) => {
  const client = setup(t);
  const alice = client('Alice');
  const before = alice.updates;
  const bob = client('Bob');
  assert.equal(alice.updates, before + 1);
  bob.disconnect();
  assert.equal(alice.updates, before + 2);
  assert.deepEqual(listed(alice), []);
  assert.equal(alice.send('online_players', {}).ok, true);
});

test('加好友 from the player menu asks the identity behind that seat, and accepts a request already made', (t) => {
  const client = setup(t);
  const alice = client('Alice');
  const bob = client('Bob');
  const created = alice.send('create_room', { name: 'Alice' });
  const joined = bob.send('join_room', { code: created.roomCode, name: 'Bob' });
  assert(joined.ok);
  assert.equal(alice.send('friend_request_player', { playerId: created.playerId }).ok, false, 'not yourself');
  assert.equal(alice.send('friend_request_player', { playerId: 'nobody' }).ok, false);
  assert.deepEqual(alice.send('friend_request_player', { playerId: joined.playerId }), { ok: true });
  assert.deepEqual(bob.send('friend_list').requests.map((r) => r.name), ['Alice']);
  assert.equal(alice.send('friend_request_player', { playerId: joined.playerId }).error, '申请已发送');
  assert.deepEqual(bob.send('friend_request_player', { playerId: created.playerId }), { ok: true, accepted: true });
  assert.deepEqual(alice.send('friend_list').friends.map((f) => f.name), ['Bob']);
  assert.equal(alice.send('friend_request_player', { playerId: joined.playerId }).error, '已经是好友');
  const bot = alice.send('add_bot');
  assert.equal(alice.send('friend_request_player', { playerId: bot.playerId }).error, '机器人不能加好友');
});

test('the online list needs a friend identity', (t) => {
  setup(t);
  let connect;
  registerSocketHandlers({ on: (_event, callback) => { connect = callback; } }, {});
  const handlers = new Map();
  connect({ data: {}, on: (event, callback) => handlers.set(event, callback), use: () => {}, emit: () => {} });
  let result;
  handlers.get('online_players')({}, (response) => { result = response; });
  assert.equal(result.ok, false);
});
