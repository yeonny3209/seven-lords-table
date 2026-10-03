/* =====================================================================
 * 02. 데이터 테이블 (아이템 · 주문 · 군주 유형 · 증강 · AI 군주 · 몬스터)
 * ===================================================================== */

/* ---------- 아이템 ---------- */
const COMPONENTS = {
  sword: { name: '검',     icon: '🗡️', stats: { atk: 15 },      desc: '공격력 +15' },
  bow:   { name: '활',     icon: '🏹', stats: { as: 0.15 },     desc: '공격 속도 +15%' },
  armor: { name: '갑옷',   icon: '🛡️', stats: { armor: 25 },    desc: '방어력 +25' },
  cloak: { name: '망토',   icon: '🧥', stats: { mr: 25 },       desc: '마법 저항 +25' },
  rod:   { name: '지팡이', icon: '🪄', stats: { ap: 15 },       desc: '스킬 피해 +15%' },
  tear:  { name: '눈물',   icon: '💧', stats: { mana: 15 },     desc: '시작 마나 +15' },
  belt:  { name: '허리띠', icon: '🎗️', stats: { hp: 150 },      desc: '체력 +150' },
  glove: { name: '장갑',   icon: '🧤', stats: { crit: 0.15 },   desc: '치명타 +15%' },
};
const COMP_KEYS = Object.keys(COMPONENTS);

// 고유 효과가 있는 완성 아이템 20종 (나머지 16종은 수치 합산)
const UNIQUE_ITEMS = {
  'sword+sword': { name: '거인의 대검',   icon: '⚔️', fx: 'dmgAmp',     desc: '주는 피해 +15%' },
  'bow+sword':   { name: '질풍의 칼날',   icon: '🌪️', fx: 'asRamp',     desc: '공격할 때마다 공격 속도 +6% (최대 10회)' },
  'armor+sword': { name: '수호천사',      icon: '👼', fx: 'revive',     desc: '처음 죽을 때 1초 후 체력 400으로 부활' },
  'cloak+sword': { name: '흡혈의 낫',     icon: '🩸', fx: 'lifesteal',  desc: '공격 피해의 25% 회복' },
  'rod+sword':   { name: '마법검',        icon: '🗡', fx: 'spellVamp',  desc: '스킬 피해의 20% 회복' },
  'sword+tear':  { name: '쇼진의 창',     icon: '🔱', fx: 'manaHit',    desc: '공격 시 마나 +6 추가' },
  'belt+sword':  { name: '광전사의 도끼', icon: '🪓', fx: 'rage',       desc: '체력 50% 이하일 때 공격력 +35%' },
  'glove+sword': { name: '무한의 검',     icon: '🗡️', fx: 'critDmg',    desc: '치명타 피해 +40%' },
  'bow+bow':     { name: '붉은 덩굴',     icon: '🌹', fx: 'burnHit',    desc: '공격 시 대상에게 화상 (초당 20, 3초)' },
  'bow+rod':     { name: '번개 지팡이',   icon: '🌩️', fx: 'zap',        desc: '3번째 공격마다 대상 포함 3명에게 마법 피해 70' },
  'armor+armor': { name: '가시 갑옷',     icon: '🌵', fx: 'thorns',     desc: '피격 시 공격자에게 마법 피해 25' },
  'armor+belt':  { name: '솔라리 펜던트', icon: '📿', fx: 'locket',     desc: '전투 시작 시 주변 아군에게 보호막 200' },
  'cloak+cloak': { name: '침묵의 망토',   icon: '🧣', fx: 'ccImmune',   desc: '기절·빙결에 면역' },
  'armor+tear':  { name: '얼어붙은 심장', icon: '💠', fx: 'frostAura',  desc: '주변 2칸 적 공격 속도 -25%' },
  'rod+rod':     { name: '죽음의 모자',   icon: '🎩', fx: 'bigAp',      desc: '스킬 피해 +40% 추가' },
  'rod+tear':    { name: '군주의 인장',   icon: '🔆', fx: 'seal',       desc: '이 유닛이 아군 주문 대상이 되면 효과 +30%' },
  'tear+tear':   { name: '푸른 파수꾼',   icon: '🔵', fx: 'blueBuff',   desc: '스킬 사용 후 마나 25 회복' },
  'belt+belt':   { name: '워모그 갑옷',   icon: '💚', fx: 'regen',      desc: '매 초 최대 체력의 3% 회복' },
  'glove+glove': { name: '도적의 장갑',   icon: '🎭', fx: 'dodge',      desc: '공격을 20% 확률로 회피' },
  'glove+rod':   { name: '보석 건틀릿',   icon: '💍', fx: 'skillCrit',  desc: '스킬이 치명타로 적중할 수 있음' },
};
function itemKey(a, b) { return [a, b].sort().join('+'); }
function itemInfo(item) {
  // item: 'sword' (재료) 또는 'bow+sword' (완성)
  if (COMPONENTS[item]) {
    const c = COMPONENTS[item];
    return { name: c.name, icon: c.icon, desc: c.desc, stats: { ...c.stats }, fx: null, component: true };
  }
  const [a, b] = item.split('+');
  const stats = {};
  for (const k of [a, b]) for (const [s, v] of Object.entries(COMPONENTS[k].stats)) stats[s] = (stats[s] || 0) + v * 1.2;
  const u = UNIQUE_ITEMS[item];
  if (u) return { name: u.name, icon: u.icon, desc: u.desc, stats, fx: u.fx, component: false };
  return { name: `${COMPONENTS[a].name}·${COMPONENTS[b].name} 합성구`, icon: '🔶', desc: '재료 능력치 합산(×1.2)', stats, fx: null, component: false };
}
function statText(stats) {
  const L = { atk: '공격력', as: '공속', armor: '방어', mr: '마저', ap: '스킬피해', mana: '마나', hp: '체력', crit: '치명' };
  return Object.entries(stats).map(([k, v]) => {
    const pct = (k === 'as' || k === 'crit');
    return `${L[k]} +${pct ? Math.round(v * 100) + '%' : Math.round(v)}${k === 'ap' ? '%' : ''}`;
  }).join(', ');
}

