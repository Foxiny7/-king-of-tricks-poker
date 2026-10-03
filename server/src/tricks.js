import { solve, pickWinners } from './handEvaluator.js';

export const TRICK_PHASE_HANDS = 4;
export const TRICK_PHASES = 4;
export const TRICK_SELECTION_SECONDS = 30;

const oncePerHand = new Set(['mark_chosen', 'peek_rank', 'blind_box',
  'suit_or_run', 'high_probe', 'next_high', 'reveal_one',
  'suit_shift', 'reverse_board', 'retention_common', 'next_suit',
  'immovable', 'guess_holes', 'strategy_card']);
const oncePerStreet = new Set([]);
const perPhase = new Set(['peek_both', 'reveal_loadout', 'reveal_all_loadouts', 'reveal_tax',
  'forced_fold', 'exchange', 'steal_hole', 'strength_count', 'suit_count', 'future_self',
  'bottom_deal', 'hand_scent', 'table_leader', 'discard_all', 'retention_rare', 'retention_epic',
  'blindfold', 'random_replace', 'steal_future_board', 'neighbor_swap', 'shared_rain',
  'bluff_no_board', 'blind_self_next', 'mental_block', 'river_report', 'catch_cheat',
  'yin_ghost', 'yin_buddha']);
const perPhaseUseCaps = { peek_both: 2, exchange: 2, steal_hole: 2, strength_count: 2,
  suit_count: 2, hand_scent: 2, reveal_tax: 2, discard_all: 2, retention_rare: 2,
  retention_epic: 2, random_replace: 2, steal_future_board: 2, neighbor_swap: 2,
  shared_rain: 2, bluff_no_board: 2, mental_block: 3,
  future_self: 2, river_report: 2, catch_cheat: 2, yin_ghost: 2, yin_buddha: 2 };
// The yin active tricks may also fire only once in any one hand.
const oncePerHandToo = new Set(['yin_ghost', 'yin_buddha']);
// 终极抵抗反转 cancels at most this many opposing tricks per phase.
const ULTIMATE_REFLECT_PER_PHASE = 2;
const wholeMatchUses = { peek_all: 4, intuition: 8, fate_swap: 3, swap_five: 6,
  drain_quarter: 2, drain_big: 1, peek_next: 6, steal_skill: 1, control_five: 2,
  retention_legendary: 4, disable_tricks: 4, mental_chaos: 3,
  ace_card: 2, king_card: 2, queen_card: 2, permanent_card: 2, ultimate_swap: 3,
  ban_pairs: 3, control_flop: 2 };
const perHandUseCaps = { color_bet: 1 };

function trickUsage(id, kind) {
  if (id === 'trick_reflect') return '整场最多使用复制的千术 2 次；未使用不计次';
  if (id === 'ultimate_reflect') return `每阶段最多打消 ${ULTIMATE_REFLECT_PER_PHASE} 次`;
  if (oncePerHandToo.has(id)) return `每阶段限用 ${perPhaseUseCaps[id]} 次，每局最多 1 次`;
  if (id === 'strategy_card') return '每局自动获得一张候选牌，可选用一次';
  if (kind === 'passive') return '无需手动使用；自动生效';
  if (wholeMatchUses[id]) return `整场限用 ${wholeMatchUses[id]} 次`;
  if (id === 'peek_one') return '每两局限用一次';
  if (id === 'rank_count') return '每两局限用一次';
  if (id === 'blind_next') return '每两局限用一次';
  if (perHandUseCaps[id]) return '每局限用 ' + perHandUseCaps[id] + ' 次';
  if (perPhase.has(id)) return `每阶段限用 ${perPhaseUseCaps[id] || 1} 次`;
  if (oncePerHand.has(id)) return '每局限用一次';
  return '不限制次数';
}

function remainingUsage(room, playerId, trick) {
  const uses = useRecord(room, playerId, trick.id).uses;
  const handNumber = room.trickMatch.handNumber;
  const phase = Math.ceil(handNumber / TRICK_PHASE_HANDS);
  const id = trick.id;
  if (id === 'trick_reflect') return `整场剩余 ${Math.max(0, 2 - uses.length)} / 2 次`;
  if (id === 'ultimate_reflect') {
    const used = uses.filter((n) => Math.ceil(n / TRICK_PHASE_HANDS) === phase).length;
    return `本阶段剩余 ${Math.max(0, ULTIMATE_REFLECT_PER_PHASE - used)} / ${ULTIMATE_REFLECT_PER_PHASE} 次`;
  }
  if (id === 'strategy_card')
    return `本局剩余 ${room.hand?.trickUsedThisHand?.has(`${playerId}:${id}`) ? 0 : 1} / 1 次`;
  if (trick.kind === 'passive') return '被动生效';
  if (wholeMatchUses[id]) {
    const cap = wholeMatchUses[id];
    return `整场剩余 ${Math.max(0, cap - uses.length)} / ${cap} 次` +
      (id === 'retention_legendary' ? '（本局河牌替换不另扣）' : '');
  }
  if (['peek_one', 'rank_count', 'blind_next'].includes(id))
    return `每两局可用：${uses.length && handNumber - uses.at(-1) < 2 ? 0 : 1} / 1 次`;
  if (perHandUseCaps[id]) {
    const cap = perHandUseCaps[id];
    return `本局剩余 ${Math.max(0, cap - uses.filter((n) => n === handNumber).length)} / ${cap} 次`;
  }
  if (perPhase.has(id)) {
    const cap = perPhaseUseCaps[id] || 1;
    return `本阶段剩余 ${Math.max(0, cap - uses.filter((n) => Math.ceil(n / TRICK_PHASE_HANDS) === phase).length)} / ${cap} 次` +
      (oncePerHandToo.has(id) && uses.includes(handNumber) ? '（本局已用）' : '');
  }
  if (oncePerHand.has(id))
    return `本局剩余 ${room.hand?.trickUsedThisHand?.has(`${playerId}:${id}`) ? 0 : 1} / 1 次`;
  return '不限次数';
}

function trickCondition(id, kind) {
  if (kind === 'passive') {
    const triggers = {
      mark_one: '每局发牌后，随机查看一名对手两张底牌的红黑。',
      mark_both: '每局发牌后，查看所有对手两张起始底牌的红黑。',
      pocket_count: '每局发牌后触发。', pocket_names: '每局发牌后触发。',
      clock_common: '整场游戏持续生效。', clock_rare: '整场游戏持续生效。',
      guard_rare: '持有期间持续生效。', guard_epic: '持有期间持续生效。',
      retention_common: '每局摸五张，翻牌前从前三张候选中选两张。',
      retention_rare: '每局摸七张，翻牌前从前三张候选中选两张。',
      retention_epic: '每局摸八张，翻牌前从前四张候选中选两张。',
      retention_legendary: '每局摸十张，翻牌前从前五张候选中选两张。',
      discard_one: '首位玩家弃牌时触发。', discard_all: '有玩家弃牌时触发。',
      counterfeit_alert: '首次有对手窥视或交换你的底牌时触发。',
      skill_trace: '有对手使用主动千术时触发（无声手法除外）。',
      red_balance: '每局发牌后触发。', ace_alarm: '每局发牌后触发。',
      face_tally: '每局发牌后触发。', blind_refund: '翻前记录等于一个大盲的下注，翻牌后返还。',
      quiet_move: '持有期间持续生效。',
      discard_both: '本局有玩家弃牌时自动私下获知其底牌。',
      reveal_all_loadouts: '持有期间私下获知其他玩家的千术。',
      next_color: '翻牌后自动私下获知转牌与河牌的红黑。',
      shoe_shine: '河牌单挑获胜时，按本局开局人数从落败者收取大盲。',
      card_fairy: '每次以两对或更高牌型赢牌时获得随机普通千术。',
      fake_intel: '别人对你取得的所有千术情报自动变为假信息。',
      sharingan: '选中时，从每名其他玩家已持有的千术中随机获得一项。',
      strategy_card: '每局开局自动获得一张候选牌；替换操作只能在自己的行动回合完成。',
      yin_yang: '每局开局获知第五张公牌；局中看不到第三张公牌。',
      fake_public: '每局开局向全桌公布一条关于自己底牌点数的假情报。',
      black_tide: '每局开局私下获知对手底牌中的黑牌张数。',
      ascended: '每局开始向全桌公告已经登神。',
      drain_small: '每局结算前自动触发；底池至少有五个小盲。',
      ground_below: '选中时立即触发。', ground_middle: '选中时立即触发。',
      sky_below: '选中时立即触发。', sky_outside: '选中时立即触发；不会获得自我暗示。',
      chaos_child: '仅第三、四阶段可选；选中时立即触发。',
      trick_reflect: '本局被主动千术作用时触发；复制品用掉后才计次数。',
      trick_meditation: '仅第一、二阶段可选；下一阶段选术时生效。',
      extra_refresh: '仅前三阶段可选；以后每次选术时生效。',
      trick_resistance: '每阶段首次被换牌千术作用时自动触发。',
      purist: '每局发底牌时生效。',
      self_suggestion: '第一阶段不会出现；选中时立即触发。',
      ladder_one: '仅第一阶段可选；下一阶段开始时触发。',
      ladder_two: '仅第二阶段可选；下一阶段开始时触发。',
      ladder_three: '仅第三阶段可选；下一阶段开始时触发。',
      quantity_wins: '仅第四阶段可选；选中时立即触发，不能由其他千术获得。',
      ultimate_reflect: '被对手的主动千术作用时自动触发（指定你为目标、换你的牌、收你的筹码等）。',
    };
    return triggers[id] || '满足牌面效果条件时自动触发。';
  }

  const conditions = {
    mark_chosen: '牌局中随时使用；获知未受防窥保护玩家的部分牌面信息。',
    river_report: '仅河牌阶段使用；最高牌型包含弃牌者。',
    shared_rain: '牌局中随时使用；跳过受防窥保护的玩家。',
    peek_rank: '牌局中随时使用；指定一名未受防窥保护的对手。',
    peek_one: '牌局中随时使用；指定未受防窥保护的对手及其一张底牌。',
    peek_both: '牌局中随时使用；指定一名未受防窥保护的对手。',
    peek_all: '牌局中随时使用；查看所有未受防窥保护的对手。',
    swap_five: '仅自己的行动回合且限翻前；从五张候选牌中选两张。',
    retention_common: '仅翻牌前自己的行动回合；从前三张候选牌中选两张。',
    retention_rare: '仅翻牌前自己的行动回合；从前三张候选牌中选两张。',
    retention_epic: '仅翻牌前自己的行动回合；从前四张候选牌中选两张。',
    retention_legendary: '翻前自选两张底牌；河牌回合可用备用牌换一张底牌。',
    control_five: '仅翻牌阶段自己的行动回合，指定转牌和河牌。',
    permanent_card: '自己的行动回合，从未使用牌中随机取 A 和 K 替换两张底牌。',
    exchange: '仅自己的行动回合；指定一名未全下、未受史诗防窥保护的对手。',
    drain_big: '前三阶段自己的行动回合，随机抽取一位相邻玩家。',
    drain_quarter: '河牌前自己的行动回合，抽取金额至少 10 筹码。',
    forced_fold: '河牌阶段自己的行动回合；指定尚未行动的后位玩家，支付四分之一底池。',
    blindfold: '仅翻牌前自己的行动回合；指定一名目标。',
    catch_cheat: '仅河牌阶段自己的行动回合；目标至少有二十个大盲。目标本局没用过主动千术时本次落空，仍消耗次数。',
    steal_future_board: '仅翻牌阶段自己的行动回合；与未揭晓的转牌和河牌交换。',
    discard_all: '仅自己行动时；从已公开的弃牌中选一张替换底牌。',
    suit_or_run: '牌局中随时使用；指定一名未受防窥保护的对手。',
    reveal_tax: '仅自己的行动回合；公开自己的底牌，从筹码足够的对手收取大盲。',
    discard_both: '牌局中随时使用；指定一名已弃牌且未受防窥保护的对手。',
    suit_count: '牌局中随时查看未使用牌。',
    blind_box: '牌局中随时查看三张随机未使用牌。',
    intuition: '翻牌后使用；指定一名未受防窥保护的对手。',
    fate_swap: '仅自己的行动回合且在翻牌阶段；与当前最大牌型玩家交换底牌，对方已全下时不能使用。',
    high_probe: '牌局中随时使用；指定一名未受防窥保护的对手。',
    next_color: '河牌前使用；查看下一张公共牌的红黑。',
    next_high: '河牌前使用；查看下一张公共牌点数是否达到 10。',
    future_self: '翻牌后、河牌前使用。',
    color_bet: '仅自己的行动回合且河牌前；猜河牌的花色，本局结束结算。',
    board_audit: '仅河牌阶段自己的行动回合；令本局用千术换过公牌且未全下的玩家弃牌。',
    yin_ghost: '使用后下一局生效，开局获知转牌和河牌，但看不到前三张公牌；每局最多发动一次。',
    yin_buddha: '使用后下一局生效，开局获知前三张公牌，但看不到转牌和河牌；每局最多发动一次。',
    strategy_card: '每局开局获一张候选牌；翻前可换一张底牌，否则转牌阶段可换河牌。',
    bottom_deal: '仅自己的行动回合；选择自己的一张底牌替换。',
    reveal_one: '牌局中随时使用；指定一名已有千术的对手。',
    rank_count: '牌局中随时使用；只数尚未发出的牌，不含已翻出的公牌。',
    hand_scent: '翻牌后使用；指定一名未受防窥保护的对手。',
    peek_next: '河牌前使用；查看下一张公共牌。',
    table_leader: '仅河牌阶段使用；只比较未弃牌且未受防窥保护的玩家。',
    steal_skill: '自己的行动回合使用；随机取得目标一项千术，替换偷师。',
    suit_shift: '仅自己的行动回合；选择底牌，牌堆中须有同点数的不同花色牌。',
    next_suit: '河牌前使用；查看下一张公共牌花色。',
    strength_count: '翻牌后使用；比较未弃牌且未受防窥保护的对手。',
    reverse_board: '仅翻牌前自己的行动回合。',
    bluff_no_board: '仅翻前或翻牌阶段自己的行动回合。',
    blind_next: '自己的行动回合指定一名下一局仍在场的对手。',
    blind_self_next: '自己的行动回合发动，效果在下一局生效。',
    mental_block: '翻牌后在自己的行动回合指定一名对手。',
    immovable: '底牌保护持有期间一直生效；锁定公共牌在转牌翻出前随时可用（不必轮到自己），每局一次。',
    control_flop: '仅翻牌前自己的行动回合；从八张随机牌中按顺序选三张翻牌。',
    guess_holes: '河牌翻出前自己的行动回合，指定对手并猜两张底牌点数。',
    ultimate_swap: '自己的行动回合；从可换的对手底牌中选点数最大的两张，只有分别高于自己对应底牌时才交换；已全下的对手不在其中。',
    ban_pairs: '自己的行动回合，点选一张已翻出的公牌；已全下的玩家不受影响。',
    steal_hole: '仅自己的行动回合；指定未弃牌、未全下且未受史诗防窥保护的对手。',
    reveal_loadout: '牌局中随时使用；指定一名对手。',
    reveal_all_loadouts: '牌局中随时使用；查看本局所有对手。',
    random_replace: '自己的行动回合；只从可换牌的玩家中随机选目标，已全下的玩家除外。',
    neighbor_swap: '自己的行动回合；至少三名未弃牌的玩家在局，且左右最近的两位未弃牌玩家都未全下、未受换牌保护。',
    disable_tricks: '自己的行动回合；指定本局仍在场的对手。',
    mental_chaos: '自己的行动回合；已全下或受换牌保护的对手不受影响。',
    ace_card: '自己的行动回合；牌堆须有可用的 A。',
    king_card: '自己的行动回合；牌堆须有可用的 K。',
    queen_card: '自己的行动回合；牌堆须有可用的 Q。',
  };
  return conditions[id] || (kind === 'change'
    ? '仅在自己的行动回合使用。'
    : '牌局结束前可使用，不占行动回合。');
}

