/* =====================================================================
 * 07. AI 군주 — 성향 파라미터(경제·레벨·집착·리롤·주문)에 따른 준비 단계
 * ===================================================================== */

function desiredLevel(P) {
  const p = P.ai.p;
  const base = [0, 3, 5, 6, 7, 8, 9, 9, 9][Math.min(G.stage, 8)];
  let d = base + (p.level > 0.7 ? 1 : 0) - (p.level < 0.3 ? 1 : 0);
  if (p.reroll > 0.7 && G.stage < 5) d = Math.min(d, P.ai.rerollLevel);
  if (G.stage === 2 && G.round <= 2) d = Math.min(d, 4);
  return clamp(d, 1, 9);
}

function aiReserve(P) {
  const p = P.ai.p;
  if (G.stage <= 1) return 0;
  let reserve = Math.round(p.econ * (G.stage === 2 ? 30 : 50));
  if (P.hp <= 40) reserve = Math.min(reserve, 20);
  if (P.hp <= 25) reserve = 0;
  return reserve;
}

function aiUnitScore(P, id) {
  const d = UNITS[id];
  const diff = DIFFICULTY[G.difficulty];
  const counts = computeTraits(P.board, P.aug);
  const c1 = copiesOf(P, id, 1), c2 = copiesOf(P, id, 2);
  let s = c1 * 3 + (c1 === 2 ? 4 : 0) + c2 * 2;
  for (const t of d.traits) {
    if (P.ai.focus.includes(t)) s += 2.5 + 3 * P.ai.p.commit;
    if (counts[t]) s += 1;
  }
  s += d.cost * (0.6 + 0.25 * G.stage);
  if (P.ai.p.reroll > 0.6 && d.cost <= 2) s += 2;
  s += (R().next() - 0.5) * diff.noise * 8;
  return s;
}

function unitPower(u) {
  return UNITS[u.defId].cost * [0, 1, 2.6, 6][u.star] * 3 + u.items.length * 2.5;
}

function aiSellWorst(P, againstScore) {
  let worst = null, wv = 1e9;
  for (const u of P.bench) if (u) { const v = unitPower(u) + copiesOf(P, u.defId, u.star) * 2; if (v < wv) { wv = v; worst = u; } }
  if (worst && wv < againstScore) { sellUnit(P, worst); return true; }
  return false;
}

function aiBuyFromShop(P, reserve) {
  const total = allUnits(P).length;
  const threshold = total < boardLimit(P) + 2 ? -99 : 5 + G.stage * 0.8;
  const order = P.shop.map((id, i) => ({ id, i, s: id ? aiUnitScore(P, id) : -99 })).sort((a, b) => b.s - a.s);
  for (const o of order) {
    if (!o.id || o.s < threshold) continue;
    const cost = UNITS[o.id].cost;
    const merges = copiesOf(P, o.id) >= 2;
    if (P.gold < cost || (P.gold - cost < reserve && !merges)) continue;
    if (benchFree(P) < 0 && !merges && !aiSellWorst(P, o.s)) continue;
    buyUnit(P, o.i);
  }
}

function aiPrep(P) {
  const p = P.ai.p, r = R();
  // 집착도가 낮으면 가진 유닛에 맞춰 방향을 바꾼다
  if (G.stage >= 3 && r.chance((1 - p.commit) * 0.35)) {
    const counts = computeTraits(allUnits(P), P.aug);
    const top = TRAIT_KEYS.filter(t => counts[t]).sort((a, b) => counts[b] - counts[a]).slice(0, 2);
    if (top.length === 2) P.ai.focus = top;
  }
  const reserve = aiReserve(P);
  // 주문 강화
  if (G.stage >= 2) for (const i of P.equipped) {
    const s = P.spells[i];
    if (!s || s.lvl >= 3) continue;
    const c = spellUpCost(P, s);
    if (P.gold - c >= reserve && r.chance(p.spell * 0.6)) upgradeSpell(P, i);
  }
  // 레벨
  const want = desiredLevel(P);
  while (P.level < want && P.gold - xpCost(P) >= reserve) buyXp(P);
  // 구매
  aiBuyFromShop(P, reserve);
  // 리롤
  const rerollMode = p.reroll > 0.6 && P.level >= P.ai.rerollLevel && G.stage >= 3;
  const desperate = P.hp <= 30 && G.stage >= 3;
  const rich = P.level >= 8 && P.gold > 55;
  const floor = desperate ? 0 : rerollMode ? 12 : 50;
  let guard = 0;
  while ((rerollMode || desperate || rich) && P.gold - rerollCost(P) >= floor && guard++ < 25) {
    reroll(P);
    aiBuyFromShop(P, floor);
  }
  aiArrange(P);
  aiItems(P);
  aiSpells(P);
}

