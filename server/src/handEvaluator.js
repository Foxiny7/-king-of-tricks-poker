import pkg from 'pokersolver';
const { Hand } = pkg;

export function solve(cards) {
  return Hand.solve(cards);
}

export function pickWinners(hands) {
  return Hand.winners(hands);
}
