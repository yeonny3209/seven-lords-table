/* =====================================================================
 * 06. 게임 상태 — 공유 유닛 풀, 상점, 경제, 합성, 아이템, 주문, 라운드
 *     모든 상태는 G 하나에 모여 있고 JSON으로 그대로 저장된다.
 * ===================================================================== */

let G = null;
let MY_ID = 0; // 이 화면의 주인(플레이어 번호). 온라인 손님은 0이 아니다.
const HUMAN_EMOJIS = ['🧑‍✈️', '🧙', '🥷', '🧝', '🧛', '🧞', '🧜', '🦸'];
const DEFAULT_AI = () => ({ p: { econ: .5, level: .5, commit: .6, reroll: .3, spell: .5 }, fav: ['guardian', 'fire'], focus: ['guardian', 'fire'], style: '연결이 끊겨 AI가 대신 플레이하는 군주', rerollLevel: 5 });
const SAVE_KEY = 'sevenLordsTable.save.v1';

function newGame(opts) {
  const seed = opts.seed >>> 0 || ((Math.random() * 2 ** 31) | 0);
  const rng = new RNG(seed);
  G = {
    seed, rngS: 0, difficulty: opts.difficulty || 'normal',
    stage: 1, round: 1, phase: 'prep', uidN: 1, pool: {}, players: [],
    roundsPlayed: 0, log: [], lastOpp: {}, pendingSpellPick: false,
    battleSpeed: 1, instant: false, over: false,
  };
  for (const id in UNITS) G.pool[id] = POOL_SIZE[UNITS[id].cost];
  // 사람 플레이어 (혼자 하면 1명, 온라인이면 최대 8명)
  const humans = opts.humans || [{ name: '나', lordType: opts.lordType }];
  humans.forEach((h, i) => {
    const P = makePlayer(i, h.name, HUMAN_EMOJIS[i], h.lordType, true);
    P.ai = DEFAULT_AI(); // 연결이 끊기면 이 성향으로 AI가 이어받는다
    G.players.push(P);
  });
  // 남는 자리는 AI 군주 (12명 중 무작위), 성향 수치에 소폭 변동
  const roster = rng.shuffle(LORD_ROSTER.slice()).slice(0, 8 - humans.length);
  roster.forEach((L, i) => {
    const P = makePlayer(humans.length + i, L.name, L.emoji, L.type, false);
    const p = {};
    for (const k in L.p) p[k] = clamp(L.p[k] + rng.range(-0.12, 0.12), 0, 1);
    P.ai = { p, fav: L.fav.slice(), focus: L.fav.slice(), style: L.style, rerollLevel: rng.pick([4, 5, 6]) };
    G.players.push(P);
  });
  G.rngS = rng.s;
  // 시작 유닛 1개씩
  for (const P of G.players) {
    const ids = Object.keys(UNITS).filter(id => UNITS[id].cost === 1);
    const id = R().pick(ids);
    takeFromPool(id, 1);
    P.bench[0] = makeUnit(id, 1);
  }
  return G;
}

// 게임 난수: 상태를 G에 보관해 저장·재현 가능
function R() {
  const r = new RNG(G.rngS || G.seed);
  return {
    next() { const v = r.next(); G.rngS = r.s; return v; },
    int(n) { return Math.floor(this.next() * n); },
    range(a, b) { return a + this.next() * (b - a); },
    chance(p) { return this.next() < p; },
    pick(a) { return a[this.int(a.length)]; },
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    weighted(w) { let s = sum(w), x = this.next() * s; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; } return w.length - 1; },
  };
}

