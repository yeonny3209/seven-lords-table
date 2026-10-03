/* =====================================================================
 * 05. 군주 주문 — 시전, 효과, 자동 시전 규칙, AI 시전
 *     플레이어 입력·자동 시전·AI 시전 모두 castSpell 하나로 처리된다.
 *     직접 입력은 B.queue 에 {side, slot, target} 이벤트로 들어가 다음 틱에 실행.
 * ===================================================================== */

function spellCostNow(S, slot) {
  let c = spellCost(slot.id, slot.lvl);
  if (S.lordType === 'tactic' && S.castCount === 0) c -= 2;
  if (S.aug.has('discount')) c = Math.max(Math.min(c, 1), c - 1);
  return Math.max(0, c);
}
function spellReady(S, i) {
  const sl = S.spells[i];
  if (!sl) return false;
  return !sl.used && sl.cd <= 0 && S.lm >= spellCostNow(S, sl);
}
function queueSpell(B, side, slot, target) { B.queue.push({ side, slot, target, tick: B.tick }); }

// target: {uid} | {uid, uid2} | {r} | {r, c} | {uid, r, c} | {}
function validTarget(B, S, sp, tg) {
  if (!tg) return false;
  const ally = id => { const u = unitByUid(B, id); return u && u.side === S.idx && targetable(u) ? u : null; };
  const foe = id => { const u = unitByUid(B, id); return u && u.side !== S.idx && targetable(u) ? u : null; };
  switch (sp.target) {
    case 'ally': return !!ally(tg.uid);
    case 'enemy': return !!foe(tg.uid);
    case 'none': return true;
    case 'row': return tg.r >= 0 && tg.r < GROWS;
    case 'cell': return tg.r >= 0 && tg.r < GROWS && tg.c >= 0 && tg.c < GCOLS;
    case 'ally2': return !!ally(tg.uid) && !!ally(tg.uid2) && tg.uid !== tg.uid2;
    case 'allyCell': return !!ally(tg.uid) && tg.r >= 0 && tg.r < GROWS && tg.c >= 0 && tg.c < GCOLS && !B.occ[tg.r][tg.c];
  }
  return false;
}