const definitions = [
  ['mark_one', '暗纹·浅痕', 'mark', 'common', 'passive', '开局查看一名随机对手两张底牌各自的红黑。'],
  ['mark_both', '暗纹·群影', 'mark', 'rare', 'passive', '查看所有对手起始底牌的红黑；之后换牌不会更新这份情报。'],
  ['mark_chosen', '暗纹·锁痕', 'mark', 'epic', 'read', '查看每名对手一张底牌的红黑、另一张的具体花色，以及第一张翻牌的花色。'],
  ['peek_rank', '窥底·识点', 'peek', 'common', 'read', '查看指定对手一张随机底牌的点数。'],
  ['peek_one', '窥底·真相', 'peek', 'rare', 'read', '完整查看指定对手的一张指定底牌。'],
  ['peek_both', '窥底·透视', 'peek', 'epic', 'read', '完整查看指定对手的两张底牌。'],
  ['peek_all', '天眼', 'peek', 'legendary', 'read', '完整查看所有未受防窥保护的对手底牌。'],
  ['pocket_count', '对子警报', 'pocket', 'common', 'passive', '得知有几名对手拿到口袋对子。'],
  ['pocket_names', '对子点名', 'pocket', 'rare', 'passive', '得知谁拿到口袋对子，以及对子点数是否不大于 8。'],
  ['clock_common', '读秒·缓时', 'clock', 'common', 'passive', '你的每次行动时间增加 10 秒。'],
  ['clock_rare', '读秒·夺时', 'clock', 'rare', 'passive', '你的每次行动增加 10 秒，其他玩家各减少 15 秒。'],
  ['guard_rare', '防窥·遮影', 'guard', 'rare', 'passive', '对手无法窥视你的底牌，但仍能用千术转移它们。'],
  ['guard_epic', '防窥·封牌', 'guard', 'epic', 'passive', '对手无法窥视或转移你的底牌；正常摊牌不受影响。'],
  ['swap_five', '换底·五选二', 'swap', 'epic', 'change', '从当前两张底牌和三张随机牌中挑选两张，作为新的底牌。'],
  ['control_five', '定河山', 'control', 'legendary', 'change', '从十张随机牌中按顺序指定转牌和河牌。'],
  ['exchange', '乾坤错位', 'exchange', 'legendary', 'change', '与指定对手交换双方各一张指定底牌，或直接交换两张底牌。'],
  ['drain_small', '抽筹·探囊', 'drain', 'common', 'passive', '底池至少有五个小盲时，结算前随机抽走一至五个小盲。'],
  ['drain_big', '抽筹·顺手', 'drain', 'rare', 'change', '随机从左邻或右邻取走其筹码的四分之一，向下取整到十。'],
  ['drain_quarter', '抽筹·截流', 'drain', 'epic', 'change', '从底池抽走一半筹码，向下取整到十的倍数。'],
  ['retention_common', '留底·五留二', 'retention', 'common', 'change', '每局抽五张牌：从前三张挑两张作底牌；其余两张只供你查看，不再入局。'],
  ['retention_rare', '留底·七留二', 'retention', 'rare', 'change', '每局抽七张牌：从前三张挑两张作底牌；其余四张只供你查看，不再入局。'],
  ['retention_epic', '留底·八留四', 'retention', 'epic', 'change', '每局抽八张牌：从前四张挑两张作底牌；其余四张只供你查看，不再入局。'],
  ['retention_legendary', '留底·釜底抽薪', 'retention', 'legendary', 'change', '每局抽十张牌：翻前从前五张挑两张作底牌；河牌时可用后五张中的一张替换底牌。'],
  ['discard_one', '废牌·拾遗', 'discard', 'common', 'passive', '私下查看本局首位弃牌者的两张底牌。'],
  ['discard_both', '废牌·寻迹', 'discard', 'rare', 'passive', '自动私下查看本局所有弃牌者的底牌。'],
  ['discard_all', '废牌·尽收', 'discard', 'epic', 'change', '全桌公开弃牌者的底牌；你可拿其中一张与自己的一张底牌交换。'],
  ['suit_count', '数花', 'suit_count', 'rare', 'read', '查看未使用牌中四种花色各剩多少张。'],
  ['forced_fold', '赠筹·买断', 'forced_fold', 'epic', 'change', '支付底池四分之一给后位对手；等他行动时只能弃牌，但仍可使用千术。'],
  ['suit_or_run', '同花顺识别', 'suit_or_run', 'common', 'read', '判断指定对手的两张底牌是否同花或点数相连；A2、AK 也算相连。'],
  ['reveal_tax', '亮牌换筹', 'reveal_tax', 'rare', 'change', '公开自己的底牌，并从每名筹码足够的对手手中收取一个大盲。'],
  ['blind_box', '盲盒', 'blind_box', 'common', 'read', '私下查看三张随机未使用牌。'],
  ['counterfeit_alert', '第六感', 'counterfeit_alert', 'common', 'passive', '首次被对手窥牌或换牌时，得知是谁及其使用的千术。'],
  ['board_audit', '我要验牌', 'board_audit', 'common', 'change', '查出本局用千术换过公牌的对手，并让尚未全下者立即弃牌。'],
  ['skill_trace', '破局录', 'skill_trace', 'common', 'passive', '每名对手首次使用主动千术时，私下得知其千术名称。'],
  ['reveal_loadout', '起底', 'reveal_loadout', 'rare', 'read', '私下查看指定对手持有的全部千术，以及两张底牌的点数。'],
  ['river_report', '河牌公报', 'river_report', 'epic', 'read', '私下得知全桌最高牌型，并向全桌公告其是否达到两对。'],
  ['intuition', '胜负直觉', 'intuition', 'legendary', 'read', '比较你与指定对手当前的牌力，得知领先、落后或持平。'],
  ['fate_swap', '天命易手', 'fate_swap', 'legendary', 'change', '与当前牌力最强的一名随机对手交换两张底牌。'],
  ['high_probe', '高张试探', 'high_probe', 'common', 'read', '判断指定对手是否持有 J、Q、K 或 A。'],
  ['red_balance', '红潮', 'red_balance', 'common', 'passive', '得知其他玩家底牌中共有几张红牌。'],
  ['ace_alarm', '牌兆·王牌气息', 'face_signal', 'common', 'passive', '得知是否有对手握有 A。'],
  ['face_tally', '牌兆·花牌点名', 'face_signal', 'rare', 'passive', '得知有几名对手握有 J、Q 或 K。'],
  ['next_color', '听色', 'next_color', 'common', 'passive', '私下得知转牌和河牌各自的红黑。'],
  ['next_high', '望高', 'next_high', 'common', 'read', '判断下一张公共牌的点数是否至少为 10。'],
  ['future_self', '自照', 'future_self', 'rare', 'read', '判断下一张公共牌能否提升你当前的牌型等级。'],
  ['blind_refund', '盲注回声', 'blind_refund', 'common', 'passive', '翻前每有一人的总下注恰好等于一个大盲，翻牌后便从底池取回一个大盲。'],
  ['quiet_move', '无声手法', 'quiet_move', 'common', 'passive', '其他玩家不会察觉你使用千术；目标必须收到的效果通知仍会送达。'],
  ['color_bet', '押色', 'color_bet', 'common', 'change', '猜中河牌花色后，在本局结算时向每名对手收取一个大盲。'],
  ['bottom_deal', '底张', 'bottom_deal', 'common', 'change', '将自己指定的一张底牌换成牌堆最底下的牌。'],
  ['reveal_one', '探术', 'reveal_loadout', 'common', 'read', '随机得知指定对手持有的一项千术名称。'],
  ['rank_count', '算牌', 'rank_count', 'rare', 'read', '查看与你底牌同点数的牌，在牌堆中还剩多少张。'],
  ['hand_scent', '牌型嗅觉', 'hand_scent', 'rare', 'read', '得知指定对手当前的牌型类别。'],
  ['peek_next', '天窗', 'peek_next', 'rare', 'read', '完整查看下一张尚未翻出的公共牌。'],
  ['table_leader', '抬眼', 'table_leader', 'rare', 'read', '从最高牌型类别的玩家中随机指出一人；不保证他实际牌力最强。'],
  ['steal_skill', '偷师', 'steal_skill', 'rare', 'change', '获得指定对手的一项随机千术，并以它永久替换“偷师”。'],
  ['suit_shift', '改花', 'suit_shift', 'rare', 'change', '将指定底牌换成牌堆中同点数、不同花色的随机牌。'],
  ['next_suit', '风向', 'next_suit', 'rare', 'read', '私下得知下一张公共牌的花色。'],
  ['strength_count', '几分胜算', 'strength_count', 'rare', 'read', '得知当前有几名未受防窥保护的对手牌力高于你。'],
  ['reverse_board', '倒序', 'reverse_board', 'rare', 'change', '预先锁定本局五张公共牌，改按第 5 张至第 1 张的顺序翻出。'],
  ['steal_hole', '偷梁入手', 'steal_hole', 'epic', 'change', '将指定对手的一张底牌，与你的一张随机底牌交换。'],
  ['reveal_all_loadouts', '千术点将', 'reveal_loadout', 'epic', 'passive', '私下得知所有对手持有的千术。'],
  ['ground_below', '地底之下', 'ground_below', 'common', 'passive', '选中时额外获得一项随机罕见千术。'],
  ['random_replace', '无冤无仇', 'random_replace', 'common', 'change', '随机更换一名可换牌玩家的一张底牌；也可能抽中你自己。'],
  ['blindfold', '特异功能·掩目', 'blindfold', 'common', 'change', '让指定对手看不见前三张翻牌，直到河牌阶段。'],
  ['ground_middle', '地面之中', 'ground_middle', 'rare', 'passive', '选中时额外获得一项随机史诗千术。'],
  ['steal_future_board', '探囊取物', 'steal_future_board', 'rare', 'change', '用自己的两张底牌，与尚未揭晓的转牌和河牌交换。'],
  ['catch_cheat', '捉千', 'catch_cheat', 'rare', 'change', '从本局用过主动千术的指定对手那里收取二十个大盲；若对方本局没用过，本次落空并消耗次数。'],
  ['sky_below', '天空之下', 'sky_below', 'epic', 'passive', '选中时额外获得两项随机罕见千术。'],
  ['chaos_child', '混沌之子', 'chaos_child', 'epic', 'passive', '选中时将自己所有千术（包括此术）随机替换为同样数量的史诗千术（不含自我暗示）。'],
  ['neighbor_swap', '左邻右舍', 'neighbor_swap', 'epic', 'change', '交换左邻的右侧底牌和右邻的左侧底牌（跳过已弃牌的玩家）。'],
  ['disable_tricks', '功力耗尽', 'disable_tricks', 'epic', 'change', '令指定对手本局无法发动千术。'],
  ['trick_reflect', '千术反转', 'trick_reflect', 'epic', 'passive', '被主动千术作用时，临时获得该千术；本局未使用则不消耗次数。'],
  ['sky_outside', '天空之外', 'sky_outside', 'legendary', 'passive', '选中时额外获得两项随机史诗千术。'],
  ['permanent_card', '云中探花手', 'permanent_card', 'legendary', 'change', '用未使用牌中随机花色的一张 A 和一张 K，替换自己的两张底牌。'],
  ['mental_chaos', '特异功能·精神错乱', 'mental_chaos', 'legendary', 'change', '立刻把所有其他玩家的两张底牌随机更换。'],
  ['ace_card', '一张ACE', 'ace_card', 'epic', 'change', '用牌堆里随机一张 A，替换自己点数较小的底牌。'],
  ['king_card', '一张King', 'king_card', 'epic', 'change', '用牌堆里随机一张 K，替换自己点数较小的底牌。'],
  ['queen_card', '一张Queen', 'queen_card', 'epic', 'change', '用牌堆里随机一张 Q，替换自己点数较小的底牌。'],
  ['trick_meditation', '千术冥想', 'trick_meditation', 'common', 'passive', '下次选术时，各栏位若抽到普通品质则改抽罕见，抽到罕见则改抽史诗。'],
  ['extra_refresh', '千术多多', 'extra_refresh', 'common', 'passive', '以后选术时，每个候选栏位都多一次刷新机会。'],
  ['trick_resistance', '千术抵抗', 'trick_resistance', 'common', 'passive', '每阶段第一次受到换牌千术作用时，抵消整次效果；对方仍消耗使用次数。'],
  ['purist', '纯粹主义者', 'purist', 'common', 'passive', '初始发牌不会拿到 2 或 7；之后仍可能被千术换入。'],
  ['shared_rain', '雨露均沾', 'shared_rain', 'epic', 'read', '私下得知所有未受防窥保护玩家较小底牌的点数。'],
  ['bluff_no_board', '摆份·不需要公牌', 'bluff', 'common', 'change', '本局看不到河牌；若赢牌，从每名弃牌者手中收取十个小盲。'],
  ['blind_next', '摆份·跟你盲开', 'bluff', 'rare', 'change', '指定一名对手；下一局你们双方都看不到自己的底牌。'],
  ['blind_self_next', '摆份·无需看牌', 'bluff', 'epic', 'change', '下一局看不到自己的底牌；若河牌仍未弃且最终为高牌，从赢家收取等于底池的筹码，并向其他玩家各收一个小盲。'],
  ['mental_block', '特异功能·意念闭塞', 'mental_block', 'epic', 'change', '盖住指定对手的底牌，使其在本局结束前无法查看。'],
  ['shoe_shine', '给我擦皮鞋', 'shoe_shine', 'common', 'passive', '河牌单挑并获胜时，从落败者手中收取本局开局人数个大盲。'],
  ['card_fairy', '牌仙子', 'card_fairy', 'rare', 'passive', '以两对或更高牌型赢牌时，额外获得一项随机普通千术；持有数量可超过四项。'],
  ['fake_intel', '你真的看清楚了吗', 'fake_intel', 'epic', 'passive', '对手对你取得的千术情报会变假：点数报 2～9，花色和红黑随机，牌型报高牌。'],
  ['self_suggestion', '自我暗示', 'self_suggestion', 'epic', 'passive', '选中时失去已持有的全部千术，换取一项随机传说千术。'],
  ['immovable', '不动如山', 'immovable', 'legendary', 'change', '你的底牌永久不能被其他玩家的千术替换；每局可在转牌翻出前，锁定转牌或河牌中的一张，任何千术都不能再替换它。'],
  ['guess_holes', '管中窥豹', 'guess_holes', 'legendary', 'change', '猜中指定对手两张底牌的点数后，令他下次行动只能弃牌。'],
  ['ultimate_swap', '终极替换', 'ultimate_swap', 'legendary', 'change', '找出可换的对手底牌中点数最大的两张；只有高于你对应位置的底牌时才逐张交换。'],
  ['ban_pairs', '禁止成对', 'ban_pairs', 'legendary', 'change', '点选一张已翻出的公共牌，随机换掉其他玩家所有同点数的底牌。'],
  ['sharingan', '写轮眼', 'sharingan', 'legendary', 'passive', '从场上每名其他玩家持有的千术中，各随机获得一项。'],
  ['yin_yang', '阴间·阴阳眼', 'yin', 'common', 'passive', '开局预知第五张公共牌，但本局看不到第三张公共牌。'],
  ['yin_ghost', '阴间·鬼眼', 'yin', 'rare', 'read', '发动后的下一局，开局预知转牌和河牌，但看不到前三张公共牌。'],
  ['yin_buddha', '阴间·佛眼', 'yin', 'epic', 'read', '发动后的下一局，开局预知前三张公共牌，但看不到转牌和河牌。'],
  ['fake_public', '搅屎棍', 'fake_public', 'common', 'passive', '向全桌公布一条关于你底牌点数的假情报；不影响其他真实情报。'],
  ['black_tide', '黑潮', 'black_tide', 'common', 'passive', '开局私下得知其他玩家底牌里共有几张黑牌。'],
  ['ladder_one', '登神阶梯I', 'ladder', 'common', 'passive', '下一阶段开始时获得一项随机罕见千术，自身变为“登神阶梯II”。'],
  ['ladder_two', '登神阶梯II', 'ladder', 'rare', 'passive', '下一阶段开始时获得一项随机史诗千术，自身变为“登神阶梯III”。'],
  ['ladder_three', '登神阶梯III', 'ladder', 'epic', 'passive', '下一阶段开始时获得一项随机传说千术，自身变为“登神”。'],
  ['ascended', '登神', 'ladder', 'legendary', 'passive', '每局开始向全桌公告：你已经登神。'],
  ['quantity_wins', '以量取胜', 'quantity_wins', 'legendary', 'passive', '移除已持有的全部千术，随机获得十项普通或罕见千术。'],
  ['ultimate_reflect', '终极抵抗反转', 'ultimate_reflect', 'legendary', 'passive', '每阶段两次：被对手的主动千术作用时，打消对方这次使用（对方仍消耗次数），并在本局临时获得该千术。'],
  ['control_flop', '定江山', 'control_flop', 'legendary', 'change', '从八张随机牌中按顺序指定三张翻牌。'],
  ['strategy_card', '运筹帷幄', 'strategy_card', 'legendary', 'passive', '每局开局获得一张候选牌；翻前可换一张底牌，若没有使用，转牌时可改作河牌。'],
];

export const TRICKS = Object.freeze(Object.fromEntries(definitions.map(
  ([id, name, family, rarity, kind, description]) => [id, {
    id, name, family, rarity, kind, description,
    usage: trickUsage(id, kind), condition: trickCondition(id, kind),
  }]
)));

const rarityWeights = [['common', 45], ['rare', 30], ['epic', 15], ['legendary', 10]];
const upgradeOrder = ['common', 'rare', 'epic'];