/* ---------- 군주 주문 ---------- */
// target: ally | enemy | none | row | cell | ally2 (아군 둘) | allyCell (아군 + 빈 칸)
// v: [1단계, 2단계, 3단계], costDown: 단계별 마나 감소, up: 강화 비용(→2단계, →3단계)
const SPELLS = {
  shield:     { name: '방패의 기도', icon: '🛡️', kind: 'def', cost: 3, cd: 6,  target: 'ally',  up: [3, 4], costDown: [0, 0, 1],
                fx: [{ t: 'shieldPct', v: [0.40, 0.50, 0.60], dur: 3 }], desc: v => `아군 1명에게 최대 체력 ${pctS(v)}만큼 3초 보호막`, auto: ['allyLow40', 'asap'] },
  bolt:       { name: '번개 낙인',   icon: '⚡', kind: 'atk', cost: 4, cd: 8,  target: 'enemy', up: [3, 4], costDown: [0, 0, 0],
                fx: [{ t: 'dmg', v: [200, 280, 360] }, { t: 'stun', v: [1.5, 1.5, 1.75] }], desc: v => `적 1명에게 마법 피해 ${v}, 1.5초 기절`, auto: ['enemyMana80', 'enemyCarry', 'enemyLowest'] },
  march:      { name: '진군 명령',   icon: '📯', kind: 'atk', cost: 4, cd: 12, target: 'none',  up: [4, 5], costDown: [0, 0, 1],
                fx: [{ t: 'buffAll', stat: 'as', v: [0.35, 0.45, 0.50], dur: 5 }], desc: v => `아군 전체 공격 속도 +${pctS(v)}, 5초`, auto: ['midFight', 'losing'] },
  swap:       { name: '후퇴 신호',   icon: '🔁', kind: 'ctl', cost: 3, cd: 8,  target: 'ally2', up: [3, 4], costDown: [0, 1, 1],
                fx: [{ t: 'swap', v: [150, 250, 350] }], desc: v => `아군 2명의 위치를 맞바꾸고 둘 다 보호막 ${v}`, auto: ['swapTank'] },
  managift:   { name: '마나 선물',   icon: '💎', kind: 'ctl', cost: 5, cd: 15, target: 'ally',  up: [4, 5], costDown: [0, 1, 2],
                fx: [{ t: 'fillMana', v: [1, 1, 1] }], desc: () => '아군 1명의 스킬 마나를 즉시 채움', auto: ['carryMana'] },
  firewall:   { name: '불의 장막',   icon: '🔥', kind: 'atk', cost: 6, cd: 12, target: 'row',   up: [4, 6], costDown: [0, 0, 1],
                fx: [{ t: 'zone', v: [90, 120, 150], dur: 3 }], desc: v => `지정한 가로 1줄에 3초간 화염 지대 (초당 ${v})`, auto: ['rowMost'] },
  timestop:   { name: '시간 정지',   icon: '⏳', kind: 'ctl', cost: 8, once: true, target: 'none', up: [5, 6], costDown: [0, 0, 1],
                fx: [{ t: 'freezeAll', v: [2, 2.25, 2.5] }], desc: v => `적 전체 ${v}초 정지 (전투당 1회)`, auto: ['enemySkills', 'losing'] },
  resolve:    { name: '마지막 결의', icon: '🕯️', kind: 'def', cost: 7, once: true, target: 'ally', up: [5, 6], costDown: [0, 0, 1],
                fx: [{ t: 'undying', v: [3, 3.5, 4] }], desc: v => `아군 1명이 ${v}초간 죽지 않음 (전투당 1회)`, auto: ['allyDying'] },
  healrain:   { name: '치유의 비',   icon: '🌧️', kind: 'def', cost: 5, cd: 10, target: 'none',  up: [4, 5], costDown: [0, 0, 1],
                fx: [{ t: 'healAllPct', v: [0.18, 0.24, 0.30] }], desc: v => `아군 전체 최대 체력 ${pctS(v)} 회복`, auto: ['teamLow'] },
  frostward:  { name: '서리 결계',   icon: '❄️', kind: 'ctl', cost: 5, cd: 10, target: 'cell',  up: [3, 5], costDown: [0, 0, 1],
                fx: [{ t: 'slowArea', v: [0.35, 0.45, 0.55], dur: 3 }], desc: v => `3×3 범위 적 공격·이동 속도 -${pctS(v)}, 3초`, auto: ['enemyClump'] },
  meteor:     { name: '유성 낙하',   icon: '☄️', kind: 'atk', cost: 6, cd: 12, target: 'cell',  up: [4, 6], costDown: [0, 0, 0],
                fx: [{ t: 'dmgArea', v: [190, 260, 340] }], desc: v => `3×3 범위에 마법 피해 ${v}`, auto: ['enemyClump'] },
  warcry:     { name: '분노의 함성', icon: '📣', kind: 'atk', cost: 3, cd: 8,  target: 'ally',  up: [3, 4], costDown: [0, 0, 0],
                fx: [{ t: 'buffPct', stat: 'atk', v: [0.60, 0.80, 1.00], dur: 5 }], desc: v => `아군 1명 공격력 +${pctS(v)}, 5초`, auto: ['carryFight', 'asap'] },
  shadowstep: { name: '그림자 걸음', icon: '👣', kind: 'ctl', cost: 4, cd: 10, target: 'allyCell', up: [3, 4], costDown: [0, 1, 1],
                fx: [{ t: 'teleport', v: [150, 250, 350] }], desc: v => `아군 1명을 지정한 빈 칸으로 순간이동, 보호막 ${v}`, auto: ['rescueLow'] },
  taunt:      { name: '도발의 깃발', icon: '🚩', kind: 'def', cost: 3, cd: 10, target: 'ally',  up: [3, 4], costDown: [0, 0, 1],
                fx: [{ t: 'taunt', v: [50, 75, 100], dur: 3 }], desc: v => `아군 1명이 3초간 주변 2칸 적을 도발, 방어·마저 +${v}`, auto: ['tankFront'] },
  sunder:     { name: '약점 간파',   icon: '🎯', kind: 'atk', cost: 4, cd: 10, target: 'enemy', up: [3, 5], costDown: [0, 0, 0],
                fx: [{ t: 'sunder', v: [0.30, 0.40, 0.50], dur: 4 }], desc: v => `적 1명 방어력 -50%, 받는 피해 +${pctS(v)}, 4초`, auto: ['enemyFront', 'enemyCarry'] },
  reap:       { name: '영혼 수확',   icon: '🌑', kind: 'atk', cost: 6, cd: 15, target: 'enemy', up: [4, 6], costDown: [0, 0, 0],
                fx: [{ t: 'reap', v: [0.30, 0.35, 0.40] }], desc: v => `체력 ${pctS(v)} 이하 적 처형, 아니면 마법 피해 200`, auto: ['enemyExecute'] },
};
const SPELL_KEYS = Object.keys(SPELLS);
function pctS(v) { return Math.round(v * 100) + '%'; }
function spellCost(id, lvl) { return SPELLS[id].cost - SPELLS[id].costDown[lvl - 1]; }
function spellDesc(id, lvl) { return SPELLS[id].desc(SPELLS[id].fx[0].v[lvl - 1]); }

