import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFriendStore } from '../src/friends.js';

test('friend requests need acceptance and survive reload', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-friends-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'friends.json');
  const store = createFriendStore(file);
  const alice = store.register('', 'Alice', 'preset-1');
  const bob = store.register('', 'Bob', 'preset-2');
  assert.notEqual(alice.code, bob.code);
  assert.equal(store.request(alice.code, bob.code), null);
  assert.deepEqual(store.account(bob.code).requests, [alice.code]);
  assert.deepEqual(store.account(alice.code).friends, []);
  assert.equal(store.reply(bob.code, alice.code, true), null);
  assert.deepEqual(store.account(bob.code).friends, [alice.code]);
  assert.deepEqual(store.account(alice.code).friends, [bob.code]);
  assert.equal(store.register(alice.token, 'Alice 2', 'preset-1').code, alice.code);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const saved = createFriendStore(file);
  assert.equal(saved.account(alice.code).name, 'Alice 2');
  assert.deepEqual(saved.account(alice.code).friends, [bob.code]);
});