function randomItem(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

function owned(room, playerId) {
  return room.trickMatch?.owned.get(playerId) || [];
}

export function hasTrick(room, playerId, id) {
  return owned(room, playerId).includes(id) &&
    !(room.hand?.stage !== 'SHOWDOWN' && room.hand?.trickDisabled?.has(playerId));
}

function activeThisHand(room, playerId, id) {
  return owned(room, playerId).includes(id) && !room.hand?.trickDisabled?.has(playerId);
}

export function retentionDrawCount(room, playerId) {
  const id = owned(room, playerId).find((trickId) => TRICKS[trickId].family === 'retention');
  return id ? { retention_common: 5, retention_rare: 7, retention_epic: 8, retention_legendary: 10 }[id] : 2;
}

function availablePot(room) {
  return Math.max(0, room.players.reduce((sum, player) => sum + player.betThisHand, 0) -
    (room.hand?.trickPotDrain || 0));
}

function potDrainAmount(room, trickId) {
  const pot = availablePot(room);
  if (trickId === 'drain_small') return pot >= 5 * room.smallBlind ? room.smallBlind : 0;
  if (trickId === 'drain_big') return room.trickMatch && Math.ceil(room.trickMatch.handNumber / 4) < 4
    ? 10 : 0;
  return room.hand?.stage === 'RIVER' ? 0 : Math.floor(pot / 20) * 10;
}

export function trickTurnSeconds(room, playerId) {
  if (!room.trickMatch) return 30;
  const mine = owned(room, playerId);
  const otherRare = room.players.filter((p) => p.id !== playerId && !p.kicked &&
    hasTrick(room, p.id, 'clock_rare')).length;
  return Math.max(5, 30 + (mine.some((id) => TRICKS[id]?.family === 'clock') ? 10 : 0) - otherRare * 15);
}

export function beginTrickMatch(room) {
  room.trickMatch = {
    handNumber: 0,
    owned: new Map(),
    uses: new Map(),
    picks: new Map(),
    selection: null,
    retentionOwner: null,
    blindRefundOwner: null,
    clockPhaseOwners: new Map(),
    traceSeen: new Map(),
    meditationNextPhase: new Map(),
    resistanceUsedPhases: new Map(),
    pendingBlindEffects: [],
    pendingYinEffects: [],
  };
  return beginTrickSelection(room);
}

function eligibleTricks(room, playerId, chosenFamilies, allowCommonReward = false) {
  const ownFamilies = new Set(owned(room, playerId).map((id) => TRICKS[id].family));
  const phase = Math.floor(room.trickMatch.handNumber / TRICK_PHASE_HANDS) + 1;
  return Object.values(TRICKS).filter((trick) =>
    trick.id !== 'ascended' &&
    rarityAllowedInPhase(trick, phase, allowCommonReward) &&
    !ownFamilies.has(trick.family) && !chosenFamilies.has(trick.family) &&
    !(trick.family === 'clock' && room.trickMatch.clockPhaseOwners.get(phase) !== undefined) &&
    !(trick.family === 'retention' && room.trickMatch.retentionOwner && room.trickMatch.retentionOwner !== playerId) &&
    !(trick.id === 'blind_refund' && room.trickMatch.blindRefundOwner &&
      room.trickMatch.blindRefundOwner !== playerId) &&
    !(trick.id === 'drain_big' && phase === TRICK_PHASES) &&
    !(trick.id === 'chaos_child' && phase < 3) &&
    !(trick.id === 'retention_legendary' && room.trickMatch.handNumber < 8)
  );
}

function rarityAllowedInPhase(trick, phase, allowCommonReward = false) {
  return !(phase === 1 && trick.rarity === 'legendary') &&
    !(phase === TRICK_PHASES && trick.rarity === 'common' && !allowCommonReward) &&
    !(phase === 1 && trick.id === 'self_suggestion') &&
    !(trick.id === 'trick_meditation' && phase > 2) &&
    !(trick.id === 'chaos_child' && phase < 3) &&
    !(trick.id === 'ladder_one' && phase !== 1) &&
    !(trick.id === 'ladder_two' && phase !== 2) &&
    !(trick.id === 'ladder_three' && phase !== 3) &&
    trick.id !== 'ascended' &&
    !(trick.id === 'quantity_wins' && phase !== 4);
}

function pickRarity(eligible, random) {
  const present = rarityWeights.filter(([rarity]) => eligible.some((trick) => trick.rarity === rarity));
  const totalWeight = present.reduce((sum, [, weight]) => sum + weight, 0);
  const roll = random() * totalWeight;
  let total = 0;
  return present.find(([, weight]) => (total += weight) > roll)?.[0];
}

function drawOfferSlot(room, playerId, chosenFamilies, random, excludedId = null) {
  const eligible = eligibleTricks(room, playerId, chosenFamilies)
    .filter((trick) => trick.id !== excludedId);
  if (!eligible.length) return null;
  const phase = Math.floor(room.trickMatch.handNumber / TRICK_PHASE_HANDS) + 1;
  const meditating = room.trickMatch.meditationNextPhase.get(playerId) === phase;
  const baseEligible = meditating ? eligible.filter((trick) =>
    trick.rarity === 'common' ? eligible.some((item) => item.rarity === 'rare') :
      trick.rarity === 'rare' ? eligible.some((item) => item.rarity === 'epic') : true) : eligible;
  const baseRarity = pickRarity(baseEligible, random);
  const wanted = meditating && ['common', 'rare'].includes(baseRarity)
    ? upgradeOrder[upgradeOrder.indexOf(baseRarity) + 1] : baseRarity;
  const bucket = eligible.filter((trick) => trick.rarity === wanted);
  return randomItem(bucket, random);
}

function drawOffer(room, playerId, random) {
  const result = [];
  const chosenFamilies = new Set();
  for (let i = 0; i < 3; i++) {
    const pick = drawOfferSlot(room, playerId, chosenFamilies, random);
    if (!pick) break;
    result.push(pick.id);
    chosenFamilies.add(pick.family);
  }
  return result;
}

export function beginTrickSelection(room, random = Math.random) {
  const match = room.trickMatch;
  if (!match || match.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES) return null;
  if (match.retentionOwner) {
    const owner = room.findPlayer(match.retentionOwner);
    if (!owner || owner.kicked || owner.eliminated) match.retentionOwner = null;
  }
  if (match.blindRefundOwner) {
    const owner = room.findPlayer(match.blindRefundOwner);
    if (!owner || owner.kicked || owner.eliminated) match.blindRefundOwner = null;
  }
  const phase = Math.floor(match.handNumber / TRICK_PHASE_HANDS) + 1;
  if (match.handNumber > 0 && match.handNumber % TRICK_PHASE_HANDS === 0) {
    const steps = [null, 'ladder_one', 'ladder_two', 'ladder_three'];
    const rewards = [null, 'rare', 'epic', 'legendary'];
    const next = [null, 'ladder_two', 'ladder_three', 'ascended'];
    for (const player of room.players) {
      const previous = steps[phase - 1];
      if (!previous || !owned(room, player.id).includes(previous)) continue;
      match.owned.set(player.id, owned(room, player.id).map((id) => id === previous ? next[phase - 1] : id));
      grantRandomTricks(room, player.id, [rewards[phase - 1]], 1, random);
    }
  }
  const offers = new Map();
  const chosen = new Set();
  const players = room.players.filter((p) => !p.kicked && !p.eliminated &&
    p.chips >= room.bigBlind && !p.waitingForNextHand &&
    (match.picks.get(p.id) || 0) < phase);
  for (const player of players) {
    offers.set(player.id, drawOffer(room, player.id, random));
  }
  match.selection = { phase, offers, chosen, refreshed: new Map(),
    deadline: Date.now() + TRICK_SELECTION_SECONDS * 1000 };
  return match.selection;
}

export function refreshTrickOffer(room, playerId, slotIndex, random = Math.random) {
  const selection = room.trickMatch?.selection;
  const offer = selection?.offers.get(playerId);
  const player = room.findPlayer(playerId);
  if (!offer || selection.chosen.has(playerId) || !player || player.kicked || player.eliminated)
    throw new Error('当前不能刷新千术');
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= offer.length)
    throw new Error('无效的候选栏位');
  const refreshed = selection.refreshed.get(playerId) || new Map();
  const limit = hasTrick(room, playerId, 'extra_refresh') ? 3 : 2;
  if ((refreshed.get(slotIndex) || 0) >= limit) throw new Error('该栏位已经刷新过');
  const families = new Set(offer.filter((_, index) => index !== slotIndex).map((id) => TRICKS[id].family));
  const replacement = drawOfferSlot(room, playerId, families, random, offer[slotIndex]);
  if (!replacement) throw new Error('没有可刷新的千术');
  offer[slotIndex] = replacement.id;
  refreshed.set(slotIndex, (refreshed.get(slotIndex) || 0) + 1);
  selection.refreshed.set(playerId, refreshed);
  return replacement.id;
}

function grantRandomTricks(room, playerId, rarities, count, random = Math.random, excluded = []) {
  const match = room.trickMatch;
  const granted = [];
  for (let i = 0; i < count; i++) {
    const candidates = eligibleTricks(room, playerId, new Set(), true)
      .filter((trick) => rarities.includes(trick.rarity) &&
        trick.id !== 'quantity_wins' && !excluded.includes(trick.id));
    if (!candidates.length) break;
    const trick = randomItem(candidates, random);
    match.owned.set(playerId, [...owned(room, playerId), trick.id]);
    if (trick.family === 'retention') match.retentionOwner = playerId;
    if (trick.id === 'blind_refund') match.blindRefundOwner = playerId;
    if (trick.family === 'clock') {
      const phase = Math.floor(match.handNumber / TRICK_PHASE_HANDS) + 1;
      match.clockPhaseOwners.set(phase, playerId);
    }
    granted.push(trick.id);
    grantSelectionBonus(room, playerId, trick.id, random);
  }
  return granted;
}

// Bonus tricks land silently in the loadout, so say which ones arrived.
function grantBonusTricks(room, playerId, sourceId, rarities, count, random, excluded) {
  const earlier = room.hand?.trickMessages.get(playerId)?.length || 0;
  const granted = grantRandomTricks(room, playerId, rarities, count, random, excluded);
  addTrickMessage(room, playerId, granted.length
    ? `${TRICKS[sourceId].name}：额外获得 ${granted.map((id) => TRICKS[id].name).join('、')}`
    : `${TRICKS[sourceId].name}：暂时没有可获得的千术`);
  // A bonus that itself grants more (天空之外 → 天空之下) reads outer first.
  const messages = room.hand?.trickMessages.get(playerId);
  if (messages && messages.length - 1 > earlier) messages.splice(earlier, 0, messages.pop());
}

function grantSelectionBonus(room, playerId, trickId, random = Math.random) {
  if (trickId === 'trick_meditation')
    room.trickMatch.meditationNextPhase.set(playerId,
      Math.floor(room.trickMatch.handNumber / TRICK_PHASE_HANDS) + 2);
  if (trickId === 'ground_below') grantBonusTricks(room, playerId, trickId, ['rare'], 1, random);
  if (trickId === 'ground_middle') grantBonusTricks(room, playerId, trickId, ['epic'], 1, random);
  if (trickId === 'sky_below') grantBonusTricks(room, playerId, trickId, ['rare'], 2, random);
  if (trickId === 'sky_outside') grantBonusTricks(room, playerId, trickId, ['epic'], 2, random, ['self_suggestion']);
  if (trickId === 'quantity_wins') {
    const match = room.trickMatch;
    if (match.retentionOwner === playerId) match.retentionOwner = null;
    if (match.blindRefundOwner === playerId) match.blindRefundOwner = null;
    match.owned.set(playerId, []);
    grantRandomTricks(room, playerId, ['common', 'rare'], 10, random, ['ground_below', 'ground_middle']);
  }
  if (trickId === 'chaos_child') {
    const match = room.trickMatch;
    const count = owned(room, playerId).length;
    if (match.retentionOwner === playerId) match.retentionOwner = null;
    if (match.blindRefundOwner === playerId) match.blindRefundOwner = null;
    match.owned.set(playerId, []);
    for (let i = 0; i < count; i++) {
      const families = new Set(owned(room, playerId).map((id) => TRICKS[id].family));
      const candidates = Object.values(TRICKS).filter((trick) =>
        trick.rarity === 'epic' &&
        rarityAllowedInPhase(trick, Math.floor(match.handNumber / TRICK_PHASE_HANDS) + 1, true) &&
        !['chaos_child', 'self_suggestion', 'sky_below'].includes(trick.id) &&
        !families.has(trick.family) &&
        (trick.family !== 'retention' || !match.retentionOwner) &&
        (trick.id !== 'blind_refund' || !match.blindRefundOwner));
      if (!candidates.length) break;
      const next = randomItem(candidates, random);
      match.owned.set(playerId, [...owned(room, playerId), next.id]);
      if (next.family === 'retention') match.retentionOwner = playerId;
      if (next.id === 'blind_refund') match.blindRefundOwner = playerId;
    }
  }
  if (trickId === 'self_suggestion') {
    const match = room.trickMatch;
    if (match.retentionOwner === playerId) match.retentionOwner = null;
    if (match.blindRefundOwner === playerId) match.blindRefundOwner = null;
    const choices = Object.values(TRICKS).filter((trick) => trick.rarity === 'legendary' &&
      !['quantity_wins', 'ascended'].includes(trick.id) &&
      (trick.family !== 'retention' || !match.retentionOwner && match.handNumber >= 8));
    const next = randomItem(choices, random);
    match.owned.set(playerId, [next.id]);
    if (next.family === 'retention') match.retentionOwner = playerId;
    grantSelectionBonus(room, playerId, next.id, random);
  }
  if (trickId === 'sharingan') syncSharingan(room, random);
}

function syncSharingan(room, random = Math.random) {
  const match = room.trickMatch;
  const phase = match.selection?.phase || Math.max(1, Math.ceil(match.handNumber / TRICK_PHASE_HANDS));
  for (const player of room.players.filter((p) => owned(room, p.id).includes('sharingan'))) {
    if (!match.sharinganCopied) match.sharinganCopied = new Map();
    const copied = match.sharinganCopied.get(player.id) || new Set();
    for (const opponent of room.players.filter((p) => p.id !== player.id && !p.kicked)) {
      if (copied.has(opponent.id)) continue;
      const choices = owned(room, opponent.id).filter((id) => id !== 'quantity_wins' &&
        id !== 'sharingan' && id !== 'ascended' && !owned(room, player.id).includes(id) &&
        !owned(room, player.id).some((ownId) => TRICKS[ownId].family === TRICKS[id].family) &&
        (TRICKS[id].family !== 'retention' || !match.retentionOwner || match.retentionOwner === player.id) &&
        (TRICKS[id].family !== 'clock' || !match.clockPhaseOwners.has(phase)));
      if (!choices.length) continue;
      const id = randomItem(choices, random);
      match.owned.set(player.id, [...owned(room, player.id), id]);
      copied.add(opponent.id);
      if (TRICKS[id].family === 'retention') match.retentionOwner = player.id;
      if (TRICKS[id].family === 'clock') match.clockPhaseOwners.set(phase, player.id);
    }
    match.sharinganCopied.set(player.id, copied);
  }
}

export function upgradeChoices(room, playerId) {
  return owned(room, playerId).flatMap((id) => {
    const current = TRICKS[id];
    const index = upgradeOrder.indexOf(current.rarity);
    if (index < 0 || index === upgradeOrder.length - 1) return [];
    const nextRarity = upgradeOrder[index + 1];
    const next = Object.values(TRICKS).find((trick) =>
      trick.family === current.family && trick.rarity === nextRarity);
    return next ? [{ from: id, to: next.id }] : [];
  });
}

function automaticUpgradeFor(trick, phase) {
  if (!trick || (phase !== 2 && phase !== 3) || trick.rarity !== 'common') return null;
  return Object.values(TRICKS).find((candidate) =>
    candidate.family === trick.family && candidate.rarity === 'rare') || null;
}

function availableUpgradeChoices(room, playerId, phase) {
  return upgradeChoices(room, playerId).filter(({ to }) =>
    offerStillAvailable(room, playerId, to, phase));
}