/* ---------- 배치 ---------- */
// perfect: 사람 플레이어의 자동 배치용 (배치 실수 없음, 시너지 방향은 가진 유닛에서 계산)
function aiArrange(P, perfect) {
  const diff = DIFFICULTY[G.difficulty], r = R();
  const focus = P.ai && P.ai.focus ? P.ai.focus : (() => {
    const c = computeTraits(allUnits(P), P.aug);
    return TRAIT_KEYS.filter(t => c[t]).sort((a, b) => c[b] - c[a]).slice(0, 2);
  })();
  const units = allUnits(P);
  const limit = boardLimit(P);
  const chosen = [], seen = new Set(), counts = {};
  const pool = units.slice();
  while (chosen.length < limit && pool.length) {
    let bi = 0, bv = -1e9;
    pool.forEach((u, i) => {
      let v = unitPower(u);
      if (!seen.has(u.defId)) for (const t of UNITS[u.defId].traits) {
        const n = (counts[t] || 0) + 1;
        if (TRAITS[t].tiers.includes(n)) v += 6 * (TRAITS[t].tiers.indexOf(n) + 1);
        else v += focus.includes(t) ? 1.5 : 0.5;
      }
      if (v > bv) { bv = v; bi = i; }
    });
    const u = pool.splice(bi, 1)[0];
    if (!seen.has(u.defId)) { seen.add(u.defId); for (const t of UNITS[u.defId].traits) counts[t] = (counts[t] || 0) + 1; }
    chosen.push(u);
  }
  // 보드 ↔ 대기석 재배치
  P.board = [];
  P.bench = new Array(CFG.BENCH).fill(null);
  pool.slice(0, CFG.BENCH).forEach((u, i) => { P.bench[i] = u; });
  for (const u of pool.slice(CFG.BENCH)) sellUnit(P, u);
  placeFormation(P, chosen);
  // 쉬움: 배치 실수
  if (!perfect) for (const u of P.board) if (r.chance(diff.misplace)) {
    const free = [];
    for (let rr = 0; rr < CFG.ROWS; rr++) for (let cc = 0; cc < CFG.COLS; cc++) if (!P.board.some(x => x.r === rr && x.c === cc)) free.push([rr, cc]);
    if (free.length) [u.r, u.c] = r.pick(free);
  }
}

function placeFormation(P, list) {
  const taken = new Set();
  const put = (u, cells) => {
    for (const [r, c] of cells) if (!taken.has(r * 10 + c)) { taken.add(r * 10 + c); u.r = r; u.c = c; P.board.push(u); return; }
  };
  const frontCells = [3, 2, 4, 1, 5, 0, 6].map(c => [0, c]).concat([3, 2, 4, 1, 5, 0, 6].map(c => [1, c]));
  const flankCells = [[1, 0], [1, 6], [0, 0], [0, 6], [1, 1], [1, 5], [2, 0], [2, 6]];
  const backCells = [0, 6, 1, 5, 2, 4, 3].map(c => [3, c]).concat([0, 6, 1, 5, 2, 4, 3].map(c => [2, c]));
  const all = [...frontCells, ...backCells];
  // 어려움: 플레이어가 돌격대로 뒷줄을 노리면 수호자 하나를 뒷줄에 세운다
  const H = G ? human() : null;
  const counter = H && P !== H && DIFFICULTY[G.difficulty].counter && H.alive && traitTier('vanguard', computeTraits(H.board, H.aug).vanguard || 0) >= 1;
  const role = u => UNITS[u.defId].roles[0];
  const sorted = list.slice().sort((a, b) => unitPower(b) - unitPower(a));
  let backGuard = counter ? sorted.filter(u => role(u) === 'guardian')[1] : null;
  for (const u of sorted) {
    const ro = role(u);
    if (u === backGuard) put(u, [[3, 3], [3, 2], [3, 4], ...all]);
    else if (ro === 'guardian' || ro === 'vanguard') put(u, [...frontCells, ...all]);
    else if (ro === 'assassin') put(u, [...flankCells, ...all]);
    else put(u, [...backCells, ...all]);
  }
}