function makePlayer(id, name, emoji, lordType, isHuman) {
  return {
    id, name, emoji, lordType, isHuman, hp: CFG.START_HP, gold: 0, level: 1, xp: 0,
    board: [], bench: new Array(CFG.BENCH).fill(null), shop: new Array(CFG.SHOP_SIZE).fill(null),
    items: [], spells: LORD_TYPES[lordType].spells.map(s => ({ id: s, lvl: 1, rule: 'off' })),
    equipped: [0, 1], aug: [], streak: 0, alive: true, place: 0, freeRolls: 0, eggT: 0,
    lastResult: null, ai: null, history: [],
  };
}
function makeUnit(defId, star) { return { uid: G.uidN++, defId, star, items: [] }; }
const human = () => G.players[MY_ID];
const hasAug = (P, id) => P.aug.some(a => a.id === id);
function boardLimit(P) { return P.level + (hasAug(P, 'bigBoard') ? 1 : 0); }
function spellSlots(P) { return 2 + (P.level >= 7 ? 1 : 0) + (hasAug(P, 'spellSlot') ? 1 : 0); }
function xpCost(P) { return CFG.XP_COST + (hasAug(P, 'spellSlot') ? 1 : 0) - (hasAug(P, 'cheapXp') ? 1 : 0); }
function rerollCost(P) { return P.freeRolls > 0 ? 0 : hasAug(P, 'cheapRoll') ? 1 : CFG.REROLL_COST; }
function spellUpCost(P, s) { return Math.max(1, SPELLS[s.id].up[s.lvl - 1] - (hasAug(P, 'apprentice') ? 2 : 0)); }
function allUnits(P) { return [...P.board, ...P.bench.filter(Boolean)]; }
function stageBaseDamage(stage) { return [0, 0, 2, 3, 5, 8, 10, 12, 15, 18][Math.min(stage, 9)]; }

/* ---------- 유닛 풀 ---------- */
function takeFromPool(id, n) { G.pool[id] = Math.max(0, (G.pool[id] || 0) - n); }
function returnToPool(u) { if (UNITS[u.defId]) G.pool[u.defId] += 3 ** (u.star - 1); }

function rollShop(P) {
  const odds = SHOP_ODDS[P.level].slice();
  if (hasAug(P, 'highRoller')) { odds[1] += odds[0]; odds[0] = 0; }
  const r = R();
  P.shop.length = CFG.SHOP_SIZE;
  for (let i = 0; i < CFG.SHOP_SIZE; i++) {
    let id = null;
    for (let tries = 0; tries < 6 && !id; tries++) {
      const cost = r.weighted(odds) + 1;
      const ids = Object.keys(UNITS).filter(k => UNITS[k].cost === cost && G.pool[k] > 0);
      if (!ids.length) continue;
      id = ids[r.weighted(ids.map(k => G.pool[k]))];
    }
    P.shop[i] = id;
  }
}

/* ---------- 구매·판매·합성 ---------- */
function benchFree(P) { return P.bench.indexOf(null); }
function copiesOf(P, defId, star = 1) { return allUnits(P).filter(u => u.defId === defId && u.star === star).length; }

function buyUnit(P, slot) {
  const id = P.shop[slot];
  if (!id) return false;
  const cost = UNITS[id].cost;
  if (P.gold < cost || G.pool[id] <= 0) return false;
  const free = benchFree(P);
  if (free < 0 && copiesOf(P, id) < 2) return false;
  P.gold -= cost;
  takeFromPool(id, 1);
  P.shop[slot] = null;
  const u = makeUnit(id, 1);
  if (free >= 0) P.bench[free] = u;
  else P.bench.push(u); // 즉시 합성되어 사라질 임시 칸
  checkMerge(P);
  const extra = P.bench.slice(CFG.BENCH).filter(Boolean);
  P.bench = P.bench.slice(0, CFG.BENCH);
  for (const x of extra) { const f = benchFree(P); if (f >= 0) P.bench[f] = x; }
  return true;
}

function checkMerge(P) {
  for (let star = 1; star <= 2; star++) {
    let merged = true;
    while (merged) {
      merged = false;
      const groups = {};
      for (const u of allUnits(P)) if (u.star === star) (groups[u.defId] = groups[u.defId] || []).push(u);
      for (const id in groups) {
        const g = groups[id];
        if (g.length < 3) continue;
        // 보드 위의 유닛을 우선 남긴다
        g.sort((a, b) => (P.board.includes(b) ? 1 : 0) - (P.board.includes(a) ? 1 : 0));
        const keep = g[0], gone = g.slice(1, 3);
        const items = [...keep.items];
        for (const x of gone) {
          items.push(...x.items);
          removeUnit(P, x);
        }
        keep.star = star + 1;
        keep.items = [];
        for (const it of items) if (!equipItem(keep, it)) P.items.push(it);
        if (P.isHuman) toast(`${UNITS[id].emoji} ${UNITS[id].name} ${'★'.repeat(keep.star)} 합성!`, 'gold');
        merged = true;
        break;
      }
    }
  }
}
function removeUnit(P, u) {
  const bi = P.board.indexOf(u);
  if (bi >= 0) P.board.splice(bi, 1);
  const ci = P.bench.indexOf(u);
  if (ci >= 0) P.bench[ci] = null;
}
function sellPrice(u) { const c = UNITS[u.defId].cost; return u.star === 1 ? c : c * 3 ** (u.star - 1) - (c > 1 ? 1 : 0); }
function sellUnit(P, u) {
  removeUnit(P, u);
  P.gold += sellPrice(u) + (hasAug(P, 'broker') ? 1 : 0);
  P.items.push(...u.items);
  returnToPool(u);
}

