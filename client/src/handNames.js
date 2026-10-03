const NAMES_ZH = {
  'Royal Flush': '皇家同花顺',
  'Straight Flush': '同花顺',
  'Four of a Kind': '四条',
  'Full House': '葫芦',
  Flush: '同花',
  Straight: '顺子',
  'Three of a Kind': '三条',
  'Two Pair': '两对',
  Pair: '一对',
  'High Card': '高牌',
};

export function translateHandName(name) {
  return NAMES_ZH[name] || name;
}

const RANKINGS_ORDER = [
  'Royal Flush',
  'Straight Flush',
  'Four of a Kind',
  'Full House',
  'Flush',
  'Straight',
  'Three of a Kind',
  'Two Pair',
  'Pair',
  'High Card',
];

const EXAMPLE_CARDS = {
  'Royal Flush': ['As', 'Ks', 'Qs', 'Js', 'Ts'],
  'Straight Flush': ['9h', '8h', '7h', '6h', '5h'],
  'Four of a Kind': ['9c', '9d', '9h', '9s', '3c'],
  'Full House': ['8c', '8d', '8h', '3s', '3c'],
  Flush: ['Ad', '9d', '7d', '4d', '2d'],
  Straight: ['9c', '8d', '7h', '6s', '5c'],
  'Three of a Kind': ['7c', '7d', '7h', 'Ks', '2c'],
  'Two Pair': ['Jc', 'Jd', '5h', '5s', '9c'],
  Pair: ['Qc', 'Qd', '9h', '5s', '2c'],
  'High Card': ['Ac', 'Jd', '8h', '5s', '2c'],
};

export const HAND_RANKINGS_ZH = RANKINGS_ORDER.map((name) => ({
  name: translateHandName(name),
  nameEn: name,
  cards: EXAMPLE_CARDS[name],
}));