export function chooseTrick(room, playerId, trickId) {
  const match = room.trickMatch;
  const selection = match?.selection;
  const player = room.findPlayer(playerId);
  if (!selection || !selection.offers.has(playerId) || selection.chosen.has(playerId) ||
      !player || player.kicked || player.eliminated)
    throw new Error('当前不能选千术');
  const playerOwned = owned(room, playerId).slice();
  const offered = TRICKS[trickId];
  if (!offered) throw new Error('未知千术');
  const phase = selection.phase;
  const isOffered = selection.offers.get(playerId).includes(trickId);
  if (!isOffered) throw new Error('千术不在候选中');
  const commonOffer = (phase === 2 || phase === 3) && offered.rarity === 'common';
  const existingChoices = commonOffer ? availableUpgradeChoices(room, playerId, phase) : [];
  const existingUpgrade = existingChoices[0] || null;
  const automaticUpgrade = commonOffer && !existingUpgrade ? automaticUpgradeFor(offered, phase) : null;
  const acquiredId = automaticUpgrade?.id || trickId;
  const next = TRICKS[acquiredId];
  if ((next.family === 'clock' || existingUpgrade && TRICKS[existingUpgrade.to].family === 'clock') &&
      match.clockPhaseOwners.get(phase) !== undefined &&
      match.clockPhaseOwners.get(phase) !== playerId) throw new Error('本阶段读秒已被其他玩家选走');
  if (next.family === 'retention' && match.retentionOwner && match.retentionOwner !== playerId)
      throw new Error('留底已被其他玩家选走');
  if (next.id === 'blind_refund' && match.blindRefundOwner && match.blindRefundOwner !== playerId)
      throw new Error('盲注回声已被其他玩家选走');
  if (existingUpgrade)
    playerOwned.splice(playerOwned.indexOf(existingUpgrade.from), 1, existingUpgrade.to);
  playerOwned.push(acquiredId);
  if (next.family === 'retention') match.retentionOwner = playerId;
  if (next.id === 'blind_refund') match.blindRefundOwner = playerId;
  match.owned.set(playerId, playerOwned);
  match.picks.set(playerId, (match.picks.get(playerId) || 0) + 1);
  if (next.family === 'clock' || existingUpgrade && TRICKS[existingUpgrade.to].family === 'clock')
    match.clockPhaseOwners.set(phase, playerId);
  grantSelectionBonus(room, playerId, acquiredId);
  if (phaseThreeRareBonus(offered, phase)) // the card offered, not a common upgraded to rare
    grantBonusTricks(room, playerId, acquiredId, ['common'], 1, Math.random);
  syncSharingan(room);
  selection.chosen.add(playerId);
  return selection.chosen.size === selection.offers.size;
}

// Picked in phase 3, a rare trick also brings one random common trick (shown on the offer).
function phaseThreeRareBonus(trick, phase) {
  return phase === 3 && trick.rarity === 'rare';
}

function offerStillAvailable(room, playerId, id, phase) {
  const trick = TRICKS[id];
  return rarityAllowedInPhase(trick, phase) &&
    (trick.family !== 'clock' || room.trickMatch.clockPhaseOwners.get(phase) === undefined ||
    room.trickMatch.clockPhaseOwners.get(phase) === playerId) &&
    (trick.family !== 'retention' || !room.trickMatch.retentionOwner ||
      room.trickMatch.retentionOwner === playerId) &&
    (trick.id !== 'blind_refund' || !room.trickMatch.blindRefundOwner ||
      room.trickMatch.blindRefundOwner === playerId);
}

export function autoChooseTricks(room, random = Math.random) {
  const selection = room.trickMatch?.selection;
  if (!selection) return;
  for (const [playerId, offer] of selection.offers) {
    if (selection.chosen.has(playerId)) continue;
    const player = room.findPlayer(playerId);
    if (!player || player.kicked || player.eliminated) {
      selection.chosen.add(playerId);
      continue;
    }
    const availableOffers = offer.filter((id) => offerStillAvailable(room, playerId, id, selection.phase));
    if (availableOffers.length) {
      const priority = { common: 0, rare: 1, epic: 2, legendary: 3 };
      const highest = Math.max(...availableOffers.map((id) => priority[TRICKS[id].rarity]));
      chooseTrick(room, playerId, randomItem(availableOffers.filter((id) =>
        priority[TRICKS[id].rarity] === highest), random));
    }
    else {
      selection.chosen.add(playerId);
      room.trickMatch.picks.set(playerId, (room.trickMatch.picks.get(playerId) || 0) + 1);
    }
  }
  room.trickMatch.selection = null;
}

export function trickView(room, playerId) {
  const match = room.trickMatch;
  if (!match) return null;
  const selection = match.selection;
  const h = room.hand;
  const actor = h && room.findPlayer(playerId);
  const pot = h ? room.players.reduce((sum, p) => sum + p.betThisHand, 0) - (h.trickPotDrain || 0) : 0;
  const buyoutPrice = Math.floor(pot / 40) * 10;
  const forcedFoldTargets = hasTrick(room, playerId, 'forced_fold') && h?.stage === 'RIVER' &&
    h.actingOrder[h.turnIndex] === playerId && actor && !actor.folded && !actor.allIn &&
    h.needsToAct.has(playerId) && actor.chips >= buyoutPrice && buyoutPrice > 0
    ? h.actingOrder.slice(h.turnIndex + 1).filter((id) => {
        const target = room.findPlayer(id);
        return target && !target.folded && !target.allIn && h.needsToAct.has(id) &&
          !h.trickForcedFolds?.has(id);
      })
    : [];
  const forcedFold = h?.stage !== 'SHOWDOWN' ? h?.trickForcedFolds?.get(playerId) : null;
  const selectionUpgrades = selection ? availableUpgradeChoices(room, playerId, selection.phase) : [];
  return {
    handNumber: match.replayOf ?? match.handNumber,
    ended: !!match.ended,
    finalLoadouts: match.ended ? room.players.filter((p) => !p.kicked).map((p) => ({
      playerId: p.id, name: p.name, chips: p.chips,
      tricks: owned(room, p.id).map((id) => TRICKS[id]),
    })) : null,
    phase: selection?.phase || Math.max(1, Math.ceil(match.handNumber / TRICK_PHASE_HANDS)),
    selection: selection ? {
      phase: selection.phase,
      catchup: match.handNumber % TRICK_PHASE_HANDS !== 0 ||
        (match.picks.get(playerId) || 0) < selection.phase - 1,
      deadline: selection.deadline,
      chosenCount: selection.chosen.size,
      totalCount: selection.offers.size,
      chosen: selection.chosen.has(playerId),
      refreshCounts: Object.fromEntries(selection.refreshed?.get(playerId) || []),
      refreshLimit: hasTrick(room, playerId, 'extra_refresh') ? 3 : 2,
      offers: (selection.offers.get(playerId) || []).map((id, slotIndex) => ({ id, slotIndex }))
        .filter(({ id }) => offerStillAvailable(room, playerId, id, selection.phase))
        .map(({ id, slotIndex }) => ({
          ...TRICKS[id], slotIndex,
          autoUpgradeTo: selectionUpgrades.length ? null :
            automaticUpgradeFor(TRICKS[id], selection.phase)?.name || null,
          bonusCommon: phaseThreeRareBonus(TRICKS[id], selection.phase),
        })),
    } : null,
    owned: [...owned(room, playerId), ...(h?.trickBorrowed?.get(playerId) ? [h.trickBorrowed.get(playerId)] : [])].map((id) => {
      const trick = TRICKS[id];
      let available = (trick.kind !== 'passive' || id === 'strategy_card') && !!h && h.stage !== 'SHOWDOWN' &&
        !h.trickDisabled?.has(playerId);
      if (available) {
        try {
          if (!(id === 'retention_legendary' && h.stage === 'RIVER'))
            checkUseLimit(room, playerId, id);
        } catch { available = false; }
      }
      if (available && (trick.kind === 'change' && id !== 'immovable' || id === 'strategy_card')) {
        const player = room.findPlayer(playerId);
        available = h.actingOrder[h.turnIndex] === playerId && !player.folded &&
          !player.allIn && h.needsToAct.has(playerId);
      }
      if (id === 'immovable')
        available = available && ['PREFLOP', 'FLOP'].includes(h.stage) &&
          !room.findPlayer(playerId).folded && !(h.trickBoardLocks?.[3] && h.trickBoardLocks?.[4]);
      if (id === 'control_flop' && (h?.stage !== 'PREFLOP' || h.trickNextBoard)) available = false;
      if (available && ['drain_small', 'drain_big', 'drain_quarter'].includes(trick.id))
        available = potDrainAmount(room, trick.id) > 0;
      if (id === 'fate_swap' && h?.stage !== 'FLOP') available = false;
      if (['swap_five', 'retention_common', 'retention_rare', 'retention_epic'].includes(id) &&
          h?.stage !== 'PREFLOP') available = false;
      if (id === 'retention_legendary')
        available = available && (h?.stage === 'PREFLOP' && !h.trickRetention?.get(playerId)?.chosen ||
          h?.stage === 'RIVER' && !!h.trickRetention?.get(playerId)?.chosen &&
          !h.trickRetention?.get(playerId)?.riverUsed);
      if (id === 'control_five' && (h?.stage !== 'FLOP' ||
          h.trickNextBoard && !(h.trickReverseBoard && !h.trickControlUsed))) available = false;
      if (['hand_scent', 'strength_count', 'steal_future_board'].includes(id) &&
          h?.stage !== 'FLOP') available = false;
      if (['table_leader', 'river_report', 'catch_cheat'].includes(id) &&
          h?.stage !== 'RIVER') available = false;
      if (id === 'reverse_board' && h?.stage !== 'PREFLOP') available = false;
      if (id === 'guess_holes' && !['PREFLOP', 'FLOP', 'TURN'].includes(h?.stage)) available = false;
      if (id === 'ban_pairs' && !(h?.community.length >= 3 && h?.deck.length)) available = false;
      if (id === 'blindfold' && h?.stage !== 'PREFLOP') available = false;
      if (id === 'bluff_no_board' && !['PREFLOP', 'FLOP'].includes(h?.stage)) available = false;
      if (id === 'mental_block' && (h?.community.length || 0) < 3) available = false;
      if (['blind_next', 'blind_self_next'].includes(id) &&
          match.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES) available = false;
      if (id === 'discard_all' && !h?.actingOrder.some((targetId) =>
        targetId !== playerId && h.publicReveals.has(targetId))) available = false;
      if (id === 'color_bet' && h?.trickColorBetFailed?.has(playerId)) available = false;
      if (id === 'color_bet' && h?.trickColorBets?.has(playerId)) available = false;
      if (id === 'permanent_card' && (!h?.deck.some((card) => card[0] === 'A') ||
          !h?.deck.some((card) => card[0] === 'K'))) available = false;
      if (id === 'board_audit' && (h?.stage !== 'RIVER' ||
          ![...(h?.trickBoardSwappers || [])].some((targetId) => {
            const target = room.findPlayer(targetId);
            return targetId !== playerId && target && !target.folded && !target.allIn;
          }))) available = false;
      if (id === 'strategy_card' && (!h?.trickStrategyCards?.has(playerId) ||
          !['PREFLOP', 'TURN'].includes(h?.stage))) available = false;
      if (['ace_card', 'king_card', 'queen_card'].includes(id) &&
          !h?.deck.some((card) => card[0] === { ace_card: 'A', king_card: 'K', queen_card: 'Q' }[id]))
        available = false;
      if (h?.trickBlindHoles?.has(playerId) &&
          ['swap_five', 'retention_common', 'retention_rare', 'retention_epic',
            'retention_legendary', 'future_self', 'rank_count'].includes(id)) available = false;
      if (h?.trickHideRiver?.has(playerId) && h.stage === 'TURN' &&
          ['peek_next', 'next_color', 'next_high', 'next_suit', 'future_self'].includes(id))
        available = false;
      if (nextBoardHidden(h, playerId) &&
          ['peek_next', 'next_color', 'next_high', 'next_suit', 'future_self'].includes(id))
        available = false;
      if (id === 'forced_fold' && (h?.stage !== 'RIVER' || forcedFoldTargets.length === 0)) available = false;
      if (['reverse_board', 'color_bet'].includes(id) && h?.stage === 'RIVER') available = false;
      if (['next_color', 'next_high', 'next_suit', 'peek_next', 'future_self'].includes(id) &&
          h?.stage === 'RIVER') available = false;
      if (id === 'intuition' && (h?.community.length || 0) < 3) available = false;
      if (['future_self', 'hand_scent', 'table_leader', 'strength_count'].includes(id) &&
          (h?.community.length || 0) < 3) available = false;
      return { ...trick, available, borrowed: !hasTrick(room, playerId, id),
        remainingUsage: remainingUsage(room, playerId, trick),
        uses: useRecord(room, playerId, id).uses.length };
    }),
    pendingChoice: h?.trickChoices?.get(playerId) || null,
    forcedFoldTargets,
    forcedFold: forcedFold || h?.trickForcedGuessFolds?.has(playerId)
      ? { type: forcedFold ? 'buyout' : 'guess',
        byName: forcedFold ? room.findPlayer(forcedFold)?.name || '对手' : '管中窥豹' } : null,
    publicAnnouncements: h?.trickPublicAnnouncements || [],
    messages: h?.trickMessages?.get(playerId) || [],
    views: h?.trickBlindHoles?.has(playerId) && h.stage !== 'SHOWDOWN'
      ? (h?.trickViews?.get(playerId) || []).filter((view) => !view.label.startsWith('留底'))
      : h?.trickViews?.get(playerId) || [],
  };
}

export function addTrickMessage(room, playerId, text) {
  const h = room.hand;
  if (!h) return;
  const messages = h.trickMessages.get(playerId) || [];
  h.trickMessages.set(playerId, [...messages, text]);
}

function addView(room, playerId, label, cards) {
  const h = room.hand;
  const views = h.trickViews.get(playerId) || [];
  h.trickViews.set(playerId, [...views, { label, cards }]);
}

function showHoleCardsOnTable(room, viewerId, targetId, indexes) {
  const h = room.hand;
  if (!h.trickPeekIndexes.has(viewerId)) h.trickPeekIndexes.set(viewerId, new Map());
  const byTarget = h.trickPeekIndexes.get(viewerId);
  const visible = byTarget.get(targetId) || new Set();
  for (const index of indexes) visible.add(index);
  byTarget.set(targetId, visible);
}

function addHoleCardIntel(room, viewerId, targetId, index, observedCard, actualCard, fields) {
  const h = room.hand;
  if (!h.trickCardIntel.has(viewerId)) h.trickCardIntel.set(viewerId, new Map());
  const targets = h.trickCardIntel.get(viewerId);
  if (!targets.has(targetId)) targets.set(targetId, new Map());
  const cards = targets.get(targetId);
  const old = cards.get(index);
  const retained = old?.cardAtReveal === actualCard ? old : {};
  const intel = { ...retained, cardAtReveal: actualCard };
  if (fields.includes('rank')) intel.rank = observedCard[0];
  if (fields.includes('suit'))
    intel.suit = { h: '红桃', d: '方块', c: '梅花', s: '黑桃' }[observedCard[1]];
  if (fields.includes('color')) intel.color = cardColor(observedCard);
  cards.set(index, intel);
}

export function trickCardIntel(room, viewerId, targetId) {
  const target = room.findPlayer(targetId);
  const cards = room.hand?.trickCardIntel?.get(viewerId)?.get(targetId);
  if (!target?.holeCards || !cards) return null;
  return [0, 1].map((index) => {
    const intel = cards.get(index);
    if (!intel || intel.cardAtReveal !== target.holeCards[index]) return null;
    const { cardAtReveal, ...visibleIntel } = intel;
    return visibleIntel;
  });
}

function blockedFromSeeing(room, targetId) {
  return hasTrick(room, targetId, 'guard_rare') || hasTrick(room, targetId, 'guard_epic');
}

export function observedHoleCards(room, viewerId, targetId) {
  const target = room.findPlayer(targetId);
  if (viewerId === targetId || !hasTrick(room, targetId, 'fake_intel'))
    return target.holeCards;
  const h = room.hand;
  if (!h.trickFakeCards) h.trickFakeCards = new Map();
  if (!h.trickFakeCards.has(targetId)) {
    h.trickFakeCards.set(targetId, target.holeCards.map((card) => {
      const suits = cardColor(card) === '红' ? ['s', 'c'] : ['h', 'd'];
      return `${randomItem('23456789'.split(''))}${randomItem(suits)}`;
    }));
  }
  return h.trickFakeCards.get(targetId);
}

function observedLoadout(room, viewerId, targetId) {
  if (!hasTrick(room, targetId, 'fake_intel') || viewerId === targetId)
    return owned(room, targetId);
  return ['blind_box'];
}

function holeCardsLocked(target, actorId) {
  return target.id !== actorId && target.allIn;
}

// 不动如山 keeps its holder's hole cards out of every other player's swap for as long as it is held.
function holeCardsImmovable(room, target, actorId) {
  return target.id !== actorId && hasTrick(room, target.id, 'immovable');
}

function resistSwap(room, actorId, targets) {
  if (targets.some((target) => holeCardsLocked(target, actorId)))
    throw new Error('已全下玩家的底牌不能再被替换');
  if (targets.some((target) => holeCardsImmovable(room, target, actorId)))
    throw new Error('不动如山：目标的底牌不能被替换');
  const phase = Math.ceil(room.trickMatch.handNumber / TRICK_PHASE_HANDS);
  const defender = targets.find((target) => target.id !== actorId &&
    hasTrick(room, target.id, 'trick_resistance') &&
    room.trickMatch.resistanceUsedPhases.get(target.id) !== phase);
  if (!defender) return false;
  room.trickMatch.resistanceUsedPhases.set(defender.id, phase);
  addTrickMessage(room, actorId, `${defender.name} 的千术抵抗抵消了本次换牌；次数照常消耗`);
  addTrickMessage(room, defender.id, `千术抵抗：已抵消 ${room.findPlayer(actorId).name} 的换牌千术`);
  return true;
}