function castSpell(B, side, slotIdx, target, auto) {
  const S = B.sides[side];
  const sl = S.spells[slotIdx];
  if (!sl || B.over) return false;
  const sp = SPELLS[sl.id];
  if (!spellReady(S, slotIdx) || !validTarget(B, S, sp, target)) return false;
  S.lm -= spellCostNow(S, sl);
  S.castCount++;
  S.stats.casts++;
  if (sp.once) { sl.uses = (sl.uses || 0) + 1; if (sl.uses >= (S.aug.has('secondChance') ? 2 : 1)) sl.used = true; }
  else sl.cd = sp.cd * (S.aug.has('quickCast') ? 0.7 : 1);
  const mult = S.spellMult * (auto ? (S.ai && S.ai.mult ? S.ai.mult : CFG.AUTO_CAST_MULT) : 1);
  const v = sp.fx[0].v[sl.lvl - 1];
  emit(B, { t: 'spell', side, id: sl.id, name: sp.name, icon: sp.icon, lord: S.name, emoji: S.emoji, target, auto: !!auto });
  B.log.push({ tick: B.tick, side, slot: slotIdx, target, auto: !!auto });
  const enemyOf = id => unitByUid(B, id);
  const seal = u => (u && u.fx.has('seal') ? 1.3 : 1);
  const shieldDur = d => d + (S.lordType === 'guard' ? 1 : 0);
  const dmgMult = mult * S.spellDmgMult;
  const sideAllies = () => alliesOf(B, side);
  const area = (r, c) => enemiesOf(B, side).filter(e => cheb(e.r, e.c, r, c) <= 1);

  for (const fx of sp.fx) {
    const val = fx.v[sl.lvl - 1];
    switch (fx.t) {
      case 'dmg': { const e = enemyOf(target.uid); if (e) dealDamage(B, null, e, val * dmgMult, 'magic', { spellSide: side }); break; }
      case 'stun': { const e = enemyOf(target.uid); if (e) applyStun(B, e, val); break; }
      case 'shieldPct': {
        const a = unitByUid(B, target.uid);
        if (a) { const amt = a.maxHp * val * mult * seal(a); a.shields.push({ amt, t: shieldDur(fx.dur) }); S.stats.spellShield += amt; emit(B, { t: 'shield', uid: a.uid, a: amt }); }
        break;
      }
      case 'buffAll': for (const a of sideAllies()) addBuff(a, fx.stat, val * mult * seal(a), fx.dur); break;
      case 'buffPct': { const a = unitByUid(B, target.uid); if (a) addBuff(a, fx.stat, val * mult * seal(a), fx.dur); break; }
      case 'swap': {
        const a = unitByUid(B, target.uid), b = unitByUid(B, target.uid2);
        if (a && b) {
          const [ar, ac, br, bc] = [a.r, a.c, b.r, b.c];
          B.occ[ar][ac] = 0; B.occ[br][bc] = 0;
          a.r = br; a.c = bc; b.r = ar; b.c = ac; a.fr = a.r; a.fc = a.c; b.fr = b.r; b.fc = b.c;
          B.occ[a.r][a.c] = a.uid; B.occ[b.r][b.c] = b.uid;
          a.moveCd = 0; b.moveCd = 0; a.target = null; b.target = null;
          emit(B, { t: 'swap', a: a.uid, b: b.uid });
          if (val) { for (const x of [a, b]) { const amt = val * mult * seal(x); x.shields.push({ amt, t: shieldDur(3) }); S.stats.spellShield += amt; } }
        }
        break;
      }
      case 'fillMana': { const a = unitByUid(B, target.uid); if (a && a.d.skill) a.mana = a.manaMax; break; }
      case 'zone': B.zones.push({ side, row: target.r, dps: val * dmgMult, t: fx.dur }); break;
      case 'freezeAll': for (const e of enemiesOf(B, side)) { e.freeze = Math.max(e.freeze, val * mult); emit(B, { t: 'freeze', uid: e.uid }); } break;
      case 'undying': { const a = unitByUid(B, target.uid); if (a) { a.undying = val * mult * seal(a); emit(B, { t: 'undying', uid: a.uid }); } break; }
      case 'healAllPct': for (const a of sideAllies()) S.stats.spellHeal += healUnit(B, null, a, a.maxHp * val * mult * seal(a), true); break;
      case 'slowArea': for (const e of area(target.r, target.c)) { applySlow(B, e, Math.min(0.8, val * mult), fx.dur, true); applySlow(B, e, Math.min(0.8, val * mult), fx.dur, false); } break;
      case 'dmgArea': for (const e of area(target.r, target.c)) dealDamage(B, null, e, val * dmgMult, 'magic', { spellSide: side }); break;
      case 'teleport': {
        const a = unitByUid(B, target.uid);
        if (a && !B.occ[target.r][target.c]) {
          placeUnit(B, a, target.r, target.c, true); a.moveCd = 0; a.target = null;
          emit(B, { t: 'blink', uid: a.uid });
          if (val) { const amt = val * mult * seal(a); a.shields.push({ amt, t: shieldDur(3) }); S.stats.spellShield += amt; }
        }
        break;
      }
      case 'taunt': {
        const a = unitByUid(B, target.uid);
        if (a) { a.taunt = fx.dur; addBuff(a, 'armor', val * mult * seal(a), fx.dur); addBuff(a, 'mr', val * mult * seal(a), fx.dur); emit(B, { t: 'taunt', uid: a.uid }); }
        break;
      }
      case 'sunder': { const e = enemyOf(target.uid); if (e) { e.sunder = { amp: val * mult, t: fx.dur }; emit(B, { t: 'sunder', uid: e.uid }); } break; }
      case 'reap': {
        const e = enemyOf(target.uid);
        if (!e) break;
        if (e.hp / e.maxHp <= val * mult && e.undying <= 0) { emit(B, { t: 'execute', uid: e.uid }); dealDamage(B, null, e, e.hp + sum(e.shields.map(s => s.amt)) + 1, 'true', { spellSide: side }); }
        else dealDamage(B, null, e, 200 * dmgMult, 'magic', { spellSide: side });
        break;
      }
    }
  }
  if (S.aug.has('echo')) S.lm = Math.min(S.lmMax, S.lm + 1);
  if (S.aug.has('grace')) for (const id of [target.uid, target.uid2]) {
    const a = id != null ? unitByUid(B, id) : null;
    if (a && a.side === side && targetable(a)) S.stats.spellHeal += healUnit(B, null, a, a.maxHp * 0.15, true);
  }
  return true;
}

