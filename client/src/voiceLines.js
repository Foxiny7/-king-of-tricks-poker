// Announcer lines, voiced with VOICEVOX. scripts/gen-voice.mjs records every line for every
// character into public/voice/<character>/<line>.wav; the game reads a line with the browser's
// Japanese voice if its file is missing.
export const VOICE_LINES = {
  title: 'せんおうのおう！',
  start: 'さあ、ゲームを始めましょう。',
  flop: 'フロップ。',
  turn: 'ターン。',
  river: 'リバー。',
  fold: 'フォールド。',
  check: 'チェック。',
  call: 'コール。',
  raise: 'レイズ！',
  allin: 'オールイン！',
  ten_seconds: '残り、十秒。',
  trick_pick: 'イカサマを、選んで。',
  trick_used: 'イカサマ発動！',
  hand_royal: 'ロイヤル、ストレートフラッシュ！',
  hand_straight_flush: 'ストレートフラッシュ！',
  hand_quads: 'フォーカード！',
  hand_full_house: 'フルハウス！',
  hand_flush: 'フラッシュ！',
  hand_straight: 'ストレート！',
  hand_trips: 'スリーカード。',
  hand_two_pair: 'ツーペア。',
  hand_pair: 'ワンペア。',
  hand_high: 'ハイカード。',
  win: 'あなたの勝ちよ！',
  lose: '残念でした。',
  decided: '勝負あり！',
};

// Hand names as the server reports them, mapped to their lines.
export const HAND_LINES = {
  'Royal Flush': 'hand_royal',
  'Straight Flush': 'hand_straight_flush',
  'Four of a Kind': 'hand_quads',
  'Full House': 'hand_full_house',
  Flush: 'hand_flush',
  Straight: 'hand_straight',
  'Three of a Kind': 'hand_trips',
  'Two Pair': 'hand_two_pair',
  Pair: 'hand_pair',
  'High Card': 'hand_high',
};

// Each character's terms ask for the credit「VOICEVOX:<name>」wherever the voice is used.
// `speaker` and `style` are the names the VOICEVOX engine lists them under; `delivery` adjusts
// the shared read in scripts/gen-voice.mjs for that voice.
export const VOICE_CHARACTERS = [
  { id: 'himari', label: '冥鳴ひまり · 冷静', speaker: '冥鳴ひまり', style: 'ノーマル' },
  { id: 'ritsu', label: '波音リツ · 女王', speaker: '波音リツ', style: 'クイーン' },
  { id: 'sora', label: '九州そら · 成熟', speaker: '九州そら', style: 'セクシー', delivery: { speedScale: 1.35 } },
  { id: 'metan', label: '四国めたん · 大小姐', speaker: '四国めたん', style: 'ノーマル' },
  { id: 'no7', label: 'No.7 · 播音员', speaker: 'No.7', style: 'アナウンス' },
  { id: 'zonko', label: 'ぞん子 · 实况', speaker: 'ぞん子', style: '実況風' },
  { id: 'tsumugi', label: '春日部つむぎ · 元气', speaker: '春日部つむぎ', style: 'ノーマル' },
  { id: 'zundamon', label: 'ずんだもん · 萌', speaker: 'ずんだもん', style: 'ノーマル' },
];

export const voiceCredit = (character) => `VOICEVOX:${character.speaker}`;