// The rest of the board as it would be dealt now: queued cards first, then the deck, a burn before
// each street, and a locked turn or river at its own slot. dealNextStreet deals exactly this.
export function plannedBoard(h) {
  const deck = h.deck.slice();
  const queue = Array.isArray(h.trickNextBoard) ? h.trickNextBoard.slice() : h.trickNextBoard ? [h.trickNextBoard] : [];
  const locks = h.trickBoardLocks || {};
  const next = () => (queue.length ? queue.shift() : deck.pop());
  const board = h.community.slice();
  while (board.length < 5) {
    deck.pop();
    for (const slot of board.length === 0 ? [0, 1, 2] : [board.length]) board.push(locks[slot] ?? next());
  }
  return board;
}

function boardLocked(h, slots = [3, 4]) {
  return slots.some((slot) => h.trickBoardLocks?.[slot]);
}

// Cards not yet dealt: the deck, the queued board and a locked turn or river.
function undealtCards(h) {
  const queue = Array.isArray(h.trickNextBoard) ? h.trickNextBoard : h.trickNextBoard ? [h.trickNextBoard] : [];
  return [...h.deck, ...queue, ...Object.values(h.trickBoardLocks || {})];
}

function alertTarget(room, actor, target, trickId = null) {
  if (trickId && hasTrick(room, target.id, 'counterfeit_alert') &&
      !hasTrick(room, actor.id, 'quiet_move'))
    addTrickMessage(room, target.id,
      `第六感：${actor.name} 对你使用了 ${TRICKS[trickId].name}`);
}

function reflectTrick(room, targetId, trickId) {
  if (!hasTrick(room, targetId, 'trick_reflect')) return;
  const h = room.hand;
  if (h.trickBorrowed.has(targetId)) return;
  if (useRecord(room, targetId, 'trick_reflect').uses.length >= 2) return;
  h.trickBorrowed.set(targetId, trickId);
  h.trickBorrowedVia.set(targetId, 'trick_reflect');
  addTrickMessage(room, targetId,
    `千术反转：本局暂时获得 ${TRICKS[trickId].name}，使用后才计次数`);
}

export function onTrickFold(room, folderId) {
  if (!room.trickMatch || !room.hand) return;
  const h = room.hand;
  const folder = room.findPlayer(folderId);
  for (const viewer of room.players) {
    if (viewer.id === folderId || !h.actingOrder.includes(viewer.id) || blockedFromSeeing(room, folderId)) continue;
    if (hasTrick(room, viewer.id, 'discard_all') ||
        hasTrick(room, viewer.id, 'discard_both'))
      addView(room, viewer.id, `${folder.name} 的弃牌`, observedHoleCards(room, viewer.id, folderId).slice());
    if (hasTrick(room, viewer.id, 'discard_one') && h.foldOrder[0] === folderId)
      addView(room, viewer.id, `首位弃牌者 ${folder.name}`, observedHoleCards(room, viewer.id, folderId).slice());
    if (hasTrick(room, viewer.id, 'discard_all')) h.publicReveals.add(folderId);
    if (hasTrick(room, viewer.id, 'discard_all') ||
        (hasTrick(room, viewer.id, 'discard_one') && h.foldOrder[0] === folderId))
      alertTarget(room, viewer, folder);
  }
}

export function onTrickHandStart(room) {
  const match = room.trickMatch;
  if (!match) return;
  delete match.replayOf;
  match.handNumber++;
  syncSharingan(room);
  const h = room.hand;
  h.trickBlindHoles = new Set();
  h.trickBlindSelfRewards = new Set();
  h.trickHideRiver = new Set();
  h.trickNoBoard = new Set();
  h.trickForcedGuessFolds = new Set();
  h.trickBoardLocks = {};
  h.trickBorrowedVia = new Map();
  for (const effect of match.pendingBlindEffects) {
    if (effect.handNumber === match.handNumber && h.actingOrder.includes(effect.targetId)) {
      h.trickBlindHoles.add(effect.targetId);
      if (effect.rewardSelf) h.trickBlindSelfRewards.add(effect.targetId);
    }
  }
  match.pendingBlindEffects = match.pendingBlindEffects.filter((effect) =>
    effect.handNumber > match.handNumber);
  h.trickViews = new Map();
  h.trickMessages = new Map();
  h.trickUsedThisHand = new Set();
  h.trickChoices = new Map();
  h.trickBorrowed = new Map();
  h.trickColorBets = new Map();
  h.trickColorBetFailed = new Set();
  h.trickBoardSwappers = new Set();
  h.trickStrategyCards = new Map();
  h.trickYinMasks = new Map();
  h.trickPublicAnnouncements = [];
  h.trickBlindRefundCount = new Map();
  h.trickActiveUsers = new Set();
  h.trickDisabled = new Set();
  h.trickBlindfolded = new Set();
  h.trickPeeks = new Map();
  h.trickPeekIndexes = new Map();
  h.trickCardIntel = new Map();
  h.trickRetention = new Map();
  for (const player of room.players) {
    if (!h.actingOrder.includes(player.id) || !hasTrick(room, player.id, 'strategy_card') ||
        !h.deck.length) continue;
    const card = randomItem(h.deck);
    takeDeckCard(h, card);
    h.trickStrategyCards.set(player.id, card);
  }
  for (const player of room.players) {
    if (!h.actingOrder.includes(player.id)) continue;
    if (hasTrick(room, player.id, 'ascended'))
      h.trickPublicAnnouncements.push(`${player.name} 已经登神了`);
    if (hasTrick(room, player.id, 'fake_public')) {
      const actual = player.holeCards.map((card) => rankValue(card));
      const fake = randomItem(Array.from({ length: 10 }, (_, index) => index + 1)
        .filter((rank) => !actual.includes(rank)));
      h.trickPublicAnnouncements.push(`公开情报：${player.name} 的一张底牌点数为 ${fake}`);
    }
    if (h.trickStrategyCards.has(player.id))
      addView(room, player.id, '运筹帷幄：本局候选牌', [h.trickStrategyCards.get(player.id)]);
    const yin = hasTrick(room, player.id, 'yin_yang') ? 'yin_yang' :
      match.pendingYinEffects.some((effect) => effect.playerId === player.id && effect.handNumber === match.handNumber)
        ? match.pendingYinEffects.find((effect) => effect.playerId === player.id && effect.handNumber === match.handNumber).trickId : null;
    if (yin) {
      h.trickYinMasks.set(player.id, yin === 'yin_yang' ? [2] :
        yin === 'yin_ghost' ? [0, 1, 2] : [3, 4]);
      const cards = plannedBoard(h);
      const intel = yin === 'yin_yang' ? [cards[4]] :
        yin === 'yin_ghost' ? cards.slice(3, 5) : cards.slice(0, 3);
      addView(room, player.id, `${TRICKS[yin].name}：预知公牌（后续千术可能改动）`, intel.filter(Boolean));
    }
    const retentionCount = retentionDrawCount(room, player.id);
    if (retentionCount > 2) {
      const cards = [...player.holeCards, ...(h.trickRetentionCards?.get(player.id) || [])];
      h.trickRetention.set(player.id, { cards, chosen: false, riverUsed: false });
      const selectableCount = hasTrick(room, player.id, 'retention_epic') ? 4 :
        hasTrick(room, player.id, 'retention_legendary') ? 5 : 3;
      addView(room, player.id, '留底：翻前可选底牌', cards.slice(0, selectableCount));
      addView(room, player.id, hasTrick(room, player.id, 'retention_legendary')
        ? '留底：后五张情报牌（河牌可换底牌）' : '留底：其余情报牌（本局不再使用）',
      cards.slice(selectableCount));
    }
    const others = room.players.filter((p) => p.id !== player.id &&
      h.actingOrder.includes(p.id) && !blockedFromSeeing(room, p.id));
    if (hasTrick(room, player.id, 'pocket_count') || hasTrick(room, player.id, 'pocket_names')) {
      const pairs = others.filter((p) => {
        const cards = observedHoleCards(room, player.id, p.id);
        return cards[0][0] === cards[1][0];
      });
      addTrickMessage(room, player.id, hasTrick(room, player.id, 'pocket_names')
        ? `口袋对子：${pairs.length ? pairs.map((p) =>
          `${p.name}（${rankValue(observedHoleCards(room, player.id, p.id)[0]) <= 8 ? '≤8' : '>8'}）`).join('、') : '无人'}`
        : `口袋对子人数：${pairs.length}`);
      for (const p of pairs) alertTarget(room, player, p);
    }
    if (others.length && (hasTrick(room, player.id, 'mark_one') || hasTrick(room, player.id, 'mark_both'))) {
      const targets = hasTrick(room, player.id, 'mark_both') ? others : [randomItem(others)];
      for (const target of targets) {
        addTrickMessage(room, player.id,
          `${target.name} 的起始底牌红黑：${observedHoleCards(room, player.id, target.id).map(cardColor).join('、')}`);
        alertTarget(room, player, target);
      }
    }
    if (hasTrick(room, player.id, 'red_balance'))
      addTrickMessage(room, player.id, `红潮：对手底牌共有 ${others.flatMap((p) => observedHoleCards(room, player.id, p.id)).filter((card) => cardColor(card) === '红').length} 张红牌`);
    if (hasTrick(room, player.id, 'black_tide'))
      addTrickMessage(room, player.id, `黑潮：对手底牌共有 ${others.flatMap((p) => observedHoleCards(room, player.id, p.id)).filter((card) => cardColor(card) === '黑').length} 张黑牌`);
    if (hasTrick(room, player.id, 'ace_alarm'))
      addTrickMessage(room, player.id, `牌兆·王牌气息：${others.some((p) => observedHoleCards(room, player.id, p.id).some((card) => card[0] === 'A')) ? '有' : '没有'}对手握有 A`);
    if (hasTrick(room, player.id, 'face_tally'))
      addTrickMessage(room, player.id, `牌兆·花牌点名：${others.filter((p) => observedHoleCards(room, player.id, p.id).some((card) => 'JQK'.includes(card[0]))).length} 位对手握有 J、Q 或 K`);
    if (hasTrick(room, player.id, 'reveal_all_loadouts'))
      for (const target of room.players.filter((p) => p.id !== player.id))
        addTrickMessage(room, player.id,
          `${target.name} 的千术：${observedLoadout(room, player.id, target.id).map((id) => TRICKS[id].name).join('、') || '暂无'}`);
  }
  delete h.trickRetentionCards;
  match.pendingYinEffects = match.pendingYinEffects.filter((effect) => effect.handNumber > match.handNumber);
}

function cardColor(card) {
  return card[1] === 'h' || card[1] === 'd' ? '红' : '黑';
}

function nextBoardCard(h) {
  return h.stage === 'RIVER' ? null : plannedBoard(h)[h.community.length] || null;
}

function nextBoardHidden(h, playerId) {
  if (!h) return false;
  const nextIndex = h.stage === 'PREFLOP' ? 0 : h.stage === 'FLOP' ? 3 : 4;
  return h.trickYinMasks?.get(playerId)?.includes(nextIndex);
}

export function onTrickNextBoard(room, card) {
  if (!room.trickMatch) return;
  const h = room.hand;
  if (h.stage === 'FLOP') {
    for (const p of room.players.filter((player) => hasTrick(room, player.id, 'blind_refund'))) {
      const count = h.trickBlindRefundCount?.get(p.id) || 0;
      const amount = Math.min(count * room.bigBlind, availablePot(room));
      if (amount > 0) {
        h.trickPotDrain += amount;
        p.chips += amount;
        addTrickMessage(room, p.id, `盲注回声：收回 ${amount} 筹码`);
      }
    }
  }
  if (h.stage === 'FLOP') {
    const [, , , next, river] = plannedBoard(h);
    for (const p of room.players.filter((player) => hasTrick(room, player.id, 'next_color')))
      addTrickMessage(room, p.id, `听色：转牌 ${next && !h.trickYinMasks?.get(p.id)?.includes(3) ? cardColor(next) : '不可见'}，河牌 ${river && !h.trickYinMasks?.get(p.id)?.includes(4) ? cardColor(river) : '不可见'}`);
  }
}

export function onTrickPreflopEnd(room) {
  if (!room.trickMatch) return;
  for (const p of room.players.filter((player) => hasTrick(room, player.id, 'blind_refund'))) {
    const count = room.hand.actingOrder.filter((id) =>
      room.findPlayer(id).betThisHand === room.bigBlind).length;
    room.hand.trickBlindRefundCount.set(p.id, count);
  }
}

export function onTrickHandEnd(room) {
  if (!room.trickMatch) return;
  const h = room.hand;
  for (const p of room.players.filter((player) =>
    h.actingOrder.includes(player.id) && activeThisHand(room, player.id, 'drain_small'))) {
    const minimum = 5 * room.smallBlind;
    if (availablePot(room) < minimum) continue;
    const amount = Math.min(availablePot(room), (1 + Math.floor(Math.random() * 5)) * room.smallBlind);
    h.trickPotDrain += amount;
    p.chips += amount;
    addTrickMessage(room, p.id, `抽筹·探囊：从底池抽走 ${amount} 筹码`);
  }
}

function transferChips(room, fromId, toId, requested, label) {
  const from = room.findPlayer(fromId);
  const to = room.findPlayer(toId);
  if (!from || !to || from.id === to.id) return 0;
  const amount = Math.min(from.chips, Math.max(0, Math.floor(requested / 10) * 10));
  if (amount > 0) {
    from.chips -= amount;
    to.chips += amount;
    addTrickMessage(room, toId, `${label}：从 ${from.name} 获得 ${amount} 筹码`);
    addTrickMessage(room, fromId, `${label}：向 ${to.name} 支付 ${amount} 筹码`);
  }
  return amount;
}

// A hand everyone folded before the flop does not count: once it is settled the counter steps
// back, so phases, selections and the match end all treat it as not yet played. The table
// keeps showing its number (replayOf) until the replay deals.
export function voidTrickHand(room) {
  const match = room.trickMatch;
  if (!match) return;
  match.replayOf = match.handNumber;
  match.handNumber -= 1;
  for (const id of room.hand.actingOrder)
    addTrickMessage(room, id, `翻牌前其他人全部弃牌，本局不计入局数，下一局仍是第 ${match.replayOf} 局`);
}

export function onTrickSettlement(room) {
  if (!room.trickMatch) return;
  const h = room.hand;
  const winners = new Set(h.revealed.pots.flatMap((pot) => pot.winnerIds));
  const folders = h.actingOrder.filter((id) => room.findPlayer(id).folded);
  const potTotal = h.revealed.pots.reduce((sum, pot) => sum + pot.amount, 0);
  for (const [id, suit] of h.trickColorBets || []) {
    if (h.community[4]?.[1] === suit) {
      for (const opponentId of h.actingOrder.filter((otherId) => otherId !== id))
        transferChips(room, opponentId, id, room.bigBlind, '押色');
      addTrickMessage(room, id, '押色命中：已向本局其他玩家收取大盲');
    } else addTrickMessage(room, id, '押色未命中');
  }
  for (const id of h.actingOrder) {
    const player = room.findPlayer(id);
    if (activeThisHand(room, id, 'shoe_shine') && winners.has(id) && winners.size === 1 &&
        h.trickRiverPlayerIds?.length === 2 && h.trickRiverPlayerIds.includes(id)) {
      const loserId = h.trickRiverPlayerIds.find((otherId) => otherId !== id);
      transferChips(room, loserId, id, h.actingOrder.length * room.bigBlind, '给我擦皮鞋');
    }
    if (h.trickNoBoard?.has(id) && winners.has(id)) {
      for (const folderId of folders)
        transferChips(room, folderId, id, 10 * room.smallBlind, '摆份·不需要公牌');
    }
    if (h.trickBlindSelfRewards?.has(id) && !player.folded &&
        h.trickRiverPlayerIds?.includes(id) && h.community.length === 5 &&
        solve([...player.holeCards, ...h.community]).rank === 1) {
      const winnerId = h.revealed.pots.flatMap((pot) => pot.winnerIds).find((otherId) => otherId !== id);
      if (winnerId) transferChips(room, winnerId, id, potTotal, '摆份·无需看牌');
      for (const otherId of h.actingOrder.filter((otherId) => otherId !== id))
        transferChips(room, otherId, id, room.smallBlind, '摆份·无需看牌');
    }
    if (activeThisHand(room, id, 'card_fairy') && winners.has(id) && !player.folded &&
        h.community.length === 5 && solve([...player.holeCards, ...h.community]).rank >= 3) {
      const choices = eligibleTricks(room, id, new Set(), true).filter((trick) =>
        trick.rarity === 'common' && trick.id !== 'blind_refund' &&
        trick.family !== 'retention' && trick.family !== 'clock');
      if (choices.length) {
        const next = randomItem(choices);
        room.trickMatch.owned.set(id, [...owned(room, id), next.id]);
        grantSelectionBonus(room, id, next.id);
        addTrickMessage(room, id, `牌仙子：获得 ${next.name}`);
      }
    }
  }
}