/* ---------- 자동 시전 규칙 ---------- */
function unitValue(u) { return u.d.cost * 3 + u.star * 4 + u.items.length * 3 + (u.monster ? 0 : 1); }
function bestBy(list, f) { let b = null, bv = -1e9; for (const x of list) { const v = f(x); if (v > bv) { bv = v; b = x; } } return b; }
function bestClump(B, side, min) {
  const foes = enemiesOf(B, side);
  let best = null, bn = 0;
  for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
    const n = foes.filter(e => cheb(e.r, e.c, r, c) <= 1).length;
    if (n > bn) { bn = n; best = { r, c }; }
  }
  return bn >= min ? best : null;
}
function safestCell(B, side) {
  const foes = enemiesOf(B, side);
  let best = null, bd = -1;
  for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
    if (B.occ[r][c]) continue;
    const d = foes.length ? Math.min(...foes.map(e => cheb(e.r, e.c, r, c))) : 0;
    if (d > bd) { bd = d; best = { r, c }; }
  }
  return best;
}

// 조건을 만족하면 대상을 돌려주고, 아니면 null
function ruleTarget(B, S, sl, rule, loose) {
  const sp = SPELLS[sl.id];
  const side = S.idx;
  const friends = alliesOf(B, side), foes = enemiesOf(B, side);
  if (!friends.length || !foes.length) return null;
  const ratio = u => u.hp / u.maxHp;
  const time = B.tick * CFG.TICK;
  const k = loose ? 1.4 : 1; // 느슨한 기준(즉시형 AI)
  const pick = u => (u ? { uid: u.uid } : null);
  switch (rule) {
    case 'off': return null;
    case 'asap': return defaultTarget(B, S, sp);
    case 'allyLow40': return pick(bestBy(friends.filter(u => ratio(u) <= 0.4 * k), u => u.items.length * 10 + unitValue(u)));
    case 'enemyMana80': return pick(bestBy(foes.filter(u => u.d.skill && u.mana / u.manaMax >= 0.8 / k), unitValue));
    case 'enemyCarry': return time >= 2 ? pick(bestBy(foes, unitValue)) : null;
    case 'enemyLowest': return pick(bestBy(foes, u => -u.hp));
    case 'midFight': return time >= 3 / k ? {} : null;
    case 'losing': return friends.length < foes.length ? {} : null;
    case 'swapTank': {
      const front = friends.filter(u => ratio(u) <= 0.35 * k && foes.some(e => cheb(e.r, e.c, u.r, u.c) <= 1));
      const a = bestBy(front, unitValue);
      if (!a) return null;
      const b = bestBy(friends.filter(u => u !== a && ratio(u) >= 0.7 && !foes.some(e => cheb(e.r, e.c, u.r, u.c) <= 1)), u => u.hp);
      return b ? { uid: a.uid, uid2: b.uid } : null;
    }
    case 'carryMana': return pick(bestBy(friends.filter(u => u.d.skill && u.mana / u.manaMax < 0.5 && !u.summon), unitValue));
    case 'rowMost': {
      let br = -1, bn = 0;
      for (let r = 0; r < GROWS; r++) { const n = foes.filter(e => e.r === r).length; if (n > bn) { bn = n; br = r; } }
      return bn >= (loose ? 2 : 3) ? { r: br } : null;
    }
    case 'enemySkills': return foes.filter(u => u.d.skill && u.mana / u.manaMax >= 0.7).length >= (loose ? 1 : 2) ? {} : null;
    case 'allyDying': return pick(bestBy(friends.filter(u => ratio(u) <= 0.25 * k && !u.summon), unitValue));
    case 'teamLow': return sum(friends.map(ratio)) / friends.length <= 0.6 * Math.min(k, 1.25) ? {} : null;
    case 'enemyClump': return bestClump(B, side, loose ? 2 : 3);
    case 'carryFight': return pick(bestBy(friends.filter(u => u.target && targetable(u.target) && cheb(u.r, u.c, u.target.r, u.target.c) <= u.range && !u.summon), unitValue));
    case 'rescueLow': {
      const a = bestBy(friends.filter(u => ratio(u) <= 0.35 * k && foes.some(e => cheb(e.r, e.c, u.r, u.c) <= 1)), unitValue);
      const cell = a && safestCell(B, side);
      return a && cell ? { uid: a.uid, r: cell.r, c: cell.c } : null;
    }
    case 'tankFront': {
      const pressed = friends.some(u => u.range >= 2 && foes.some(e => e.target === u && cheb(e.r, e.c, u.r, u.c) <= 1));
      return pressed ? pick(bestBy(friends.filter(u => u.range === 1 || u.traits.includes('guardian')), u => u.hp)) : null;
    }
    case 'enemyFront': return time >= 1.5 ? pick(bestBy(foes, u => u.maxHp)) : null;
    case 'enemyExecute': {
      const th = sp.fx[0].v[sl.lvl - 1];
      return pick(bestBy(foes.filter(u => u.hp / u.maxHp <= th && u.undying <= 0), unitValue));
    }
  }
  return null;
}