function buyXp(P) {
  if (P.level >= 9 || P.gold < xpCost(P)) return false;
  P.gold -= xpCost(P);
  addXp(P, CFG.XP_AMOUNT);
  return true;
}
function addXp(P, n) {
  P.xp += n;
  while (P.level < 9 && P.xp >= XP_TABLE[P.level]) {
    P.xp -= XP_TABLE[P.level];
    P.level++;
    if (P.isHuman) toast(`레벨 ${P.level}! 보드 유닛 ${boardLimit(P)}명`, 'gold');
  }
  if (P.level >= 9) P.xp = 0;
}
function reroll(P) {
  const c = rerollCost(P);
  if (P.gold < c) return false;
  P.gold -= c;
  if (c === 0) P.freeRolls--;
  rollShop(P);
  return true;
}

/* ---------- 아이템 ---------- */
// 재료가 이미 있으면 합쳐서 완성 아이템이 된다. 유닛당 최대 3개.
function equipItem(u, it) {
  if (COMPONENTS[it]) {
    const ci = u.items.findIndex(x => COMPONENTS[x]);
    if (ci >= 0) { u.items[ci] = itemKey(u.items[ci], it); return true; }
  }
  if (u.items.length >= CFG.ITEM_MAX) return false;
  u.items.push(it);
  return true;
}

/* ---------- 주문 ---------- */
function equippedSpells(P) {
  return P.equipped.slice(0, spellSlots(P)).map(i => P.spells[i]).filter(Boolean);
}
function toggleEquip(P, idx) {
  const pos = P.equipped.indexOf(idx);
  if (pos >= 0) { P.equipped.splice(pos, 1); return true; }
  if (P.equipped.length >= spellSlots(P)) return false;
  if (SPELLS[P.spells[idx].id].once && P.equipped.some(i => SPELLS[P.spells[i].id].once)) {
    if (P.isHuman) toast('전투당 1회 주문은 1장만 가져갈 수 있습니다', 'bad');
    return false;
  }
  P.equipped.push(idx);
  return true;
}
function upgradeSpell(P, idx) {
  const s = P.spells[idx];
  if (!s || s.lvl >= 3) return false;
  const cost = spellUpCost(P, s);
  if (P.gold < cost) return false;
  P.gold -= cost;
  s.lvl++;
  return true;
}
function addSpell(P, id) {
  if (P.spells.some(s => s.id === id)) return false;
  P.spells.push({ id, lvl: 1, rule: 'off' });
  const idx = P.spells.length - 1;
  if (P.equipped.length < spellSlots(P)) toggleEquip(P, idx);
  return true;
}
function spellOffers(P, n) {
  const pool = SPELL_KEYS.filter(id => !P.spells.some(s => s.id === id));
  return R().shuffle(pool).slice(0, n);
}

