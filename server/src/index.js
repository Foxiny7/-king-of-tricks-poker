import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './socketHandlers.js';
import { TRICKS } from './tricks.js';
import { createProfileStore } from './profiles.js';
import { createFriendStore } from './friends.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/tricks', (_req, res) => res.json(Object.values(TRICKS)));

app.get('/ice-servers', (_req, res) => {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnHost = process.env.TURN_HOST;
  if (turnHost) {
    const turnUser = process.env.TURN_USERNAME;
    const turnPass = process.env.TURN_PASSWORD;
    servers.push(
      { urls: `stun:${turnHost}:3478` },
      { urls: `turn:${turnHost}:3478?transport=udp`, username: turnUser, credential: turnPass },
      { urls: `turn:${turnHost}:3478?transport=tcp`, username: turnUser, credential: turnPass }
    );
  }
  res.json(servers);
});

const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('Poker server running. Client dev server is separate.');
  });
});

const profileFile = process.env.PROFILE_FILE || path.join(__dirname, '../data/profiles.json');
const friendFile = process.env.FRIEND_FILE || path.join(__dirname, '../data/friends.json');
registerSocketHandlers(io, { profiles: createProfileStore({ file: profileFile }), friends: createFriendStore(friendFile) });

server.listen(PORT, () => {
  console.log(`Poker server listening on :${PORT}`);
});