// '즉시' 규칙용 기본 대상
function defaultTarget(B, S, sp) {
  const side = S.idx;
  const friends = alliesOf(B, side), foes = enemiesOf(B, side);
  switch (sp.target) {
    case 'ally': return { uid: bestBy(friends, u => unitValue(u) - u.hp / u.maxHp * 5).uid };
    case 'enemy': return { uid: bestBy(foes, unitValue).uid };
    case 'none': return {};
    case 'row': { let br = 0, bn = -1; for (let r = 0; r < GROWS; r++) { const n = foes.filter(e => e.r === r).length; if (n > bn) { bn = n; br = r; } } return { r: br }; }
    case 'cell': return bestClump(B, side, 1);
    case 'ally2': return null;
    case 'allyCell': return null;
  }
  return null;
}

function autoCastTick(B, S, dt) {
  if (!S.spells.length) return;
  if (S.ai) return aiCastTick(B, S, dt);
  // 플레이어: 자동 시전이 켜진 주문(또는 즉시 결과 모드)만
  for (let i = 0; i < S.spells.length; i++) {
    const sl = S.spells[i];
    const rule = S.forceAuto && sl.rule === 'off' ? SPELLS[sl.id].auto[0] : sl.rule;
    if (rule === 'off' || !spellReady(S, i)) continue;
    const tg = ruleTarget(B, S, sl, rule, false);
    if (tg && castSpell(B, S.idx, i, tg, true)) return;
  }
}

// AI 군주 시전: 주문 성향이 높으면 비싼 주문을 위해 마나를 아끼고, 낮으면 싼 주문을 바로 쓴다.
function aiCastTick(B, S, dt) {
  const tend = S.ai.tend;
  if (S.aiWait > 0) { S.aiWait -= dt; return; }
  const idxs = S.spells.map((_, i) => i).sort((a, b) =>
    tend >= 0.5 ? spellCostNow(S, S.spells[b]) - spellCostNow(S, S.spells[a]) : spellCostNow(S, S.spells[a]) - spellCostNow(S, S.spells[b]));
  const top = S.spells[idxs[0]];
  for (const i of idxs) {
    const sl = S.spells[i];
    if (!spellReady(S, i)) continue;
    // 절약형: 가장 비싼 주문이 아직 안 됐으면, 마나가 남을 때만 싼 주문 사용
    if (tend >= 0.45 && sl !== top && !top.used && top.cd <= 0 && S.lm - spellCostNow(S, sl) < spellCostNow(S, top)) continue;
    const loose = tend < 0.4;
    let tg = ruleTarget(B, S, sl, SPELLS[sl.id].auto[0], loose);
    if (!tg && SPELLS[sl.id].auto[1]) tg = ruleTarget(B, S, sl, SPELLS[sl.id].auto[1], loose);
    // 마나가 가득 차면 낭비하지 않도록 기본 대상에게라도 시전
    if (!tg && (S.lm >= S.lmMax - 0.5 || (loose && B.tick * CFG.TICK > 4))) tg = ruleTarget(B, S, sl, 'asap', true);
    if (!tg) continue;
    if (S.ai.castDelay > 0 && !S.aiArmed) { S.aiArmed = true; S.aiWait = B.rng.next() * S.ai.castDelay; return; }
    S.aiArmed = false;
    if (castSpell(B, S.idx, i, tg, true)) return;
  }
}
