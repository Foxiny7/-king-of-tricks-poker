// Ids must match NAMEPLATE_IDS in server/src/profiles.js.
export const NAMEPLATES = [
  { id: 'plain', name: '素色', accent: null },
  { id: 'gold', name: '鎏金', accent: '#d9ab55' },
  { id: 'jade', name: '翠玉', accent: '#8fd8b0' },
  { id: 'sakura', name: '樱花', accent: '#f5a3c7' },
  { id: 'neon', name: '霓虹', accent: '#4ee6e6' },
  { id: 'wave', name: '青海波', accent: '#8fb4de' },
  { id: 'nebula', name: '星云', accent: '#a980f2' },
  { id: 'flame', name: '烈焰', accent: '#ff8a3a' },
  { id: 'frost', name: '霜雪', accent: '#c4e8fb' },
  { id: 'bamboo', name: '竹林', accent: '#8cc47e' },
  { id: 'royal', name: '皇家', accent: '#e6c06a' },
  { id: 'dragon', name: '赤龙', accent: '#e8b24a' },
];

const BY_ID = new Map(NAMEPLATES.map((plate) => [plate.id, plate]));

export function nameplateOf(id) {
  return BY_ID.get(id) || BY_ID.get('plain');
}

// Class and custom properties for any surface that wears a nameplate; the plain one adds nothing.
export function nameplateProps(id) {
  const plate = nameplateOf(id);
  if (!plate.accent) return { className: '', style: undefined };
  return {
    className: 'has-nameplate',
    style: { '--nameplate': `url('/textures/nameplate-${plate.id}.svg')`, '--nameplate-accent': plate.accent },
  };
}

export function loadNameplate() {
  try {
    return nameplateOf(localStorage.getItem('poker_nameplate')).id;
  } catch {
    return 'plain';
  }
}

export function saveNameplate(id) {
  try {
    localStorage.setItem('poker_nameplate', nameplateOf(id).id);
  } catch {
    // storage unavailable, the choice lasts for this visit
  }
}
