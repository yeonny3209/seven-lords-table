/* =====================================================================
 * 03. 전투 엔진 (1/2) — 준비, 능력치 계산, 피해·회복 같은 효과 기본 단위
 *     화면 그리기와 완전히 분리되어 있어 플레이어 전투(애니메이션)와
 *     AI끼리의 전투(화면 없이)를 같은 코드로 돌린다.
 * ===================================================================== */

const GROWS = 8, GCOLS = 7;
// side 0 = 아래쪽(행 4~7), side 1 = 위쪽(행 0~3). 로컬 행 0이 앞줄.
function toGlobal(side, r, c) { return side === 0 ? [4 + r, c] : [3 - r, 6 - c]; }

/*
 * 진영 명세(spec):
 * { name, emoji, isPlayer, units:[{defId,star,items,r,c}], traits:{}, aug:[{id,param}],
 *   lordType, spells:[{id,lvl,rule}], ai:{tend,castDelay,mult}|null, forceAuto, monsterScale }
 */
function createBattle(specA, specB, seed, opts = {}) {
  const B = {
    tick: 0, maxTick: Math.round(CFG.BATTLE_TIME / CFG.TICK),
    rng: new RNG(seed), units: [], zones: [], ev: [], queue: [], log: [],
    occ: Array.from({ length: GROWS }, () => new Array(GCOLS).fill(0)),
    headless: !!opts.headless, over: false, result: null, uidN: 1,
    amp: 1, // 연장전 피해 배율
  };
  B.sides = [makeSideState(specA, 0), makeSideState(specB, 1)];
  for (const S of B.sides) {
    for (const s of S.spec.units) {
      const [gr, gc] = toGlobal(S.idx, s.r, s.c);
      if (B.occ[gr][gc]) continue;
      spawnUnit(B, S.idx, s.defId, s.star, s.items || [], gr, gc, s.r, S.spec.monsterScale || 1);
    }
  }
  startEffects(B);
  return B;
}

function makeSideState(spec, idx) {
  const aug = new Set((spec.aug || []).map(a => a.id));
  const tiers = {};
  for (const t of TRAIT_KEYS) tiers[t] = traitTier(t, (spec.traits || {})[t] || 0);
  const S = {
    idx, spec, name: spec.name, emoji: spec.emoji, isPlayer: !!spec.isPlayer, tiers, aug,
    lordType: spec.lordType, lm: aug.has('manaHead') ? 3 : 0,
    lmMax: aug.has('manaVault') ? 14 : CFG.LORD_MANA_MAX,
    lmRegen: (tiers.star === 3 ? 1.6 : 1) * (aug.has('manaSpring') ? 1.3 : 1),
    healAmp: (1 + [0, 0.25, 0.5, 0.9][tiers.healer]) * (aug.has('mercy') ? 1.25 : 1),
    phoenixUsed: false, lastStandDone: false,
    spellDmgMult: 1 + (spec.lordType === 'war' ? 0.15 : 0) + [0, 0, 0.15, 0.3][tiers.mystic],
    spellMult: aug.has('spellAmp') ? 1.2 : 1,
    spells: (spec.spells || []).map(s => ({ id: s.id, lvl: s.lvl, rule: s.rule || 'off', cd: 0, used: false })),
    castCount: 0, forceAuto: !!spec.forceAuto, ai: spec.ai || null, aiWait: 0, aiArmed: false,
    stats: { spellDmg: 0, spellHeal: 0, spellShield: 0, casts: 0 },
  };
  return S;
}

