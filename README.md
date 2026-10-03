# 千王之王2026 · King of Tricks Poker

A browser-based Texas Hold'em game for 2–10 friends in China and the US. Play with chips for fun—there is **no real-money gambling**, account registration, or app installation.

**[Play the game](https://47.76.108.238.sslip.io/)** · The interface supports **English and 中文**. New visitors start in English; existing players keep Chinese unless they change it. Language choices are saved on each device. On phones, rotate to landscape.

## Game modes

- **Classic Hold'em:** betting rounds, all-ins, side pots, showdown, and room results. The host can play without a hand limit or set 2–99 hands.
- **Trick Mode (千术模式):** a 16-hand match in four phases. Pick from **109 tricks** that reveal information, change cards, protect your hand, or disrupt opponents. Trick choices and uses are enforced by the server.

## Around the table

- Create a room or join by code. The host chooses starting chips, blinds, raise limits, and game mode. Disconnected players can rejoin their seat.
- Add server-controlled practice bots, chat with the room, send reactions and gifts, or use WebRTC voice chat with optional TURN relay.
- Keep a profile, add friends, see who is online, and review completed matches.
- Customize the game from **Collections**: 23 card themes, 23 table themes, and 11 first-person hand styles. The default look uses bold comic artwork.
- Change interface language, sound, speech, and motion settings independently. Japanese announcements use bundled VOICEVOX clips; Chinese and English announcements use browser speech.

## Run locally

Install Node.js and npm. From the repository root:

```bash
npm --prefix client ci
npm --prefix server ci
npm --prefix client run build
```

The Node server serves the built client from `client/dist`. To keep local play data separate from any existing installation, set temporary profile and friend files before starting it.

PowerShell:

```powershell
$env:PORT = '3002'
$env:PROFILE_FILE = Join-Path $env:TEMP 'king-of-tricks-profiles.json'
$env:FRIEND_FILE = Join-Path $env:TEMP 'king-of-tricks-friends.json'
npm --prefix server start
```

macOS / Linux:

```bash
PORT=3002 PROFILE_FILE=/tmp/king-of-tricks-profiles.json FRIEND_FILE=/tmp/king-of-tricks-friends.json npm --prefix server start
```

Open **http://localhost:3002**. The server provides both the web app and Socket.IO on the same origin. Browser microphone access requires HTTPS outside localhost. Player data lives in the files named by `PROFILE_FILE` and `FRIEND_FILE`; `server/data/` is excluded from Git.

## Project layout

- `client/` — React 19, Vite, game UI, localization, themes, and bundled media.
- `server/src/` — Express, Socket.IO, room and game rules, tricks, profiles, and friends.
- `server/test/` — Node test suite.

## Asset credits

Assets are bundled locally rather than fetched from a third-party CDN during play.

- Emoji and gift icons: [Twemoji](https://github.com/twitter/twemoji), graphics © Twitter, Inc. and contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Interface sounds: [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds), CC0.
- Tinted fabric background: [ambientCG Fabric022](https://ambientcg.com/view?id=Fabric022), CC0.
- Japanese announcement clips: [VOICEVOX](https://voicevox.hiroshiba.jp/) — VOICEVOX:冥鳴ひまり, VOICEVOX:波音リツ, VOICEVOX:九州そら, VOICEVOX:四国めたん, VOICEVOX:No.7, VOICEVOX:ぞん子, VOICEVOX:春日部つむぎ, VOICEVOX:ずんだもん. See the [VOICEVOX terms](https://voicevox.hiroshiba.jp/term/) and each character's terms.