function useRecord(room, playerId, trickId) {
  const key = `${playerId}:${trickId}`;
  const uses = room.trickMatch.uses.get(key) || [];
  return { key, uses };
}

function checkUseLimit(room, playerId, trickId) {
  const h = room.hand;
  const { uses } = useRecord(room, playerId, trickId);
  const handNumber = room.trickMatch.handNumber;
  const phase = Math.ceil(handNumber / TRICK_PHASE_HANDS);
  if (oncePerHand.has(trickId) &&
    h.trickUsedThisHand.has(`${playerId}:${trickId}`))
    throw new Error('本局已经使用过');
  if (['peek_one', 'rank_count', 'blind_next'].includes(trickId) &&
      uses.length && handNumber - uses.at(-1) < 2)
    throw new Error('每两局只能使用一次');
  if (oncePerHandToo.has(trickId) && uses.includes(handNumber))
    throw new Error('本局已经使用过');
  if (perHandUseCaps[trickId] &&
      uses.filter((n) => n === handNumber).length >= perHandUseCaps[trickId])
    throw new Error('本局使用次数已达上限');
  if (perPhase.has(trickId) &&
      uses.filter((n) => Math.ceil(n / TRICK_PHASE_HANDS) === phase).length >= (perPhaseUseCaps[trickId] || 1))
    throw new Error('本阶段使用次数已达上限');
  const cap = wholeMatchUses[trickId];
  if (cap && uses.length >= cap) throw new Error('整场使用次数已用完');
}