function spawnUnit(B, side, defId, star, items, gr, gc, localRow, scale = 1) {
  const d = unitDef(defId);
  const S = B.sides[side];
  const m = CFG.STAR_MULT[star] || 1;
  const u = {
    uid: B.uidN++, side, defId, d, star, items: items.slice(), r: gr, c: gc, fr: gr, fc: gc,
    maxHp: d.hp * m * scale, atk: d.atk * m * scale, as: d.as, asBonus: 0, range: d.range,
    armor: d.armor, mr: d.mr, ap: 0, crit: d.crit, critDmg: 1.5, manaMax: d.mana, mana: d.startMana,
    dmgAmp: 0, lifesteal: 0, regen: 0, fx: new Set(), traits: d.traits || [],
    alive: true, ghost: 0, ghostT: 0, ghostMult: 0, reviving: 0, revive: false,
    stun: 0, freeze: 0, undying: 0, taunt: 0, sunder: null, burn: null,
    slows: [], buffs: [], shields: [],
    target: null, atkCd: 0.25 + B.rng.next() * 0.35, moveCd: 0, moveDur: CFG.MOVE_TIME, retargetT: 0,
    atkCount: 0, asStacks: 0, fireBurn: 0, frostSlow: 0, distAmp: 0, leap: false, leapStun: false,
    thornDmg: 0, spellVamp: 0, manaPerAtk: 0, armorPen: 0, mrPen: 0, giantAmp: 0, execAmp: 0,
    burnHitDps: 0, asRamp: false, startShield: 0, reviveHp: 400,
    dmgDone: 0, dmgTaken: 0, healDone: 0, summon: !!d.summon, monster: defId.startsWith('m_'),
  };
  // 아이템
  for (const it of u.items) {
    const info = itemInfo(it);
    const st = info.stats;
    u.atk += st.atk || 0; u.asBonus += st.as || 0; u.armor += st.armor || 0; u.mr += st.mr || 0;
    u.ap += st.ap || 0; u.mana += st.mana || 0; u.maxHp += st.hp || 0; u.crit += st.crit || 0;
    if (info.fx) u.fx.add(info.fx);
  }
  if (u.fx.has('critDmg')) u.critDmg += 0.4;
  if (u.fx.has('bigAp')) u.ap += 40;
  if (u.fx.has('lifesteal')) u.lifesteal += 0.25;
  if (u.fx.has('dmgAmp')) u.dmgAmp += 0.15;
  if (u.fx.has('regen')) u.regen += 0.03;
  if (u.fx.has('revive')) u.revive = true;
  if (u.fx.has('thorns')) u.thornDmg += 25;
  if (u.fx.has('spellVamp')) u.spellVamp += 0.2;
  if (u.fx.has('manaHit')) u.manaPerAtk += 6;
  if (u.fx.has('burnHit')) u.burnHitDps = 20;
  applyTraitBonuses(S, u);
  // 증강
  const A = S.aug;
  if (A.has('frontline') && localRow === 0) u.maxHp *= 1.2;
  if (A.has('backline') && localRow >= 2) u.atk *= 1.15;
  if (A.has('critAll')) u.crit += 0.15;
  if (A.has('armorAll')) { u.armor += 20; u.mr += 20; }
  if (A.has('apAll')) u.ap += 20;
  if (A.has('regenAll')) u.regen += 0.015;
  if (A.has('manaStart')) u.mana += 20;
  if (A.has('swift')) u.asBonus += 0.15;
  if (A.has('giant')) u.maxHp *= 1.12;
  if (A.has('lifesteal')) u.lifesteal += 0.10;
  // 확장 증강
  const cost = d.cost || 0;
  if (A.has('commonPower') && cost >= 1 && cost <= 2) { u.maxHp *= 1.2; u.atk *= 1.2; }
  if (A.has('nobleBlood') && cost >= 4) u.ap += 30;
  if (A.has('eliteFew') && S.spec.units.length <= 5) { u.maxHp *= 1.25; u.atk *= 1.25; }
  if (A.has('precision')) u.critDmg += 0.35;
  if (A.has('thornsAll')) u.thornDmg += 12;
  if (A.has('spellVampAll')) u.spellVamp += 0.15;
  if (A.has('manaFlow')) u.manaPerAtk += 3;
  if (A.has('armorPierce')) u.armorPen = 0.35;
  if (A.has('magicPierce')) u.mrPen = 0.35;
  if (A.has('giantSlayer')) u.giantAmp = 0.25;
  if (A.has('executioner')) u.execAmp = 0.25;
  if (A.has('arsonist')) u.burnHitDps = Math.max(u.burnHitDps, 12);
  if (A.has('accelerate')) u.asRamp = true;
  if (A.has('tankShield') && localRow === 0) u.startShield += 300;
  if (A.has('backShield') && localRow >= 2) u.startShield += 220;
  if (A.has('phalanx') && gc >= 2 && gc <= 4) { u.armor += 25; u.mr += 25; }
  if (A.has('flanking') && (gc <= 1 || gc >= 5)) u.asBonus += 0.2;
  if (A.has('legion')) { u.ghostT = Math.max(u.ghostT, 2); u.ghostMult = Math.max(u.ghostMult, 0.5); }
  u.hp = u.maxHp;
  u.crit = Math.min(u.crit, 1);
  B.units.push(u);
  B.occ[gr][gc] = u.uid;
  return u;
}