/* ---------- 증강 ---------- */
function augmentOffers(P) {
  const r = R();
  const keys = r.shuffle(AUG_KEYS.filter(k => !hasAug(P, k) || k === 'emblem')).slice(0, 3);
  return keys.map(id => {
    const o = { id };
    if (AUGMENTS[id].param === 'trait') {
      const counts = computeTraits(allUnits(P), []);
      const owned = TRAIT_KEYS.filter(t => counts[t]);
      o.param = owned.length ? r.pick(owned) : r.pick(TRAIT_KEYS);
    }
    return o;
  });
}
function augName(a) { return AUGMENTS[a.id].name + (a.param ? ` (${TRAITS[a.param].name})` : ''); }
function augDesc(a) { return AUGMENTS[a.id].desc.replace('{trait}', a.param ? TRAITS[a.param].name : ''); }
function applyAugment(P, a) {
  P.aug.push(a);
  const r = R();
  switch (a.id) {
    case 'loot': for (let i = 0; i < 2; i++) P.items.push(r.pick(COMP_KEYS)); break;
    case 'cash': P.gold += 15; break;
    case 'heartyHP': P.hp += 20; break;
    case 'spellHone': for (const s of P.spells) s.lvl = Math.min(3, s.lvl + 1); break;
    case 'library': for (const id of spellOffers(P, 2)) addSpell(P, id); break;
    case 'hire': for (let i = 0; i < 2; i++) grantRandomUnit(P, 3, 1); break;
    case 'treasure': P.gold += 30; P.hp -= 10; break;
    case 'goldenEgg': P.eggT = 4; break;
    case 'xpBoost': if (P.level < 9) addXp(P, XP_TABLE[P.level] - P.xp); break;
    case 'itemSmith': P.items.push(itemKey(r.pick(COMP_KEYS), r.pick(COMP_KEYS))); break;
    case 'tripleContract': {
      const ids = Object.keys(UNITS).filter(k => UNITS[k].cost === 1 && G.pool[k] >= 3);
      if (ids.length) { const id = r.pick(ids); takeFromPool(id, 3); placeNewUnit(P, makeUnit(id, 2)); }
      break;
    }
    case 'legendCall': grantRandomUnit(P, 4, 1); break;
    case 'freeSpell':
      if (P.isHuman) P.pendingSpell = true;
      else { const ids = spellOffers(P, 3); if (ids.length) addSpell(P, aiPickSpell(P, ids)); }
      break;
  }
}
// 대기석에 빈 칸이 없으면 유닛을 풀로 돌려보내고 그 가치를 골드로 준다
function placeNewUnit(P, u) {
  const f = benchFree(P);
  if (f >= 0) { P.bench[f] = u; checkMerge(P); return true; }
  returnToPool(u);
  P.gold += sellPrice(u);
  return false;
}
function grantRandomUnit(P, cost, star) {
  const ids = Object.keys(UNITS).filter(k => UNITS[k].cost === cost && G.pool[k] > 0);
  if (!ids.length) return;
  const id = R().pick(ids);
  takeFromPool(id, 1);
  placeNewUnit(P, makeUnit(id, star));
}

/* ---------- 라운드 구성 ---------- */
// 1단계: 몬스터 3라운드. 2단계부터: 대전, 대전, 대전, 공용 선택, 대전, 대전, 몬스터
function roundType(stage, round) {
  if (stage === 1) return 'pve';
  return ['pvp', 'pvp', 'pvp', 'carousel', 'pvp', 'pvp', 'pve'][round - 1];
}
function roundsInStage(stage) { return stage === 1 ? 3 : 7; }
function roundLabel() { return `${G.stage}-${G.round}`; }
function advanceRound() {
  G.round++;
  if (G.round > roundsInStage(G.stage)) { G.stage++; G.round = 1; }
  G.roundsPlayed++;
}
function augmentDue() { return G.round === 1 && G.stage >= 2 && G.stage <= 4; }

function interest(P) { return Math.min(Math.floor(P.gold / 10), hasAug(P, 'bigInterest') ? 7 : CFG.MAX_INTEREST); }
function streakBonus(P) {
  const s = Math.abs(P.streak);
  const b = s >= 6 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0;
  return b ? b + (hasAug(P, 'streakPlus') ? 1 : 0) : 0;
}
// 준비 단계 시작: 수입, 경험치, 상점
function startPrep() {
  for (const P of G.players) {
    if (!P.alive) continue;
    const inc = CFG.BASE_INCOME + interest(P) + streakBonus(P) + (hasAug(P, 'income') ? 1 : 0)
      + (hasAug(P, 'patience') && P.streak < 0 ? 2 : 0);
    P.gold += inc;
    P.lastIncome = inc;
    if (G.roundsPlayed > 0) addXp(P, 2 + (hasAug(P, 'scholar') ? 2 : 0));
    P.freeRolls = (hasAug(P, 'freeRoll') ? 1 : 0) + (hasAug(P, 'rerollMaster') ? 2 : 0);
    if (P.eggT > 0 && --P.eggT === 0) { P.gold += 35; if (P.isHuman) toast('🥚 황금알 부화! +35골드', 'gold'); }
    if (hasAug(P, 'supply') && G.roundsPlayed % 2 === 0) P.items.push(R().pick(COMP_KEYS));
    rollShop(P);
  }
}