function prepareCardChoice(room, player, trickId, count) {
  const h = room.hand;
  const existing = h.trickChoices.get(player.id);
  if (existing?.trickId === trickId) return existing;
  if (existing) throw new Error('请先完成当前选牌');
  if (trickId.startsWith('retention_')) {
    const retention = h.trickRetention.get(player.id);
    if (!retention) throw new Error('本局没有留底候选牌');
    if (trickId === 'retention_legendary' && h.stage === 'RIVER') {
      if (!retention.chosen || retention.riverUsed) throw new Error('当前不能使用留底河牌替换');
      const choice = { trickId, cards: [...player.holeCards, ...retention.cards.slice(5)],
        handCards: player.holeCards.slice(), river: true };
      h.trickChoices.set(player.id, choice);
      return choice;
    }
    if (retention.chosen) throw new Error('本局已经选过底牌');
    const max = trickId === 'retention_epic' ? 4 : trickId === 'retention_legendary' ? 5 : 3;
    const choice = { trickId, cards: retention.cards.slice(0, max),
      handCards: player.holeCards.slice() };
    h.trickChoices.set(player.id, choice);
    return choice;
  }
  if (h.deck.length < count) throw new Error('牌堆剩余牌不够');
  const pool = h.deck.slice();
  const sample = Array.from({ length: count }, () =>
    pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const choice = { trickId, cards: trickId === 'swap_five' ? [...player.holeCards, ...sample] : sample,
    handCards: player.holeCards.slice() };
  h.trickChoices.set(player.id, choice);
  return choice;
}

function takeDeckCard(h, card) {
  const index = h.deck.indexOf(card);
  if (index < 0) throw new Error('候选牌已失效，请重新选择');
  h.deck.splice(index, 1);
}

function rankValue(card) {
  return '23456789TJQKA'.indexOf(card[0]) + 2;
}

// 终极抵抗反转 undoes any opposing active trick that reaches its holder, so the table is copied before
// the trick runs and restored when it has to be cancelled (object identities are kept).
function canUltimateReflect(room, playerId) {
  if (!hasTrick(room, playerId, 'ultimate_reflect')) return false;
  const phase = Math.ceil(room.trickMatch.handNumber / TRICK_PHASE_HANDS);
  return useRecord(room, playerId, 'ultimate_reflect').uses
    .filter((n) => Math.ceil(n / TRICK_PHASE_HANDS) === phase).length < ULTIMATE_REFLECT_PER_PHASE;
}

function snapshotTable(room) {
  return { hand: structuredClone(room.hand), match: structuredClone(room.trickMatch),
    players: room.players.map((p) => structuredClone(p)) };
}

function restoreTable(room, snapshot) {
  const restore = (target, source) => {
    for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
    Object.assign(target, source);
  };
  restore(room.hand, snapshot.hand);
  restore(room.trickMatch, snapshot.match);
  room.players.forEach((p, index) => restore(p, snapshot.players[index]));
}

export function useTrick(room, playerId, trickId, options = {}) {
  const h = room.hand;
  const player = room.findPlayer(playerId);
  const borrowed = h?.trickBorrowed?.get(playerId) === trickId;
  if (!room.trickMatch || !h || h.stage === 'SHOWDOWN' ||
      !player || !h.actingOrder.includes(playerId) || (!hasTrick(room, playerId, trickId) && !borrowed))
    throw new Error('当前不能使用此千术');
  const trick = TRICKS[trickId];
  if (trick.kind === 'passive' && trickId !== 'strategy_card')
    throw new Error('被动千术无需手动使用');
  if (h.trickDisabled.has(playerId)) throw new Error('本局千术已被禁用');
  if (h.trickBlindHoles?.has(playerId) &&
      ['swap_five', 'retention_common', 'retention_rare', 'retention_epic',
        'retention_legendary', 'future_self', 'rank_count'].includes(trickId))
    throw new Error('本局自己的底牌被遮蔽，不能用千术查看');
  if (h.trickHideRiver?.has(playerId) && h.stage === 'TURN' &&
      ['peek_next', 'next_color', 'next_high', 'next_suit', 'future_self'].includes(trickId))
    throw new Error('摆份·不需要公牌：本局不能查看河牌');
  if (nextBoardHidden(h, playerId) &&
      ['peek_next', 'next_color', 'next_high', 'next_suit', 'future_self'].includes(trickId))
    throw new Error('阴间千术：下一张公牌本局不可见');
  if (trickId === 'immovable' && player.folded) throw new Error('已弃牌，不能再锁定公共牌');
  // 不动如山's lock may be set at any moment before the turn, not only on the player's own turn.
  if ((trick.kind === 'change' && trickId !== 'immovable' || trickId === 'strategy_card') &&
      (h.actingOrder[h.turnIndex] !== playerId ||
      player.folded || player.allIn || !h.needsToAct.has(playerId)))
    throw new Error('只能在自己的行动回合使用行动千术');
  if (['swap_five', 'retention_common', 'retention_rare', 'retention_epic'].includes(trickId) &&
      h.stage !== 'PREFLOP')
    throw new Error('只能在翻牌前选底牌');
  if (trickId === 'retention_legendary' &&
      !['PREFLOP', 'RIVER'].includes(h.stage)) throw new Error('当前不能使用留底');
  if (!(trickId === 'retention_legendary' && h.stage === 'RIVER'))
    checkUseLimit(room, playerId, trickId);
  const target = room.findPlayer(options.targetId);
  const needsTarget = ['peek_rank', 'peek_one', 'peek_both',
    'reveal_loadout', 'reveal_one', 'intuition', 'discard_both', 'exchange',
    'forced_fold', 'suit_or_run', 'high_probe', 'hand_scent', 'steal_skill',
    'steal_hole', 'catch_cheat', 'disable_tricks', 'blindfold', 'discard_all',
    'blind_next', 'mental_block', 'guess_holes'].includes(trickId);
  if (needsTarget && (!target || target.id === playerId || !h.actingOrder.includes(target.id)))
    throw new Error('请选择本局的一名对手');
  if (['peek_rank', 'peek_one', 'peek_both', 'intuition', 'discard_both',
    'suit_or_run', 'high_probe', 'hand_scent'].includes(trickId) &&
      blockedFromSeeing(room, target.id)) throw new Error('对方的底牌受到防窥保护');
  const affectedPlayerIds = new Set();
  const reflectors = room.players.filter((p) => p.id !== playerId && canUltimateReflect(room, p.id));
  const snapshot = reflectors.length ? snapshotTable(room) : null;

  if (trickId === 'swap_five' || trickId === 'control_five' || trickId === 'control_flop' || trickId.startsWith('retention_')) {
    if (trickId === 'control_flop' && (h.stage !== 'PREFLOP' || h.trickNextBoard))
      throw new Error('只能在翻牌前、公共牌尚未被其他千术指定时使用');
    if (trickId === 'control_five' && boardLocked(h))
      throw new Error('不动如山：转牌或河牌已被锁定，不能再指定');
    if (trickId === 'control_five' && (h.stage !== 'FLOP' ||
        h.trickNextBoard && !(h.trickReverseBoard && !h.trickControlUsed)))
      throw new Error('只能在翻牌阶段指定转牌和河牌');
    const choice = prepareCardChoice(room, player, trickId,
      trickId === 'swap_five' ? 3 : trickId === 'control_five' ? 10 : trickId === 'control_flop' ? 8 : 0);
    if (options.choiceIndexes === undefined && options.choiceIndex === undefined) return { prepared: true };
    if (choice.handCards.some((card, index) => card !== player.holeCards[index]) ||
        (!trickId.startsWith('retention_') &&
        choice.cards.some((card) => card !== player.holeCards[0] && card !== player.holeCards[1] && !h.deck.includes(card)))) {
      h.trickChoices.delete(playerId);
      throw new Error('牌局发生变化，请重新选择候选牌');
    }
    if (trickId === 'swap_five' || trickId.startsWith('retention_')) {
      const indexes = options.choiceIndexes;
      if (!Array.isArray(indexes) || indexes.length !== 2 || new Set(indexes).size !== 2 ||
          indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= choice.cards.length))
        throw new Error('请从五张牌中选两张');
      if (choice.river && !(indexes.some((index) => index < 2) &&
          indexes.some((index) => index >= 2)))
        throw new Error('请选择自己一张底牌和一张备用牌');
      const nextCards = choice.river
        ? player.holeCards.map((card, index) => index === indexes.find((item) => item < 2)
          ? choice.cards[indexes.find((item) => item >= 2)] : card)
        : indexes.map((index) => choice.cards[index]);
      for (const card of nextCards) if (h.deck.includes(card)) takeDeckCard(h, card);
      player.holeCards = nextCards;
      if (trickId.startsWith('retention_')) {
        const retention = h.trickRetention.get(playerId);
        if (choice.river) retention.riverUsed = true;
        else retention.chosen = true;
      }
      addTrickMessage(room, playerId, '换底完成，新底牌已生效');
    } else if (trickId === 'control_flop') {
      const indexes = options.choiceIndexes;
      if (!Array.isArray(indexes) || indexes.length !== 3 || new Set(indexes).size !== 3 ||
          indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= choice.cards.length))
        throw new Error('请按顺序选三张翻牌');
      for (const index of indexes) takeDeckCard(h, choice.cards[index]);
      h.trickNextBoard = indexes.map((index) => choice.cards[index]);
      h.trickBoardSwappers.add(playerId);
      addTrickMessage(room, playerId, '定江山：已指定三张翻牌');
    } else {
      const indexes = options.choiceIndexes;
      if (!Array.isArray(indexes) || indexes.length !== 2 || new Set(indexes).size !== 2 ||
          indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= choice.cards.length))
        throw new Error('请按转牌、河牌顺序选两张');
      for (const index of indexes) takeDeckCard(h, choice.cards[index]);
      h.trickNextBoard = indexes.map((index) => choice.cards[index]);
      h.trickControlUsed = true;
      h.trickBoardSwappers.add(playerId);
      addTrickMessage(room, playerId, '已指定转牌与河牌');
    }
    h.trickChoices.delete(playerId);
  } else if (trickId === 'permanent_card') {
    const ace = randomItem(h.deck.filter((card) => card[0] === 'A'));
    const king = randomItem(h.deck.filter((card) => card[0] === 'K'));
    if (!ace || !king) throw new Error('牌堆中缺少可用的 A 或 K');
    takeDeckCard(h, ace);
    takeDeckCard(h, king);
    player.holeCards = [ace, king];
    addTrickMessage(room, playerId, '云中探花手：两张底牌已变为随机花色的 A 和 K');
  } else if (trickId === 'strategy_card') {
    const card = h.trickStrategyCards.get(playerId);
    if (!card) throw new Error('本局候选牌已使用');
    if (h.stage === 'PREFLOP' && [0, 1].includes(options.cardIndex)) {
      player.holeCards[options.cardIndex] = card;
      addTrickMessage(room, playerId, '运筹帷幄：候选牌已换入底牌');
    } else if (h.stage === 'TURN' && options.river) {
      if (boardLocked(h, [4])) throw new Error('不动如山：河牌已被锁定，不能替换');
      h.trickNextBoard = [card];
      h.trickBoardSwappers.add(playerId);
      addTrickMessage(room, playerId, '运筹帷幄：已将候选牌指定为河牌');
    } else throw new Error('翻前请选择一张底牌，或在转牌阶段选择替换河牌');
    h.trickStrategyCards.delete(playerId);
  } else if (trickId === 'discard_all') {
    if (!target.folded || blockedFromSeeing(room, target.id) ||
        !h.publicReveals.has(target.id)) throw new Error('只能选择已公开的弃牌');
    if (![0, 1].includes(options.myCardIndex) || ![0, 1].includes(options.cardIndex))
      throw new Error('请各选择一张牌');
    if (!resistSwap(room, playerId, [target])) {
      [player.holeCards[options.myCardIndex], target.holeCards[options.cardIndex]] =
        [target.holeCards[options.cardIndex], player.holeCards[options.myCardIndex]];
      addTrickMessage(room, playerId, '废牌·尽收：已从弃牌中换入一张底牌');
    }
  } else if (trickId === 'random_replace') {
    const candidates = h.actingOrder.map((id) => room.findPlayer(id))
      .filter((p) => (p.id === playerId || !hasTrick(room, p.id, 'guard_epic')) &&
        !holeCardsLocked(p, playerId) && !holeCardsImmovable(room, p, playerId));
    if (!candidates.length || !h.deck.length) throw new Error('没有可换牌的目标');
    const victim = randomItem(candidates);
    if (!resistSwap(room, playerId, [victim])) {
      victim.holeCards[Math.floor(Math.random() * 2)] = h.deck.pop();
      affectedPlayerIds.add(victim.id);
      addTrickMessage(room, playerId, `无冤无仇：${victim.name} 的一张底牌已随机更换`);
    }
  } else if (trickId === 'blindfold') {
    if (h.stage !== 'PREFLOP') throw new Error('只能在翻牌前使用');
    h.trickBlindfolded.add(target.id);
    addTrickMessage(room, target.id, '你中了特异功能·掩目，河牌前无法看到前三张公牌');
  } else if (trickId === 'bluff_no_board') {
    if (!['PREFLOP', 'FLOP'].includes(h.stage)) throw new Error('只能在转牌前使用');
    h.trickHideRiver.add(playerId);
    h.trickNoBoard.add(playerId);
    addTrickMessage(room, playerId, '摆份·不需要公牌：本局河牌将对你隐藏，赢牌时收取弃牌者筹码');
  } else if (trickId === 'blind_next') {
    if (room.trickMatch.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES)
      throw new Error('本场已没有下一局');
    for (const id of [playerId, target.id]) room.trickMatch.pendingBlindEffects.push({
      targetId: id, handNumber: room.trickMatch.handNumber + 1,
    });
    addTrickMessage(room, playerId, `摆份·跟你盲开：下局你和 ${target.name} 都看不到自己的底牌`);
    addTrickMessage(room, target.id, `你中了摆份·跟你盲开：下局看不到自己的底牌`);
  } else if (trickId === 'blind_self_next') {
    if (room.trickMatch.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES)
      throw new Error('本场已没有下一局');
    room.trickMatch.pendingBlindEffects.push({ targetId: playerId,
      handNumber: room.trickMatch.handNumber + 1, rewardSelf: true });
    addTrickMessage(room, playerId, '摆份·无需看牌：下局看不到底牌，河牌高牌不弃牌可获额外奖励');
  } else if (trickId === 'mental_block') {
    if (h.community.length < 3 || target.folded) throw new Error('只能在翻牌后盖住仍在局玩家的底牌');
    h.trickBlindHoles.add(target.id);
    addTrickMessage(room, target.id, `你中了特异功能·意念闭塞：本局结束前看不到自己的底牌`);
  } else if (trickId === 'steal_future_board') {
    if (h.stage !== 'FLOP' || h.deck.length < 4) throw new Error('只能在翻牌阶段使用');
    if (boardLocked(h)) throw new Error('不动如山：转牌或河牌已被锁定，不能交换');
    let nextHole;
    if (Array.isArray(h.trickNextBoard) && h.trickNextBoard.length === 2) {
      nextHole = h.trickNextBoard.slice();
      h.trickNextBoard = player.holeCards.slice();
    } else {
      const turnIndex = h.deck.length - 2;
      const riverIndex = h.deck.length - 4;
      nextHole = [h.deck[turnIndex], h.deck[riverIndex]];
      [h.deck[turnIndex], h.deck[riverIndex]] = player.holeCards;
    }
    player.holeCards = nextHole;
    h.trickBoardSwappers.add(playerId);
    addTrickMessage(room, playerId, '探囊取物：两张底牌与未公开的转牌、河牌交换完成');
  } else if (trickId === 'catch_cheat') {
    if (h.stage !== 'RIVER') throw new Error('只能在河牌阶段使用');
    const amount = 20 * room.bigBlind;
    if (target.chips < amount) throw new Error('目标筹码不足二十个大盲');
    if (!h.trickActiveUsers.has(target.id)) {
      addTrickMessage(room, playerId, `捉千：${target.name} 本局没有使用主动千术，本次落空（次数照常消耗）`);
    } else {
      target.chips -= amount;
      player.chips += amount;
      if (target.chips === 0 && !target.folded) {
        target.allIn = true;
        h.allInLocked = true;
        h.needsToAct.delete(target.id);
      }
      addTrickMessage(room, playerId, `捉千：从 ${target.name} 收取 ${amount} 筹码`);
    }
  } else if (trickId === 'neighbor_swap') {
    // The neighbors are the nearest players on either side still in the hand; folded seats are passed over.
    const seats = h.actingOrder.map((id) => room.findPlayer(id)).filter((p) => !p.folded).sort((a, b) => a.seat - b.seat);
    if (seats.length < 3) throw new Error('至少需要三名未弃牌的玩家');
    const position = seats.findIndex((p) => p.id === playerId);
    const left = seats[(position - 1 + seats.length) % seats.length];
    const right = seats[(position + 1) % seats.length];
    if (hasTrick(room, left.id, 'guard_epic') || hasTrick(room, right.id, 'guard_epic'))
      throw new Error('相邻玩家的牌受到保护');
    if (holeCardsLocked(left, playerId) || holeCardsLocked(right, playerId))
      throw new Error('相邻玩家已全下，底牌不能再被替换');
    if (!resistSwap(room, playerId, [left, right])) {
      [left.holeCards[1], right.holeCards[0]] = [right.holeCards[0], left.holeCards[1]];
      affectedPlayerIds.add(left.id);
      affectedPlayerIds.add(right.id);
      addTrickMessage(room, playerId, '左邻右舍：相邻玩家各一张牌已交换');
    }
  } else if (trickId === 'disable_tricks') {
    h.trickDisabled.add(target.id);
    addTrickMessage(room, target.id, '你中了功力耗尽，本局千术不能再发动');
  } else if (trickId === 'mental_chaos') {
    const victims = h.actingOrder.map((id) => room.findPlayer(id))
      .filter((p) => p.id !== playerId && !hasTrick(room, p.id, 'guard_epic') && !p.allIn &&
        !holeCardsImmovable(room, p, playerId));
    if (!victims.length) throw new Error('没有可以替换底牌的玩家');
    if (!resistSwap(room, playerId, victims)) {
      const pool = [...h.deck, ...victims.flatMap((p) => p.holeCards)];
      const selected = Array.from({ length: victims.length * 2 }, () =>
        pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      for (const card of selected) {
        const index = h.deck.indexOf(card);
        if (index !== -1) h.deck.splice(index, 1);
      }
      victims.forEach((victim, index) => {
        victim.holeCards = selected.slice(index * 2, index * 2 + 2);
        affectedPlayerIds.add(victim.id);
      });
      addTrickMessage(room, playerId, '精神错乱：其他玩家底牌已随机替换');
    }
  } else if (trickId === 'drain_big') {
    if (Math.ceil(room.trickMatch.handNumber / TRICK_PHASE_HANDS) >= 4)
      throw new Error('第四阶段不能使用');
    const active = room.players.filter((p) => !p.kicked && !p.eliminated).sort((a, b) => a.seat - b.seat);
    const index = active.findIndex((p) => p.id === playerId);
    const neighbors = [active[(index - 1 + active.length) % active.length],
      active[(index + 1) % active.length]].filter((p) => p.id !== playerId);
    const victim = randomItem(neighbors);
    const amount = Math.floor(victim.chips / 40) * 10;
    if (amount <= 0) throw new Error('相邻玩家筹码不足');
    victim.chips -= amount;
    player.chips += amount;
    affectedPlayerIds.add(victim.id);
    addTrickMessage(room, playerId, `抽筹·顺手：从 ${victim.name} 取得 ${amount}`);
  } else if (trickId === 'drain_quarter') {
    if (h.stage === 'RIVER') throw new Error('河牌阶段不能截流');
    const pot = availablePot(room);
    const amount = potDrainAmount(room, trickId);
    if (!amount || pot < amount) throw new Error('底池筹码不足');
    h.trickPotDrain = (h.trickPotDrain || 0) + amount;
    player.chips += amount;
    addTrickMessage(room, playerId, `从底池抽走 ${amount} 筹码`);
  } else if (trickId === 'exchange') {
    if (holeCardsLocked(target, playerId)) throw new Error('对方已全下，底牌不能再被替换');
    if (hasTrick(room, target.id, 'guard_epic')) throw new Error('对方的底牌不能被转移');
    if (holeCardsImmovable(room, target, playerId)) throw new Error('不动如山：对方的底牌不能被替换');
    if (!options.both && (![0, 1].includes(options.myCardIndex) ||
        ![0, 1].includes(options.cardIndex))) throw new Error('请选择双方各一张牌');
    if (!resistSwap(room, playerId, [target])) {
      if (options.both) {
        [player.holeCards, target.holeCards] = [target.holeCards, player.holeCards];
      } else {
        const mine = options.myCardIndex;
        const theirs = options.cardIndex;
        [player.holeCards[mine], target.holeCards[theirs]] =
          [target.holeCards[theirs], player.holeCards[mine]];
      }
      alertTarget(room, player, target);
      addTrickMessage(room, playerId, `已与 ${target.name} 换牌`);
      addTrickMessage(room, target.id, `${player.name} 与你换了底牌`);
    }
  } else if (trickId === 'forced_fold') {
    if (h.stage !== 'RIVER') throw new Error('只能在河牌阶段使用');
    if (target.folded || target.allIn) throw new Error('不能指定已弃牌或全下的玩家');
    const targetIndex = h.actingOrder.indexOf(target.id);
    if (!h.needsToAct.has(target.id) || targetIndex <= h.turnIndex ||
        !h.actingOrder.slice(h.turnIndex + 1).some((id) => id === target.id && h.needsToAct.has(id)))
      throw new Error('只能指定尚未行动且排在你之后的玩家');
    if (h.trickForcedFolds?.has(target.id)) throw new Error('该玩家已经中了买断效果');
    const pot = room.players.reduce((sum, p) => sum + p.betThisHand, 0) - (h.trickPotDrain || 0);
    const price = Math.floor(pot / 40) * 10;
    if (price <= 0 || player.chips < price) throw new Error('支付筹码不足');
    const callAmount = Math.max(0, h.currentBet - player.betThisRound);
    if (player.chips - price < callAmount || (callAmount === 0 && player.chips === price))
      throw new Error('支付后筹码不足以完成本次跟注，无法使用');
    player.chips -= price;
    target.chips += price;
    h.trickForcedFolds.set(target.id, playerId);
    addTrickMessage(room, playerId, `已支付 ${price} 筹码给 ${target.name}；你完成本次行动后，目标轮到行动时只能弃牌`);
    addTrickMessage(room, target.id, `你中了赠筹·买断：${player.name} 支付你 ${price} 筹码；轮到你行动时只能弃牌`);
  } else if (trickId === 'reveal_tax') {
    const victims = h.actingOrder.map((id) => room.findPlayer(id))
      .filter((p) => p.id !== playerId && p.chips >= room.bigBlind);
    if (!victims.length) throw new Error('没有筹码足够的对手');
    h.publicReveals.add(playerId);
    for (const victim of victims) {
      victim.chips -= room.bigBlind;
      player.chips += room.bigBlind;
      affectedPlayerIds.add(victim.id);
      if (victim.chips === 0 && !victim.folded) {
        victim.allIn = true;
        h.allInLocked = true;
        h.needsToAct.delete(victim.id);
      }
    }
    addTrickMessage(room, playerId, `公开底牌，获得 ${victims.length * room.bigBlind} 筹码`);
  } else if (trickId === 'suit_count') {
    const suits = { h: 0, d: 0, c: 0, s: 0 };
    for (const card of h.deck) suits[card[1]]++;
    addTrickMessage(room, playerId, `未使用牌：♥${suits.h} ♦${suits.d} ♣${suits.c} ♠${suits.s}`);
  } else if (trickId === 'shared_rain') {
    const report = h.actingOrder.map((id) => room.findPlayer(id)).map((p) =>
      p.id !== playerId && blockedFromSeeing(room, p.id) ? `${p.name}：受防窥保护` :
        `${p.name}：${observedHoleCards(room, playerId, p.id).reduce((a, b) => rankValue(a) <= rankValue(b) ? a : b)[0]}`);
    for (const id of h.actingOrder)
      if (id !== playerId && !blockedFromSeeing(room, id)) affectedPlayerIds.add(id);
    addTrickMessage(room, playerId, `雨露均沾：${report.join('；')}`);
  } else if (trickId === 'suit_or_run') {
    const [a, b] = observedHoleCards(room, playerId, target.id);
    const x = rankValue(a), y = rankValue(b);
    const consecutive = Math.abs(x - y) === 1 || (x === 14 && y === 2) ||
      (y === 14 && x === 2) || (x === 14 && y === 13) || (y === 14 && x === 13);
    addTrickMessage(room, playerId, `${target.name}：${a[1] === b[1] ? '同花' : '不同花'}，${consecutive ? '点数相连' : '点数不相连'}`);
    alertTarget(room, player, target);
  } else if (trickId === 'discard_both') {
    if (!target.folded) throw new Error('对方还没有弃牌');
    addView(room, playerId, `${target.name} 的弃牌`, observedHoleCards(room, playerId, target.id).slice());
    alertTarget(room, player, target);
  } else if (trickId === 'high_probe') {
    addTrickMessage(room, playerId, `${target.name}：${observedHoleCards(room, playerId, target.id).some((card) => rankValue(card) >= 11) ? '有' : '没有'} J 或更高的底牌`);
    alertTarget(room, player, target);
  } else if (['next_color', 'next_high', 'next_suit', 'peek_next', 'future_self'].includes(trickId)) {
    const card = nextBoardCard(h);
    if (!card) throw new Error('没有尚未揭晓的公共牌');
    if (trickId === 'next_color') addTrickMessage(room, playerId, `下一张公共牌是${cardColor(card)}牌`);
    else if (trickId === 'next_high') addTrickMessage(room, playerId, `下一张公共牌${rankValue(card) >= 10 ? '是' : '不是'} 10 或更高`);
    else if (trickId === 'next_suit')
      addTrickMessage(room, playerId, `下一张公共牌的花色：${{ h: '♥', d: '♦', c: '♣', s: '♠' }[card[1]]}`);
    else if (trickId === 'peek_next') addView(room, playerId, '下一张公共牌', [card]);
    else {
      if (h.community.length < 3) throw new Error('翻牌后才能使用');
      const now = solve([...player.holeCards, ...h.community]);
      const after = solve([...player.holeCards, ...h.community, card]);
      addTrickMessage(room, playerId, `自照：下一张公共牌${after.rank > now.rank ? '会' : '不会'}提升你的牌型等级`);
    }
  } else if (trickId === 'rank_count') {
    const cards = undealtCards(h);
    const ranks = [...new Set(player.holeCards.map((card) => card[0]))];
    addTrickMessage(room, playerId,
      `算牌：牌堆中还剩 ${ranks.map((rank) => `${rank === 'T' ? '10' : rank} ${cards.filter((card) =>
        card[0] === rank).length} 张`).join('，')}`);
  } else if (trickId === 'hand_scent') {
    if (h.stage !== 'FLOP') throw new Error('只能在翻牌阶段使用');
    addTrickMessage(room, playerId, `${target.name} 当前牌型：${hasTrick(room, target.id, 'fake_intel') ? '高牌' : solve([...target.holeCards, ...h.community]).name}`);
    alertTarget(room, player, target);
  } else if (trickId === 'table_leader' || trickId === 'strength_count') {
    if (h.community.length < 3) throw new Error('翻牌后才能使用');
    const visible = h.actingOrder.map((id) => room.findPlayer(id))
      .filter((p) => !p.folded && (p.id === playerId || !blockedFromSeeing(room, p.id)));
    if (trickId === 'table_leader') {
      if (h.stage !== 'RIVER') throw new Error('只能在河牌阶段使用');
      if (!visible.length) throw new Error('没有可比较的玩家');
      const solved = visible.map((p) => solve([...observedHoleCards(room, playerId, p.id), ...h.community]));
      const bestRank = Math.max(...solved.map((hand) => hand.rank));
      const leaders = visible.filter((p, index) => solved[index].rank === bestRank);
      addTrickMessage(room, playerId, `抬眼：${randomItem(leaders).name} 持有当前最高牌型之一`);
    } else {
      if (h.stage !== 'FLOP') throw new Error('只能在翻牌阶段使用');
      const mine = solve([...player.holeCards, ...h.community]);
      const stronger = visible.filter((p) => p.id !== playerId &&
        !pickWinners([mine, solve([...observedHoleCards(room, playerId, p.id), ...h.community])]).includes(mine));
      addTrickMessage(room, playerId, `当前有 ${stronger.length} 位未受防窥保护的对手强于你`);
    }
    for (const p of visible) affectedPlayerIds.add(p.id);
  } else if (trickId === 'reveal_one') {
    const choices = observedLoadout(room, playerId, target.id);
    if (!choices.length) throw new Error('对方还没有千术');
    addTrickMessage(room, playerId, `${target.name} 的一项千术：${TRICKS[randomItem(choices)].name}`);
  } else if (trickId === 'steal_skill') {
    const eligible = new Set(eligibleTricks(room, playerId, new Set()).map((trick) => trick.id));
    const candidates = owned(room, target.id).filter((id) =>
      id !== 'steal_skill' && eligible.has(id));
    if (!candidates.length) throw new Error('对方没有可偷学的千术');
    const gained = randomItem(candidates);
    const mine = owned(room, playerId);
    // A 偷师 borrowed through 千术反转 is not in the loadout, so the stolen trick is added instead.
    room.trickMatch.owned.set(playerId, mine.includes('steal_skill')
      ? mine.map((id) => (id === 'steal_skill' ? gained : id))
      : [...mine, gained]);
    addTrickMessage(room, playerId, `偷师：永久获得 ${TRICKS[gained].name}`);
    grantSelectionBonus(room, playerId, gained);
  } else if (trickId === 'color_bet') {
    if (h.stage === 'RIVER') throw new Error('河牌后不能押色');
    if (h.trickColorBets.has(playerId)) throw new Error('本局已经押过河牌花色');
    if (!['h', 'd', 'c', 's'].includes(options.suit)) throw new Error('请选择河牌花色');
    h.trickColorBets.set(playerId, options.suit);
    addTrickMessage(room, playerId, `已押河牌花色为${{ h: '红桃', d: '方块', c: '梅花', s: '黑桃' }[options.suit]}`);
  } else if (trickId === 'yin_ghost' || trickId === 'yin_buddha') {
    if (room.trickMatch.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES)
      throw new Error('本场已没有下一局');
    room.trickMatch.pendingYinEffects.push({ playerId, trickId,
      handNumber: room.trickMatch.handNumber + 1 });
    addTrickMessage(room, playerId, `${trick.name}：下一局生效`);
  } else if (trickId === 'board_audit') {
    if (h.stage !== 'RIVER') throw new Error('只能在河牌阶段验牌');
    const offenders = [...h.trickBoardSwappers].map((id) => room.findPlayer(id))
      .filter((p) => p && p.id !== playerId && !p.folded && !p.allIn);
    if (!offenders.length) throw new Error('没有可处理的换公牌玩家');
    h.trickAuditTargets = offenders.map((p) => p.id);
    for (const offender of offenders) {
      affectedPlayerIds.add(offender.id);
      addTrickMessage(room, offender.id, '你被“我要验牌”查出换公牌，本局已弃牌');
    }
    addTrickMessage(room, playerId, `我要验牌：${offenders.map((p) => p.name).join('、')} 已弃牌`);
  } else if (trickId === 'bottom_deal' || trickId === 'suit_shift') {
    const index = options.cardIndex;
    if (![0, 1].includes(index)) throw new Error('请选择自己的一张底牌');
    const candidates = trickId === 'bottom_deal' ? h.deck.slice(0, 1) :
      h.deck.filter((card) => card[0] === player.holeCards[index][0] && card[1] !== player.holeCards[index][1]);
    if (!candidates.length) throw new Error('牌堆里没有符合条件的牌');
    const next = trickId === 'bottom_deal' ? candidates[0] : randomItem(candidates);
    takeDeckCard(h, next);
    player.holeCards[index] = next;
    addTrickMessage(room, playerId, `${trick.name}：新底牌已生效`);
  } else if (['ace_card', 'king_card', 'queen_card'].includes(trickId)) {
    const rank = { ace_card: 'A', king_card: 'K', queen_card: 'Q' }[trickId];
    const candidates = h.deck.filter((card) => card[0] === rank);
    if (!candidates.length) throw new Error(`牌堆里没有可用的 ${rank}`);
    const index = rankValue(player.holeCards[0]) <= rankValue(player.holeCards[1]) ? 0 : 1;
    const next = randomItem(candidates);
    takeDeckCard(h, next);
    player.holeCards[index] = next;
    addTrickMessage(room, playerId, `${trick.name}：较小的底牌已替换`);
  } else if (trickId === 'reverse_board') {
    if (h.stage !== 'PREFLOP') throw new Error('只能在翻牌前使用');
    if (boardLocked(h)) throw new Error('不动如山：转牌或河牌已被锁定，不能倒序');
    if (h.deck.length < 8) throw new Error('牌堆不足以倒序发牌');
    const n = h.deck.length;
    const reversed = [h.deck[n - 8], h.deck[n - 6], h.deck[n - 4],
      h.deck[n - 3], h.deck[n - 2]];
    for (const card of reversed) takeDeckCard(h, card);
    h.trickNextBoard = reversed;
    h.trickReverseBoard = true;
    addTrickMessage(room, playerId, '倒序：本局五张公共牌将按相反顺序依次翻出');
  } else if (trickId === 'steal_hole') {
    if (holeCardsLocked(target, playerId)) throw new Error('对方已全下，底牌不能再被替换');
    if (target.folded || hasTrick(room, target.id, 'guard_epic'))
      throw new Error('对方底牌不能被交换');
    if (![0, 1].includes(options.cardIndex)) throw new Error('请选择对方的一张底牌');
    if (!resistSwap(room, playerId, [target])) {
      const myIndex = Math.floor(Math.random() * 2);
      [player.holeCards[myIndex], target.holeCards[options.cardIndex]] =
        [target.holeCards[options.cardIndex], player.holeCards[myIndex]];
      addTrickMessage(room, playerId, `偷梁入手：已与 ${target.name} 换牌`);
      addTrickMessage(room, target.id, `${player.name} 与你交换了一张底牌`);
      alertTarget(room, player, target);
    }
  } else if (trickId === 'blind_box') {
    if (h.deck.length < 3) throw new Error('牌堆不足');
    const sample = h.deck.slice().sort(() => Math.random() - .5).slice(0, 3);
    addView(room, playerId, '盲盒', sample);
  } else if (trickId === 'mark_chosen') {
    const opponents = h.actingOrder.map((id) => room.findPlayer(id))
      .filter((p) => p.id !== playerId && !blockedFromSeeing(room, p.id));
    if (!opponents.length) throw new Error('没有可查看的玩家');
    for (const opponent of opponents) {
      affectedPlayerIds.add(opponent.id);
      const observed = observedHoleCards(room, playerId, opponent.id);
      addHoleCardIntel(room, playerId, opponent.id, 0, observed[0], opponent.holeCards[0], ['color']);
      addHoleCardIntel(room, playerId, opponent.id, 1, observed[1], opponent.holeCards[1], ['suit']);
      addTrickMessage(room, playerId,
        `${opponent.name}：第一张${cardColor(observed[0])}，第二张${{ h: '红桃', d: '方块', c: '梅花', s: '黑桃' }[observed[1][1]]}`);
    }
    const firstFlop = h.stage === 'PREFLOP'
      ? nextBoardCard(h)
      : h.community[0];
    if (firstFlop) addTrickMessage(room, playerId,
      `第一张翻牌花色：${{ h: '红桃', d: '方块', c: '梅花', s: '黑桃' }[firstFlop[1]]}`);
  } else if (trickId === 'peek_rank') {
    const index = Math.floor(Math.random() * 2);
    const observed = observedHoleCards(room, playerId, target.id)[index];
    addHoleCardIntel(room, playerId, target.id, index, observed, target.holeCards[index], ['rank']);
    addTrickMessage(room, playerId,
      `${target.name} 的${index === 0 ? '左' : '右'}张底牌点数：${observed[0] === 'T' ? '10' : observed[0]}`);
    alertTarget(room, player, target);
  } else if (trickId === 'peek_one') {
    const index = options.cardIndex;
    if (index !== 0 && index !== 1) throw new Error('请选择左牌或右牌');
    addView(room, playerId, `${target.name} 的${index === 0 ? '左' : '右'}牌`, [observedHoleCards(room, playerId, target.id)[index]]);
    showHoleCardsOnTable(room, playerId, target.id, [index]);
    alertTarget(room, player, target);
  } else if (trickId === 'peek_both') {
    addView(room, playerId, `${target.name} 的两张底牌`, observedHoleCards(room, playerId, target.id).slice());
    showHoleCardsOnTable(room, playerId, target.id, [0, 1]);
    alertTarget(room, player, target);
  } else if (trickId === 'peek_all') {
    const targets = room.players.filter((p) => p.id !== playerId &&
      h.actingOrder.includes(p.id) && !blockedFromSeeing(room, p.id));
    if (!targets.length) throw new Error('没有可窥视的对手');
    for (const p of targets) {
      affectedPlayerIds.add(p.id);
      addView(room, playerId, `${p.name} 的两张底牌`, observedHoleCards(room, playerId, p.id).slice());
      if (!h.trickPeeks.has(playerId)) h.trickPeeks.set(playerId, new Set());
      h.trickPeeks.get(playerId).add(p.id);
      alertTarget(room, player, p, 'peek_all');
    }
  } else if (trickId === 'reveal_loadout') {
    addTrickMessage(room, playerId, `${target.name} 已选千术：${observedLoadout(room, playerId, target.id).map((id) => TRICKS[id].name).join('、') || '暂无'}；底牌点数 ${observedHoleCards(room, playerId, target.id).map((card) => card[0]).join('、')}`);
  } else if (trickId === 'river_report') {
    if (h.stage !== 'RIVER') throw new Error('仅河牌阶段使用');
    const players = h.actingOrder.map((id) => room.findPlayer(id));
    for (const p of players) affectedPlayerIds.add(p.id);
    const hands = players.map((p) => solve([...observedHoleCards(room, playerId, p.id), ...h.community]));
    const best = pickWinners(hands)[0];
    addTrickMessage(room, playerId, `河牌公报：当前最高牌型 ${best.name}`);
    h.trickPublicAnnouncements = [...(h.trickPublicAnnouncements || []),
      `河牌公报：本局最高牌型${best.rank >= 3 ? '达到或超过两对' : '低于两对'}`];
  } else if (trickId === 'intuition') {
    if (h.community.length < 3) throw new Error('翻牌后才能使用');
    if (player.folded || target.folded) throw new Error('只能比较仍在局的玩家');
    const mine = solve([...player.holeCards, ...h.community]);
    const theirs = solve([...observedHoleCards(room, playerId, target.id), ...h.community]);
    const winners = pickWinners([mine, theirs]);
    addTrickMessage(room, playerId, `胜负直觉：你当前${winners.length === 2 ? '与对方相同' : winners[0] === mine ? '领先' : '落后'}（之后可能变化）`);
    alertTarget(room, player, target);
  } else if (trickId === 'fate_swap') {
    if (h.stage !== 'FLOP' || h.community.length !== 3) throw new Error('只能在翻牌阶段使用');
    const live = h.actingOrder.map((id) => room.findPlayer(id)).filter((p) => !p.folded);
    const solved = live.map((p) => solve([...p.holeCards, ...h.community]));
    const winners = pickWinners(solved);
    const targets = live.filter((p, i) => p.id !== playerId && winners.includes(solved[i]) &&
      !hasTrick(room, p.id, 'guard_epic') && !p.allIn && !holeCardsImmovable(room, p, playerId));
    if (!targets.length) throw new Error('没有可交换的最强玩家（已全下的玩家不能交换）');
    const chosen = randomItem(targets);
    if (!resistSwap(room, playerId, [chosen])) {
      [player.holeCards, chosen.holeCards] = [chosen.holeCards, player.holeCards];
      affectedPlayerIds.add(chosen.id);
      alertTarget(room, player, chosen, 'fate_swap');
      addTrickMessage(room, playerId, `天命易手：已与 ${chosen.name} 交换两张底牌`);
      addTrickMessage(room, chosen.id, `${player.name} 与你交换了两张底牌`);
    }
  } else if (trickId === 'immovable') {
    if (!['PREFLOP', 'FLOP'].includes(h.stage)) throw new Error('只能在转牌翻出前锁定');
    const slot = { turn: 3, river: 4 }[options.street];
    if (slot === undefined) throw new Error('请选择锁定转牌还是河牌');
    if (h.trickBoardLocks[slot]) throw new Error(`${slot === 3 ? '转牌' : '河牌'}已经被锁定`);
    // The card leaves the deck (or the queued board) and waits for its own slot, so no draw can take
    // it and every other card is still dealt where it would have been.
    const card = plannedBoard(h)[slot];
    if (!card) throw new Error('牌堆剩余牌不够');
    if (Array.isArray(h.trickNextBoard) && h.trickNextBoard.includes(card)) {
      h.trickNextBoard.splice(h.trickNextBoard.indexOf(card), 1);
      if (!h.trickNextBoard.length) h.trickNextBoard = null;
    } else if (h.trickNextBoard === card) h.trickNextBoard = null;
    else takeDeckCard(h, card);
    h.trickBoardLocks[slot] = card;
    addTrickMessage(room, playerId, `不动如山：已锁定${slot === 3 ? '转牌' : '河牌'}，任何千术都不能再替换它`);
  } else if (trickId === 'guess_holes') {
    if (h.stage === 'RIVER' || target.folded || target.allIn)
      throw new Error('只能在河牌前猜仍可行动的对手');
    if (!Array.isArray(options.ranks) || options.ranks.length !== 2 ||
        options.ranks.some((rank) => !'23456789TJQKA'.includes(rank) || rank.length !== 1))
      throw new Error('请选择两张牌的点数');
    const actual = target.holeCards.map((card) => card[0]).sort().join('');
    if (options.ranks.slice().sort().join('') === actual) {
      h.trickForcedGuessFolds.add(target.id);
      addTrickMessage(room, playerId, `管中窥豹：猜中 ${target.name}，其下次行动只能弃牌`);
      addTrickMessage(room, target.id, '你中了管中窥豹：下一次行动只能弃牌');
    } else addTrickMessage(room, playerId, `管中窥豹：未猜中 ${target.name}`);
  } else if (trickId === 'ultimate_swap') {
    const choices = h.actingOrder.filter((id) => id !== playerId)
      .map((id) => room.findPlayer(id))
      .filter((p) => !p.folded && !p.allIn && !hasTrick(room, p.id, 'guard_epic') &&
        !holeCardsImmovable(room, p, playerId))
      .flatMap((p) => p.holeCards.map((card, index) => ({ p, index, card, tie: Math.random() })))
      .sort((a, b) => rankValue(b.card) - rankValue(a.card) || a.tie - b.tie);
    if (choices.length < 2) throw new Error('没有两张可交换的对手底牌');
    const chosen = choices.slice(0, 2).map((choice, ownIndex) => ({ ...choice, ownIndex }))
      .filter(({ card, ownIndex }) => rankValue(card) > rankValue(player.holeCards[ownIndex]));
    if (!chosen.length) throw new Error('最大的两张对手底牌都没有高于你的对应底牌');
    const targets = [...new Set(chosen.map(({ p }) => p))];
    if (!resistSwap(room, playerId, targets)) {
      for (const { p: other, index, ownIndex } of chosen) {
        [player.holeCards[ownIndex], other.holeCards[index]] =
          [other.holeCards[index], player.holeCards[ownIndex]];
        affectedPlayerIds.add(other.id);
        alertTarget(room, player, other, trickId);
      }
      addTrickMessage(room, playerId, `终极替换：已换入 ${chosen.length} 张更大的对手底牌`);
    }
  } else if (trickId === 'ban_pairs') {
    const index = options.communityIndex;
    if (!Number.isInteger(index) || index < 0 || index >= h.community.length)
      throw new Error('请选择一张已翻出的公共牌');
    const rank = h.community[index][0];
    const targets = h.actingOrder.filter((id) => id !== playerId)
      .map((id) => room.findPlayer(id))
      .filter((p) => !p.folded && !p.allIn && !hasTrick(room, p.id, 'guard_epic') &&
        !holeCardsImmovable(room, p, playerId) && p.holeCards.some((card) => card[0] === rank));
    if (!targets.length) throw new Error('其他玩家没有同点数底牌');
    if (h.deck.length < targets.flatMap((p) => p.holeCards).filter((card) => card[0] === rank).length)
      throw new Error('牌堆没有足够的新牌');
    if (!resistSwap(room, playerId, targets)) {
      for (const targetPlayer of targets) {
        for (const holeIndex of [0, 1]) {
          if (targetPlayer.holeCards[holeIndex][0] !== rank) continue;
          const next = randomItem(h.deck);
          takeDeckCard(h, next);
          targetPlayer.holeCards[holeIndex] = next;
        }
        affectedPlayerIds.add(targetPlayer.id);
        alertTarget(room, player, targetPlayer, trickId);
      }
      addTrickMessage(room, playerId, `禁止成对：已替换其他玩家点数为 ${rank} 的底牌`);
    }
  } else {
    throw new Error('千术尚未实现');
  }

  if (trickId === 'retention_legendary' && h.stage === 'RIVER') return null;
  if (needsTarget) affectedPlayerIds.add(target.id);
  const reached = trickId === 'board_audit' ? new Set([...affectedPlayerIds, ...h.trickAuditTargets]) : affectedPlayerIds;
  const defender = reflectors.find((p) => reached.has(p.id));
  if (defender) {
    // Cancelled: the table goes back to how it was, the user's count is still spent, and the
    // defender may use the same trick for the rest of this hand.
    restoreTable(room, snapshot);
    h.trickChoices.delete(playerId);
    const record = useRecord(room, playerId, trickId);
    room.trickMatch.uses.set(record.key, [...record.uses, room.trickMatch.handNumber]);
    h.trickUsedThisHand.add(record.key);
    h.trickActiveUsers.add(playerId);
    if (borrowed) h.trickBorrowed.delete(playerId);
    const shield = useRecord(room, defender.id, 'ultimate_reflect');
    room.trickMatch.uses.set(shield.key, [...shield.uses, room.trickMatch.handNumber]);
    if (!h.trickBorrowed.has(defender.id)) {
      h.trickBorrowed.set(defender.id, trickId);
      h.trickBorrowedVia.set(defender.id, 'ultimate_reflect');
    }
    addTrickMessage(room, playerId, `${defender.name} 的终极抵抗反转打消了你的 ${trick.name}（次数照常消耗）`);
    addTrickMessage(room, defender.id, `终极抵抗反转：打消了 ${player.name} 的 ${trick.name}，本局暂时获得该千术`);
    return null;
  }
  const { key, uses } = useRecord(room, playerId, trickId);
  room.trickMatch.uses.set(key, [...uses, room.trickMatch.handNumber]);
  h.trickUsedThisHand.add(key);
  h.trickActiveUsers.add(playerId);
  if (borrowed) {
    h.trickBorrowed.delete(playerId);
    // Only a 千术反转 copy counts against 千术反转's own limit.
    if (h.trickBorrowedVia.get(playerId) !== 'ultimate_reflect') {
      const reflection = useRecord(room, playerId, 'trick_reflect');
      room.trickMatch.uses.set(reflection.key,
        [...reflection.uses, room.trickMatch.handNumber]);
    }
    h.trickBorrowedVia.delete(playerId);
  }
  for (const id of affectedPlayerIds)
    if (id !== playerId) reflectTrick(room, id, trickId);
  if (needsTarget) alertTarget(room, player, target, trickId);
  for (const p of room.players) {
    const traced = room.trickMatch.traceSeen.get(p.id) || new Set();
    if (p.id !== playerId && !hasTrick(room, playerId, 'quiet_move') &&
        hasTrick(room, p.id, 'skill_trace') && !traced.has(playerId)) {
      addTrickMessage(room, p.id, `破局录：${player.name} 使用了 ${trick.name}`);
      traced.add(playerId);
      room.trickMatch.traceSeen.set(p.id, traced);
    }
  }
  return trickId === 'board_audit' ? { foldPlayerIds: h.trickAuditTargets } : null;
}