function applyTraitBonuses(S, u) {
  const T = S.tiers;
  const has = t => u.traits.includes(t);
  const origin = t => T[t] === 3 || (T[t] > 0 && has(t)); // 6단계는 모든 아군
  if (origin('fire')) u.fireBurn = [0, 15, 35, 70][T.fire];
  if (origin('frost')) u.frostSlow = [0, 0.15, 0.25, 0.40][T.frost];
  if (origin('forest')) u.regen += [0, 0.02, 0.035, 0.06][T.forest];
  if (origin('wraith')) { u.ghostT = [0, 2, 3, 5][T.wraith]; u.ghostMult = [0, 0.5, 0.7, 1][T.wraith]; }
  if (origin('mech')) u.mechShield = [0, 180, 380, 750][T.mech];
  if (origin('star')) u.manaMax = Math.round(u.manaMax * (1 - [0, 0.15, 0.25, 0.35][T.star]));
  if (T.guardian) {
    const b = has('guardian') ? [0, 20, 40, 70][T.guardian] : [0, 0, 10, 25][T.guardian];
    u.armor += b; u.mr += b;
  }
  if (T.vanguard && has('vanguard')) {
    u.leap = true; u.atk *= 1 + [0, 0.15, 0.30, 0.55][T.vanguard]; u.leapStun = T.vanguard === 3;
  }
  if (T.sniper && has('sniper')) { u.range += T.sniper === 3 ? 2 : 1; u.distAmp = [0, 0.05, 0.08, 0.12][T.sniper]; }
  if (T.mystic && has('mystic')) u.ap += [0, 20, 45, 80][T.mystic];
  if (T.assassin && has('assassin')) { u.crit += [0, 0.15, 0.30, 0.45][T.assassin]; u.critDmg += [0, 0.25, 0.45, 0.7][T.assassin]; }
}

function startEffects(B) {
  // 증원군: 자기 진영 앞쪽 빈 칸에 강철 병사 소환
  for (const S of B.sides) if (S.aug.has('reinforce')) {
    for (let i = 0; i < 2; i++) {
      const free = [];
      for (let r = 0; r < CFG.ROWS; r++) for (let c = 0; c < CFG.COLS; c++) {
        const [gr, gc] = toGlobal(S.idx, r, c);
        if (!B.occ[gr][gc]) free.push([gr, gc, r]);
      }
      if (!free.length) break;
      free.sort((a, b) => a[2] - b[2] || Math.abs(a[1] - 3) - Math.abs(b[1] - 3));
      const [gr, gc] = free[0];
      spawnUnit(B, S.idx, 'militia', 1, [], gr, gc, 0);
    }
  }
  for (const u of B.units) {
    if (u.mechShield) addShield(B, u, u.mechShield, 999, null);
    if (u.startShield) addShield(B, u, u.startShield, 999, null);
    if (u.fx.has('locket')) for (const a of alliesOf(B, u.side)) if (cheb(a.r, a.c, u.r, u.c) <= 1) addShield(B, a, 200, 8, null);
  }
  for (const S of B.sides) {
    const mine = alliesOf(B, S.idx);
    if (S.aug.has('firstStrike')) for (const u of mine) addBuff(u, 'as', 0.4, 4);
    if (S.aug.has('oath') && mine.length) {
      const tank = mine.reduce((a, b) => (b.maxHp > a.maxHp ? b : a));
      tank.taunt = 4; addBuff(tank, 'armor', 30, 4);
    }
    if (S.aug.has('stunStart')) for (const e of B.rng.shuffle(enemiesOf(B, S.idx)).slice(0, 2)) applyStun(B, e, 1.5);
    if (S.aug.has('ambush')) for (const u of mine) if (u.traits.includes('assassin')) u.leap = true;
  }
  for (const u of B.units) if (u.leap) {
    const far = farthestFrom(B, u, enemiesOf(B, u.side));
    if (far) {
      leapNear(B, u, far);
      if (u.leapStun) for (const e of enemiesOf(B, u.side)) if (cheb(e.r, e.c, u.r, u.c) <= 1) applyStun(B, e, 1);
    }
  }
}