/* ---------- 전투 명세 ---------- */
function specOf(P, opts = {}) {
  const diff = DIFFICULTY[G.difficulty];
  return {
    name: P.name, emoji: P.emoji, isPlayer: P.isHuman,
    units: P.board.map(u => ({ defId: u.defId, star: u.star, items: u.items, r: u.r, c: u.c })),
    traits: computeTraits(P.board, P.aug), aug: P.aug, lordType: P.lordType,
    spells: equippedSpells(P).map(s => ({ id: s.id, lvl: s.lvl, rule: s.rule })),
    ai: P.isHuman ? null : { tend: P.ai.p.spell, castDelay: diff.castDelay, mult: G.difficulty === 'hard' ? 1 : CFG.AUTO_CAST_MULT },
    forceAuto: !!opts.forceAuto,
  };
}
function monsterSpec() {
  const key = G.stage === 1 ? G.round : 's' + Math.min(G.stage, 6);
  const scale = G.stage <= 2 ? 1 : 1 + (G.stage - 2) * 0.18;
  return {
    name: '중립 몬스터', emoji: '👾', isPlayer: false, units: MONSTER_WAVES[key].map(([defId, r, c]) => ({ defId, star: 1, items: [], r, c })),
    traits: {}, aug: [], lordType: null, spells: [], ai: null, monsterScale: scale,
  };
}

/* ---------- 매칭 ---------- */
function makePairs() {
  const alive = G.players.filter(P => P.alive);
  const r = R();
  let best = null;
  for (let t = 0; t < 12; t++) {
    const arr = r.shuffle(alive.slice());
    const pairs = [];
    for (let i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
    const repeats = pairs.filter(([a, b]) => G.lastOpp[a.id] === b.id).length;
    const odd = arr.length % 2 ? arr[arr.length - 1] : null;
    if (!best || repeats < best.repeats) best = { pairs, odd, repeats };
    if (!repeats) break;
  }
  // 홀수면 마지막 군주는 다른 군주의 '유령 복제'와 싸운다 (복제 쪽은 피해 없음)
  if (best.odd) {
    const ghost = r.pick(alive.filter(P => P !== best.odd));
    best.pairs.push([best.odd, ghost, true]);
  }
  for (const [a, b, g] of best.pairs) { G.lastOpp[a.id] = b.id; if (!g) G.lastOpp[b.id] = a.id; }
  return best.pairs;
}

/* ---------- 전투 결과 적용 ---------- */
function survivorDamage(list) { return sum(list.map(s => s.star + (s.cost >= 4 ? 1 : 0))); }
function applyResult(P, won, dmg, pvp, oppName) {
  if (won) {
    if (pvp) P.streak = P.streak > 0 ? P.streak + 1 : 1;
    if (pvp && hasAug(P, 'victoryGold')) P.gold += 2;
  } else {
    if (pvp) P.streak = P.streak < 0 ? P.streak - 1 : -1;
    if (hasAug(P, 'ironWill')) dmg = Math.max(1, Math.round(dmg * 0.75));
    P.hp -= dmg;
  }
  P.lastResult = { won, dmg: won ? 0 : dmg, opp: oppName };
  P.history.push(won ? 'W' : 'L');
}
function processEliminations() {
  const dead = G.players.filter(P => P.alive && P.hp <= 0).sort((a, b) => a.hp - b.hp);
  const out = [];
  for (const P of dead) {
    const aliveCount = G.players.filter(x => x.alive).length;
    P.alive = false;
    P.place = aliveCount;
    for (const u of allUnits(P)) returnToPool(u);
    P.board = []; P.bench = new Array(CFG.BENCH).fill(null);
    out.push(P);
  }
  const alive = G.players.filter(P => P.alive);
  if (alive.length === 1) alive[0].place = 1;
  return out;
}

/* ---------- 저장 ---------- */
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) { /* 저장 불가 환경 */ }
}
function loadGame() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    return JSON.parse(s);
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } }
