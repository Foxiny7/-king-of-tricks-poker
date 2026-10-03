import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function createFriendStore(file) {
  let accounts;
  try { accounts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { accounts = {}; }
  let timer;
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(accounts));
      fs.renameSync(temp, file);
    }, 300);
    timer.unref?.();
  };
  const publicInfo = (code) => {
    const account = accounts[code];
    return account ? { code, name: account.name, avatar: account.avatar } : null;
  };
  const account = (code) => accounts[code];
  const findByToken = (token) => Object.keys(accounts).find((code) => accounts[code].token === token);
  function register(token, name, avatar) {
    let code = typeof token === 'string' && token.length === 48 ? findByToken(token) : null;
    if (!code) {
      do { code = randomBytes(4).toString('hex').toUpperCase(); } while (accounts[code]);
      token = randomBytes(24).toString('hex');
      accounts[code] = { token, name: '', avatar: '', friends: [], requests: [] };
    }
    accounts[code].name = String(name || '玩家').trim().slice(0, 20) || '玩家';
    accounts[code].avatar = typeof avatar === 'string' && avatar.length < 160000 ? avatar : '';
    save();
    return { code, token };
  }
  function request(from, to) {
    if (!accounts[from] || !accounts[to] || from === to) return '好友编号无效';
    if (accounts[from].friends.includes(to)) return '已经是好友';
    if (accounts[to].requests.includes(from)) return '申请已发送';
    if (accounts[to].requests.length >= 50) return '对方申请过多';
    accounts[to].requests.push(from);
    save();
    return null;
  }
  function reply(to, from, accept) {
    const target = accounts[to];
    if (!target?.requests.includes(from) || !accounts[from]) return '申请不存在';
    target.requests = target.requests.filter((code) => code !== from);
    if (accept) {
      if (!target.friends.includes(from)) target.friends.push(from);
      if (!accounts[from].friends.includes(to)) accounts[from].friends.push(to);
    }
    save();
    return null;
  }
  return { account, publicInfo, register, request, reply };
}