/* ---------- 조회 도구 ---------- */
const targetable = u => u.alive && u.reviving <= 0;
function alliesOf(B, side) { return B.units.filter(u => u.side === side && targetable(u)); }
function enemiesOf(B, side) { return B.units.filter(u => u.side !== side && targetable(u)); }
function unitByUid(B, uid) { return B.units.find(u => u.uid === uid); }
function farthestFrom(B, u, list) {
  let best = null, bd = -1;
  for (const e of list) { const d = cheb(u.r, u.c, e.r, e.c) * 10 + Math.abs(u.c - e.c); if (d > bd) { bd = d; best = e; } }
  return best;
}
function nearestTo(r, c, list) {
  let best = null, bd = 1e9;
  for (const e of list) {
    const d = cheb(r, c, e.r, e.c) + ((e.r - r) ** 2 + (e.c - c) ** 2) * 0.001 + e.uid * 1e-6;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function freeCellsNear(B, r, c, maxR = 3) {
  const out = [];
  for (let rad = 1; rad <= maxR; rad++) {
    for (let rr = r - rad; rr <= r + rad; rr++) for (let cc = c - rad; cc <= c + rad; cc++) {
      if (rr < 0 || cc < 0 || rr >= GROWS || cc >= GCOLS) continue;
      if (cheb(r, c, rr, cc) !== rad || B.occ[rr][cc]) continue;
      out.push([rr, cc]);
    }
    if (out.length) return out;
  }
  return out;
}
function placeUnit(B, u, r, c, instant) {
  B.occ[u.r][u.c] = 0;
  u.fr = instant ? r : u.r; u.fc = instant ? c : u.c;
  u.r = r; u.c = c;
  B.occ[r][c] = u.uid;
}
function leapNear(B, u, tgt) {
  const cells = freeCellsNear(B, tgt.r, tgt.c, 3);
  if (!cells.length) return false;
  cells.sort((a, b) => cheb(a[0], a[1], tgt.r, tgt.c) - cheb(b[0], b[1], tgt.r, tgt.c) || Math.abs(a[1] - u.c) - Math.abs(b[1] - u.c));
  const [r, c] = cells[0];
  const from = [u.r, u.c];
  placeUnit(B, u, r, c, true);
  u.target = tgt;
  emit(B, { t: 'leap', uid: u.uid, from, to: [r, c] });
  return true;
}
function emit(B, e) { if (!B.headless) B.ev.push(e); }

/* ---------- 능력치 ---------- */
function buffSum(u, stat) { let s = 0; for (const b of u.buffs) if (b.stat === stat) s += b.v; return s; }
function maxSlow(u, move) { let s = 0; for (const x of u.slows) if (!move || x.move) s = Math.max(s, x.v); return s; }
function effAtk(u) {
  let m = 1 + buffSum(u, 'atk');
  if (u.fx.has('rage') && u.hp < u.maxHp * 0.5) m += 0.35;
  return u.atk * m;
}
function effAS(u) {
  const a = u.as * (1 + u.asBonus + buffSum(u, 'as') + u.asStacks * 0.06) * (1 - maxSlow(u, false));
  return clamp(a, 0.2, 5);
}
function effArmor(u) { return (u.armor + buffSum(u, 'armor')) * (u.sunder ? 0.5 : 1); }
function effMr(u) { return u.mr + buffSum(u, 'mr'); }

/* ---------- 효과 기본 단위 ---------- */
// src: 공격·시전한 유닛(없으면 null), o: {attack, skill, spellSide, crit, reflect, trueDmg}
function dealDamage(B, src, tgt, raw, kind, o = {}) {
  if (!targetable(tgt) || raw <= 0) return 0;
  if (o.attack && tgt.fx.has('dodge') && B.rng.chance(0.2)) { emit(B, { t: 'miss', uid: tgt.uid }); return 0; }
  let d = raw;
  if (src) {
    d *= 1 + src.dmgAmp;
    if (src.giantAmp && tgt.maxHp >= 1500) d *= 1 + src.giantAmp;
    if (src.execAmp && tgt.hp <= tgt.maxHp * 0.35) d *= 1 + src.execAmp;
  }
  if (kind !== 'true') d *= B.amp;
  if (kind === 'phys') d *= 100 / (100 + Math.max(0, effArmor(tgt) * (1 - (src ? src.armorPen : 0))));
  else if (kind === 'magic') d *= 100 / (100 + Math.max(0, effMr(tgt) * (1 - (src && o.skill ? src.mrPen : 0))));
  if (tgt.sunder) d *= 1 + tgt.sunder.amp;
  let left = d;
  for (const s of tgt.shields) { const a = Math.min(s.amt, left); s.amt -= a; left -= a; if (left <= 0) break; }
  tgt.shields = tgt.shields.filter(s => s.amt > 0.5);
  tgt.hp -= left;
  tgt.dmgTaken += d;
  if (src) src.dmgDone += d;
  if (o.spellSide != null) B.sides[o.spellSide].stats.spellDmg += d;
  if (o.attack) tgt.mana = Math.min(tgt.manaMax, tgt.mana + 5);
  else if (o.skill) tgt.mana = Math.min(tgt.manaMax, tgt.mana + 2);
  emit(B, { t: 'dmg', uid: tgt.uid, a: d, crit: !!o.crit, kind, spell: o.spellSide != null });
  if (src && targetable(src)) {
    if (o.attack && src.lifesteal) healUnit(B, src, src, d * src.lifesteal, true);
    if (o.skill && src.spellVamp) healUnit(B, src, src, d * src.spellVamp, true);
    if (o.attack && tgt.fireBurn) applyBurn(B, src, tgt.fireBurn, 3);
    if (o.attack && tgt.thornDmg && !o.reflect) dealDamage(B, tgt, src, tgt.thornDmg, 'magic', { reflect: true });
  }
  if (tgt.hp <= 0) onLethal(B, tgt, src);
  return d;
}

function onLethal(B, u, killer) {
  if (u.undying > 0) { u.hp = 1; return; }
  const S = B.sides[u.side];
  // 불사조의 깃털: 전투마다 처음 쓰러진 아군 1명 부활
  if (!u.revive && !u.summon && S.aug.has('phoenixFeather') && !S.phoenixUsed) {
    S.phoenixUsed = true; u.revive = true; u.reviveHp = u.maxHp * 0.5;
  }
  if (u.revive) {
    u.revive = false; u.alive = false; u.reviving = 1; u.hp = 0;
    u.shields = []; u.burn = null;
    emit(B, { t: 'reviveStart', uid: u.uid });
    return;
  }
  u.alive = false; u.hp = 0; u.shields = []; u.burn = null;
  B.occ[u.r][u.c] = 0;
  emit(B, { t: 'death', uid: u.uid });
  if (!u.summon) S.lm = Math.min(S.lmMax, S.lm + (S.aug.has('sacrifice') ? 2 : 1));
  if (u.ghostT > 0 && !u.summon) { u.ghost = u.ghostT; emit(B, { t: 'ghost', uid: u.uid }); }
  // 처치한 쪽 효과
  if (killer && killer.side !== u.side) {
    const KS = B.sides[killer.side];
    if (KS.aug.has('huntMana')) KS.lm = Math.min(KS.lmMax, KS.lm + 1);
    if (targetable(killer)) {
      if (KS.aug.has('killHeal')) healUnit(B, killer, killer, killer.maxHp * 0.25, true);
      if (KS.aug.has('soulDrink') && killer.d.skill) killer.mana = Math.min(killer.manaMax, killer.mana + 40);
    }
  }
  // 최후의 저항: 남은 아군이 3명 이하가 되면
  if (S.aug.has('lastStand') && !S.lastStandDone) {
    const left = alliesOf(B, u.side).filter(x => !x.summon);
    if (left.length && left.length <= 3) {
      S.lastStandDone = true;
      for (const a of left) { addBuff(a, 'atk', 0.35, 99); emit(B, { t: 'laststand', uid: a.uid }); }
    }
  }
}

function healUnit(B, src, tgt, amt, raw) {
  if (!targetable(tgt) || amt <= 0) return 0;
  const S = B.sides[tgt.side];
  const a = Math.min(tgt.maxHp - tgt.hp, raw ? amt : amt * S.healAmp);
  if (a <= 0) return 0;
  tgt.hp += a;
  if (src) src.healDone += a;
  if (a >= 25) emit(B, { t: 'heal', uid: tgt.uid, a });
  return a;
}
function addShield(B, tgt, amt, dur, src) {
  if (!targetable(tgt)) return 0;
  const a = src === null ? amt : amt * B.sides[tgt.side].healAmp;
  tgt.shields.push({ amt: a, t: dur });
  emit(B, { t: 'shield', uid: tgt.uid, a });
  return a;
}
function applyStun(B, tgt, dur) {
  if (!targetable(tgt) || tgt.fx.has('ccImmune')) return;
  tgt.stun = Math.max(tgt.stun, dur);
  emit(B, { t: 'stun', uid: tgt.uid, dur });
}
function applySlow(B, tgt, v, dur, move) {
  if (!targetable(tgt)) return;
  tgt.slows.push({ v, t: dur, move: !!move });
}
function applyBurn(B, tgt, dps, dur, spellSide) {
  if (!targetable(tgt)) return;
  if (!tgt.burn || tgt.burn.dps <= dps) tgt.burn = { dps, t: dur, spellSide };
  else tgt.burn.t = Math.max(tgt.burn.t, dur);
}
function addBuff(tgt, stat, v, dur) { if (targetable(tgt)) tgt.buffs.push({ stat, v, t: dur }); }
