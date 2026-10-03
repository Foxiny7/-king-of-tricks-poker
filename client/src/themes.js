const cardBack = (id) => `/textures/${id}-card.svg`;

export const CARD_THEMES = [
  { id: 'classic', name: '经典', backImage: cardBack('classic') },
  { id: 'illustrated', name: '插画' },
  { id: 'minimal', name: '高对比', backImage: cardBack('minimal') },
  { id: 'artdeco', name: '金线', backImage: cardBack('artdeco') },
  { id: 'cinnabar', name: '朱红', backImage: cardBack('cinnabar') },
  { id: 'jade', name: '青玉', backImage: cardBack('jade') },
  { id: 'noir', name: '黑银', backImage: cardBack('noir') },
  { id: 'sunset', name: '暖橙', backImage: cardBack('sunset') },
  { id: 'royal', name: '钴蓝', backImage: cardBack('royal') },
  { id: 'sakura', name: '樱花', backImage: cardBack('sakura') },
  { id: 'highland', name: '山景', backImage: cardBack('highland') },
  { id: 'cyber', name: '霓虹', backImage: cardBack('cyber') },
  { id: 'lunar', name: '黑金', backImage: cardBack('lunar') },
  { id: 'ukiyo', name: '浪纹', backImage: cardBack('ukiyo') },
  { id: 'celadon', name: '青瓷', backImage: cardBack('celadon') },
  { id: 'nebula', name: '星空', backImage: cardBack('nebula') },
  { id: 'tiger', name: '虎纹', backImage: cardBack('tiger') },
  { id: 'rose', name: '玫瑰', backImage: cardBack('rose') },
  { id: 'frost', name: '冰蓝', backImage: cardBack('frost') },
  { id: 'bamboo', name: '竹纹', backImage: cardBack('bamboo') },
  { id: 'pixel', name: '像素', backImage: cardBack('pixel') },
  { id: 'voyage', name: '海图', backImage: cardBack('voyage') },
  { id: 'comic', name: '漫画', backImage: cardBack('comic') },
];

const tableImage = (id) => `/textures/${id}-table.svg`;

export const TABLE_THEMES = [
  { id: 'green', name: '经典绿', image: tableImage('green') },
  { id: 'blue', name: '深蓝', image: tableImage('blue') },
  { id: 'red', name: '暖红', image: tableImage('red') },
  { id: 'purple', name: '深紫', image: tableImage('purple') },
  { id: 'copper', name: '棕色皮革', image: tableImage('copper') },
  { id: 'jade', name: '青绿', image: tableImage('jade') },
  { id: 'noir', name: '黑色', image: tableImage('noir') },
  { id: 'aurora', name: '极光', image: tableImage('aurora') },
  { id: 'rosewood', name: '酒红', image: tableImage('rosewood') },
  { id: 'sakura', name: '樱花', image: tableImage('sakura') },
  { id: 'highland', name: '山景', image: tableImage('highland') },
  { id: 'cyber', name: '霓虹', image: tableImage('cyber') },
  { id: 'moonbase', name: '月面', image: tableImage('moonbase') },
  { id: 'bamboo-grove', name: '竹林', image: tableImage('bamboo-grove') },
  { id: 'lava', name: '熔岩', image: tableImage('lava') },
  { id: 'glacier', name: '冰川', image: tableImage('glacier') },
  { id: 'desert', name: '沙漠', image: tableImage('desert') },
  { id: 'ink', name: '水墨', image: tableImage('ink') },
  { id: 'deepsea', name: '深海', image: tableImage('deepsea') },
  { id: 'colosseum', name: '石柱', image: tableImage('colosseum') },
  { id: 'zen', name: '枯山水', image: tableImage('zen') },
  { id: 'quantum', name: '光网', image: tableImage('quantum') },
  { id: 'comic', name: '漫画', image: tableImage('comic') },
];

// The comic look became the default in September 2026; everyone switches to it once,
// and any skin they pick afterwards is kept.
const STYLE_VERSION = 'comic-2026-09';
function adoptComicStyleOnce() {
  try {
    if (localStorage.getItem('poker_style_version') === STYLE_VERSION) return;
    localStorage.setItem('poker_card_theme', 'comic');
    localStorage.setItem('poker_table_theme', 'comic');
    localStorage.setItem('poker_style_version', STYLE_VERSION);
  } catch {
    // storage unavailable, the defaults below still apply
  }
}
adoptComicStyleOnce();

export function loadCardTheme() {
  try {
    const v = localStorage.getItem('poker_card_theme');
    return CARD_THEMES.some((t) => t.id === v) ? v : 'comic';
  } catch {
    return 'comic';
  }
}

export function saveCardTheme(id) {
  try {
    localStorage.setItem('poker_card_theme', id);
  } catch {
    // storage unavailable, ignore
  }
}

export function loadTableTheme() {
  try {
    const v = localStorage.getItem('poker_table_theme');
    return TABLE_THEMES.some((t) => t.id === v) ? v : 'comic';
  } catch {
    return 'comic';
  }
}

export function saveTableTheme(id) {
  try {
    localStorage.setItem('poker_table_theme', id);
  } catch {
    // storage unavailable, ignore
  }
}

export const UI_SCALES = [
  { id: 'compact', name: '紧凑', value: 0.85 },
  { id: 'normal', name: '标准', value: 1 },
  { id: 'large', name: '大', value: 1.15 },
  { id: 'xlarge', name: '特大', value: 1.3 },
];

export function loadUiScale() {
  try {
    const v = localStorage.getItem('poker_ui_scale');
    return UI_SCALES.some((s) => s.id === v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveUiScale(id) {
  try {
    localStorage.setItem('poker_ui_scale', id);
  } catch {
    // storage unavailable, ignore
  }
}

export const HAND_STYLES = [
  { id: 'plum', name: '酒红', image: '/images/pov-hands-v3.png' },
  { id: 'ivory', name: '月白', image: '/images/pov-hands-ivory-v3.png' },
  { id: 'sakura', name: '夜樱', image: '/images/pov-hands-sakura-v3.png' },
  { id: 'neon', name: '霓虹', image: '/images/pov-hands-neon-v3.png' },
  { id: 'detective', name: '学院侦探', image: '/images/pov-hands-detective.png' },
  { id: 'diviner', name: '和风术士', image: '/images/pov-hands-diviner.png' },
  { id: 'hacker', name: '赛博骇客', image: '/images/pov-hands-hacker.png' },
  { id: 'verdict', name: '学级裁判', image: '/images/pov-hands-verdict.png' },
  { id: 'miko', name: '巫女', image: '/images/pov-hands-miko.png' },
  { id: 'gothic', name: '暗黑哥特', image: '/images/pov-hands-gothic.png' },
  { id: 'jirai', name: '地雷系', image: '/images/pov-hands-jirai.png' },
];

export function loadHandStyle() {
  try {
    const value = localStorage.getItem('poker_hand_style');
    return HAND_STYLES.some((style) => style.id === value) ? value : 'plum';
  } catch {
    return 'plum';
  }
}

export function saveHandStyle(id) {
  try {
    localStorage.setItem('poker_hand_style', id);
  } catch {
    // storage unavailable, keep the current selection for this session
  }
}