/* ---------- 아이템: 핵심 딜러에게 몰아준다 ---------- */
const CARRY_COMPS = ['sword', 'bow', 'rod', 'glove', 'tear'];
function aiItems(P) {
  if (!P.items.length || !P.board.length) return;
  const isTankRole = u => ['guardian', 'vanguard'].includes(UNITS[u.defId].roles[0]);
  const carry = P.board.filter(u => !isTankRole(u)).sort((a, b) => unitPower(b) - unitPower(a))[0] || P.board[0];
  const tank = P.board.filter(isTankRole).sort((a, b) => unitPower(b) - unitPower(a))[0] || carry;
  const keep = [];
  // 완성 아이템
  for (const it of P.items.filter(x => !COMPONENTS[x])) {
    const st = itemInfo(it).stats;
    const tanky = (st.armor || 0) + (st.mr || 0) + (st.hp || 0) / 6 > (st.atk || 0) + (st.ap || 0) + (st.as || 0) * 100 + (st.crit || 0) * 100;
    const target = tanky ? tank : carry;
    if (!equipItem(target, it) && !equipItem(tanky ? carry : tank, it)) keep.push(it);
  }
  // 재료: 두 개씩 묶어서 장착
  let comps = P.items.filter(x => COMPONENTS[x]);
  comps.sort((a, b) => CARRY_COMPS.includes(b) - CARRY_COMPS.includes(a));
  while (comps.length >= 2 || (comps.length === 1 && G.stage >= 4)) {
    const a = comps.shift();
    const forCarry = CARRY_COMPS.includes(a);
    const target = [forCarry ? carry : tank, forCarry ? tank : carry].find(u => u.items.length < CFG.ITEM_MAX || u.items.some(x => COMPONENTS[x]));
    if (!target) { keep.push(a, ...comps); comps = []; break; }
    equipItem(target, a);
    if (comps.length) {
      const prefIdx = comps.findIndex(x => CARRY_COMPS.includes(x) === forCarry);
      const b = comps.splice(prefIdx >= 0 ? prefIdx : 0, 1)[0];
      if (!equipItem(target, b)) keep.push(b);
    }
  }
  P.items = keep.concat(comps);
}

/* ---------- 주문 선택 ---------- */
function aiSpellScore(P, s) {
  const sp = SPELLS[s.id];
  const pref = { war: 'atk', guard: 'def', tactic: 'ctl' }[P.lordType];
  let v = s.lvl * 2 + (sp.kind === pref ? 2 : 0) + sp.cost * P.ai.p.spell * 0.4;
  if (DIFFICULTY[G.difficulty].counter) {
    const H = computeTraits(human().board, human().aug);
    const dive = (H.assassin || 0) + (H.vanguard || 0), ranged = (H.sniper || 0) + (H.mystic || 0);
    if (dive >= 3 && ['taunt', 'shield', 'resolve', 'swap'].includes(s.id)) v += 3;
    if (ranged >= 3 && ['bolt', 'sunder', 'timestop', 'reap'].includes(s.id)) v += 3;
  }
  return v;
}
function aiSpells(P) {
  const order = P.spells.map((s, i) => ({ i, v: aiSpellScore(P, s) })).sort((a, b) => b.v - a.v);
  P.equipped = [];
  for (const o of order) { if (P.equipped.length >= spellSlots(P)) break; toggleEquip(P, o.i); }
}

/* ---------- 공용 선택 · 증강 · 주문 보상 ---------- */
function aiCarouselPick(P, options) {
  let bi = 0, bv = -1e9;
  options.forEach((o, i) => {
    if (o.taken) return;
    const v = o.kind === 'unit' ? aiUnitScore(P, o.defId) + 3 : (P.spells.some(s => s.id === o.id) ? -50 : 3 + P.ai.p.spell * 9);
    if (v > bv) { bv = v; bi = i; }
  });
  return bi;
}
function aiPickAugment(P, offers) {
  const p = P.ai.p, r = R();
  const w = offers.map(a => {
    if (AUGMENTS[a.id].spell) return 1 + p.spell * 3;
    if (AUGMENTS[a.id].econ || ['income', 'bigInterest', 'cash'].includes(a.id)) return 1 + p.econ * 3;
    if (AUGMENTS[a.id].reroll) return 1 + p.reroll * 3;
    if (a.id === 'emblem') return 1 + p.commit * 2;
    return 1.6;
  });
  return offers[r.weighted(w)];
}
function aiPickSpell(P, ids) {
  return ids.slice().sort((a, b) => aiSpellScore(P, { id: b, lvl: 1 }) - aiSpellScore(P, { id: a, lvl: 1 }))[0];
}