const AUTO_RULES = {
  off:          '자동 시전 안 함',
  asap:         '마나가 차면 즉시',
  allyLow40:    '체력 40% 이하 아군 중 아이템이 가장 많은 유닛에게',
  enemyMana80:  '마나가 80% 이상 찬 적에게',
  enemyCarry:   '아이템·코스트가 가장 높은 적에게',
  enemyLowest:  '체력이 가장 낮은 적에게',
  midFight:     '전투 3초 후',
  losing:       '아군 수가 적보다 적을 때',
  swapTank:     '앞줄 아군 체력 35% 이하 시 뒷줄 튼튼한 아군과 교체',
  carryMana:    '마나 50% 미만인 핵심 딜러에게',
  rowMost:      '적이 3명 이상 모인 줄에',
  enemySkills:  '적 2명 이상이 스킬을 쓰기 직전일 때',
  allyDying:    '체력 25% 이하 핵심 아군에게',
  teamLow:      '아군 평균 체력 60% 이하일 때',
  enemyClump:   '적 3명 이상 뭉친 곳에',
  carryFight:   '교전 중인 핵심 딜러에게',
  rescueLow:    '체력 35% 이하 아군을 안전한 곳으로',
  tankFront:    '뒷줄 아군이 공격받을 때 가장 튼튼한 아군에게',
  enemyFront:   '체력이 가장 높은 적에게',
  enemyExecute: '처형 가능한 적이 생기면',
};

/* ---------- 군주 유형 ---------- */
const LORD_TYPES = {
  war:    { name: '전쟁 군주', icon: '⚔️', spells: ['bolt', 'warcry'],    passive: '주문 피해 +15%',              desc: '공격형 주문으로 적의 핵심을 끊어낸다.' },
  guard:  { name: '수호 군주', icon: '🛡️', spells: ['shield', 'healrain'], passive: '아군 보호막 주문 지속 시간 +1초', desc: '방어형 주문으로 아군을 끝까지 지킨다.' },
  tactic: { name: '책략 군주', icon: '♟️', spells: ['swap', 'frostward'],  passive: '전투의 첫 주문 마나 비용 -2',   desc: '위치·제어형 주문으로 전장을 뒤흔든다.' },
};

/* ---------- 증강 (30종, 주문 관련 8종) ---------- */
const AUGMENTS = {
  income:      { name: '영지 세금',      icon: '💰', desc: '매 라운드 골드 +1' },
  emblem:      { name: '계열 문장',      icon: '🎖️', desc: '{trait} 시너지 요구 인원 -1', param: 'trait' },
  frontline:   { name: '최전선',         icon: '🧱', desc: '앞줄 유닛 체력 +20%' },
  cheapRoll:   { name: '값싼 새로고침',  icon: '🔄', desc: '상점 새로고침 비용 1골드' },
  bigBoard:    { name: '대군주의 위엄',  icon: '👑', desc: '보드에 올릴 수 있는 유닛 +1' },
  scholar:     { name: '학구열',         icon: '📚', desc: '매 라운드 경험치 +2' },
  bigInterest: { name: '복리',           icon: '🏦', desc: '이자 최대치 7골드' },
  backline:    { name: '후방 지원',      icon: '🎯', desc: '뒤쪽 2줄 유닛 공격력 +15%' },
  streakPlus:  { name: '기세',           icon: '🔥', desc: '연승·연패 보너스 +1골드' },
  loot:        { name: '전리품',         icon: '🎁', desc: '즉시 재료 아이템 2개 획득' },
  cash:        { name: '비상금',         icon: '💵', desc: '즉시 15골드 획득' },
  critAll:     { name: '날카로운 칼날',  icon: '🔪', desc: '모든 아군 치명타 확률 +15%' },
  armorAll:    { name: '철벽',           icon: '🏰', desc: '모든 아군 방어력·마법 저항 +20' },
  apAll:       { name: '마력 증폭',      icon: '🌀', desc: '모든 아군 스킬 피해 +20%' },
  regenAll:    { name: '재생의 축복',    icon: '💗', desc: '모든 아군 매 초 체력 1.5% 회복' },
  manaStart:   { name: '선수 필승',      icon: '🥇', desc: '모든 아군 시작 마나 +20' },
  heartyHP:    { name: '군주의 활력',    icon: '❤️', desc: '즉시 군주 체력 +20' },
  swift:       { name: '신속',           icon: '💨', desc: '모든 아군 공격 속도 +15%' },
  giant:       { name: '거인화',         icon: '🦣', desc: '모든 아군 체력 +12%' },
  freeRoll:    { name: '행운의 상점',    icon: '🍀', desc: '매 라운드 첫 새로고침 무료' },
  hire:        { name: '용병 계약',      icon: '📜', desc: '즉시 무작위 3코스트 유닛 2개 획득' },
  lifesteal:   { name: '피의 계약',      icon: '🧛', desc: '모든 아군 공격 피해의 10% 회복' },
  // 주문 관련 8종
  spellSlot:   { name: '비전 확장',      icon: '📖', desc: '주문 슬롯 +1, 대신 경험치 구매 비용 +1골드', spell: true },
  manaHead:    { name: '선제 마나',      icon: '🔋', desc: '전투 시작 시 군주 마나 3으로 시작', spell: true },
  manaSpring:  { name: '마나의 샘',      icon: '⛲', desc: '군주 마나 회복 속도 +30%', spell: true },
  spellHone:   { name: '주문 연마',      icon: '⚒️', desc: '보유 주문 전부 1단계 무료 강화', spell: true },
  library:     { name: '비전 서고',      icon: '🏛️', desc: '무작위 주문 2장 획득', spell: true },
  sacrifice:   { name: '희생의 메아리',  icon: '🕊️', desc: '아군이 처치될 때 군주 마나 +2 (기본 +1)', spell: true },
  spellAmp:    { name: '주문 증폭',      icon: '📡', desc: '모든 주문 효과 +20%', spell: true },
  quickCast:   { name: '신속 시전',      icon: '⏱️', desc: '주문 재사용 대기 시간 -30%', spell: true },
};
const AUG_KEYS = Object.keys(AUGMENTS);

/* ---------- AI 군주 명단 (12명 중 매 판 7명) ---------- */
// 성향: econ 경제, level 레벨, commit 집착도, reroll 리롤, spell 주문
const LORD_ROSTER = [
  { name: '사자왕 레오닉',     emoji: '🦁', type: 'war',    p: { econ: .2,  level: .8,  commit: .6, reroll: .1,  spell: .3 },  fav: ['vanguard', 'fire'],     style: '초반부터 몰아붙이는 군주' },
  { name: '독사 베리스',       emoji: '🐍', type: 'tactic', p: { econ: .3,  level: .15, commit: .8, reroll: .95, spell: .4 },  fav: ['wraith', 'assassin'],   style: '1코스트 3성만 노리는 군주' },
  { name: '현자 오르웬',       emoji: '🦉', type: 'tactic', p: { econ: .95, level: .7,  commit: .6, reroll: .1,  spell: .6 },  fav: ['star', 'mystic'],       style: '끝까지 버티다 후반에 폭발하는 군주' },
  { name: '곰 족장 브루노',    emoji: '🐻', type: 'guard',  p: { econ: .5,  level: .5,  commit: .7, reroll: .3,  spell: .3 },  fav: ['guardian', 'forest'],   style: '단단한 앞줄로 버티는 군주' },
  { name: '여우 책사 미레',    emoji: '🦊', type: 'tactic', p: { econ: .5,  level: .5,  commit: .3, reroll: .4,  spell: .95 }, fav: ['frost', 'mystic'],      style: '주문으로 판을 흔드는 군주' },
  { name: '늑대 여왕 카야',    emoji: '🐺', type: 'war',    p: { econ: .2,  level: .6,  commit: .5, reroll: .5,  spell: .5 },  fav: ['frost', 'assassin'],    style: '빠른 암살로 뒷줄을 노리는 군주' },
  { name: '용의 군주 드라칸',  emoji: '🐲', type: 'war',    p: { econ: .9,  level: .95, commit: .4, reroll: .1,  spell: .4 },  fav: ['fire', 'mystic'],       style: '고코스트 유닛으로 후반을 노리는 군주' },
  { name: '일각수 성녀 엘린',  emoji: '🦄', type: 'guard',  p: { econ: .6,  level: .5,  commit: .6, reroll: .3,  spell: .8 },  fav: ['healer', 'star'],       style: '치유와 주문으로 버티는 군주' },
  { name: '심해 군주 크라켄',  emoji: '🐙', type: 'guard',  p: { econ: .7,  level: .6,  commit: .5, reroll: .2,  spell: .5 },  fav: ['mech', 'guardian'],     style: '기계 보호막으로 밀어붙이는 군주' },
  { name: '전갈왕 시르',       emoji: '🦂', type: 'war',    p: { econ: .1,  level: .4,  commit: .7, reroll: .9,  spell: .3 },  fav: ['assassin', 'mech'],     style: '저코스트 리롤로 초반을 장악하는 군주' },
  { name: '공작 귀부인 루미아', emoji: '🦚', type: 'tactic', p: { econ: .8,  level: .8,  commit: .3, reroll: .2,  spell: .7 },  fav: ['star', 'sniper'],       style: '상점 흐름을 읽고 방향을 트는 군주' },
  { name: '늪지 마녀 고르바',  emoji: '🐸', type: 'guard',  p: { econ: .4,  level: .4,  commit: .9, reroll: .6,  spell: .6 },  fav: ['forest', 'healer'],     style: '한 방향을 끝까지 고집하는 군주' },
];

/* ---------- 중립 몬스터 라운드 ---------- */
// [유닛, 행, 열] — 몬스터 쪽 로컬 좌표(행 0 = 앞줄)
const MONSTER_WAVES = {
  1: [['m_slime', 0, 2], ['m_slime', 0, 4]],
  2: [['m_slime', 0, 1], ['m_slime', 0, 3], ['m_slime', 0, 5]],
  3: [['m_wolf', 0, 2], ['m_slime', 0, 4], ['m_wolf', 1, 3]],
  s2: [['m_wolf', 0, 1], ['m_wolf', 0, 3], ['m_wolf', 0, 5], ['m_wolf', 1, 3]],
  s3: [['m_rock', 0, 2], ['m_rock', 0, 4], ['m_wolf', 1, 1], ['m_wolf', 1, 5]],
  s4: [['m_raptor', 0, 2], ['m_raptor', 0, 4], ['m_raptor', 1, 3], ['m_wolf', 0, 0], ['m_wolf', 0, 6]],
  s5: [['m_wyvern', 1, 2], ['m_wyvern', 1, 4], ['m_raptor', 0, 3], ['m_rock', 0, 1], ['m_rock', 0, 5]],
  s6: [['m_elder', 1, 3], ['m_raptor', 0, 2], ['m_raptor', 0, 4]],
};

const DIFFICULTY = {
  easy:   { name: '쉬움',   noise: 0.6,  misplace: 0.35, castDelay: 2.5, counter: false },
  normal: { name: '보통',   noise: 0.25, misplace: 0.1,  castDelay: 0.8, counter: false },
  hard:   { name: '어려움', noise: 0,    misplace: 0,    castDelay: 0,   counter: true  },
};
