/* =====================================================================
 * 04. 전투 엔진 (2/2) — 틱 진행, A* 경로, 공격·스킬, 종료 판정
 * ===================================================================== */

function stepBattle(B) {
  if (B.over) return;
  const dt = CFG.TICK;
  B.tick++;
  const dot = B.tick % 5 === 0; // 지속 피해·회복은 0.5초마다
  // 연장전: 15초 이후 모든 피해가 초당 8%씩 증가해 시간 초과를 드물게 만든다
  const time = B.tick * dt;
  if (time > CFG.OVERTIME) {
    if (B.amp === 1) emit(B, { t: 'overtime' });
    B.amp = 1 + (time - CFG.OVERTIME) * CFG.OVERTIME_RAMP;
  }

  // 1) 군주 마나, 주문 재사용 대기, 입력된 주문 이벤트, 자동/AI 시전
  for (const S of B.sides) {
    S.lm = Math.min(S.lmMax, S.lm + CFG.LORD_MANA_REGEN * S.lmRegen * dt);
    for (const sl of S.spells) if (sl.cd > 0) sl.cd = Math.max(0, sl.cd - dt);
  }
  const q = B.queue; B.queue = [];
  for (const e of q) castSpell(B, e.side, e.slot, e.target, false);
  for (const S of B.sides) autoCastTick(B, S, dt);

  // 2) 화염 지대
  for (const z of B.zones) {
    z.t -= dt;
    if (dot) for (const e of enemiesOf(B, z.side)) if (e.r === z.row) dealDamage(B, null, e, z.dps * 0.5, 'magic', { spellSide: z.side });
  }
  B.zones = B.zones.filter(z => z.t > 0);

  // 3) 유닛 (매 틱 순서를 섞어 진영 편향 제거)
  const order = B.rng.shuffle(B.units.filter(u => u.alive || u.ghost > 0 || u.reviving > 0));
  for (const u of order) updateUnit(B, u, dt, dot);

  // 4) 종료 판정
  const live = [0, 0];
  for (const u of B.units) if ((u.alive || u.reviving > 0) && !u.summon) live[u.side]++;
  const liveAny = [0, 0];
  for (const u of B.units) if (u.alive || u.reviving > 0) liveAny[u.side]++;
  if (!liveAny[0] || !liveAny[1] || !live[0] || !live[1]) {
    const w = (live[0] && !live[1]) ? 0 : (live[1] && !live[0]) ? 1 : -1;
    finishBattle(B, w, false);
  } else if (B.tick >= B.maxTick) finishBattle(B, -1, true);
}

function finishBattle(B, winner, timeout) {
  B.over = true;
  const survivors = [[], []];
  for (const u of B.units) if ((u.alive || u.reviving > 0) && !u.summon) survivors[u.side].push({ star: u.star, cost: u.d.cost });
  B.result = { winner, timeout, survivors, ticks: B.tick };
  emit(B, { t: 'end', winner, timeout });
}

function runBattle(specA, specB, seed) {
  const B = createBattle(specA, specB, seed, { headless: true });
  let guard = 0;
  while (!B.over && guard++ < 1000) stepBattle(B);
  return B;
}

function updateUnit(B, u, dt, dot) {
  if (u.reviving > 0) {
    u.reviving -= dt;
    if (u.reviving <= 0) { u.alive = true; u.hp = Math.min(u.maxHp, u.reviveHp); emit(B, { t: 'revive', uid: u.uid }); }
    return;
  }
  if (u.ghost > 0) {
    u.ghost -= dt;
    if (u.ghost <= 0) { emit(B, { t: 'ghostEnd', uid: u.uid }); return; }
    ghostAct(B, u, dt);
    return;
  }
  // 상태 타이머
  u.stun = Math.max(0, u.stun - dt); u.freeze = Math.max(0, u.freeze - dt);
  u.undying = Math.max(0, u.undying - dt); u.taunt = Math.max(0, u.taunt - dt);
  if (u.sunder && (u.sunder.t -= dt) <= 0) u.sunder = null;
  for (const b of u.buffs) b.t -= dt; u.buffs = u.buffs.filter(b => b.t > 0);
  for (const s of u.slows) s.t -= dt; u.slows = u.slows.filter(s => s.t > 0);
  for (const s of u.shields) s.t -= dt; u.shields = u.shields.filter(s => s.t > 0);
  if (dot) {
    if (u.burn) {
      dealDamage(B, null, u, u.burn.dps * 0.5, 'magic', { spellSide: u.burn.spellSide });
      if (u.burn && (u.burn.t -= 0.5) <= 0) u.burn = null;
    }
    if (u.regen && u.alive) healUnit(B, null, u, u.maxHp * u.regen * 0.5, true);
    if (u.asRamp) u.asBonus += 0.015;
    if (u.fx.has('frostAura')) for (const e of enemiesOf(B, u.side)) if (cheb(e.r, e.c, u.r, u.c) <= 2) applySlow(B, e, 0.25, 0.6);
  }
  if (!u.alive) return;
  if (u.stun > 0 || u.freeze > 0) return;
  if (u.moveCd > 0) { u.moveCd -= dt; return; }

  // 대상 선정 (도발 우선)
  const foes = enemiesOf(B, u.side);
  if (!foes.length) return;
  const taunter = foes.find(e => e.taunt > 0 && cheb(e.r, e.c, u.r, u.c) <= 2);
  if (taunter) u.target = taunter;
  u.retargetT -= dt;
  if (!u.target || !targetable(u.target) || (u.retargetT <= 0 && cheb(u.r, u.c, u.target.r, u.target.c) > u.range)) {
    u.target = nearestTo(u.r, u.c, foes);
    u.retargetT = 1;
  }
  const t = u.target;
  if (!t) return;

  // 스킬
  if (u.d.skill && u.mana >= u.manaMax) { castSkill(B, u); return; }

  const dist = cheb(u.r, u.c, t.r, t.c);
  if (dist <= u.range) {
    u.atkCd -= dt;
    if (u.atkCd <= 0) { attack(B, u, t, dist); u.atkCd += 1 / effAS(u); }
  } else {
    const step = findStep(B, u, t);
    if (step) {
      placeUnit(B, u, step[0], step[1], false);
      u.moveDur = CFG.MOVE_TIME / Math.max(0.2, 1 - maxSlow(u, true));
      u.moveCd = u.moveDur;
      u.atkCd = Math.max(u.atkCd, 0.15);
    } else {
      // 길이 막혔으면 다른 적을 노린다
      const alt = foes.filter(e => e !== t).sort((a, b) => cheb(u.r, u.c, a.r, a.c) - cheb(u.r, u.c, b.r, b.c))[0];
      if (alt && B.rng.chance(0.3)) u.target = alt;
    }
  }
}

// A* 탐색: 목표 = 대상과의 거리가 사거리 이내인 빈 칸. 휴리스틱 = max(0, 체비셰프 거리 - 사거리)
function findStep(B, u, t) {
  const N = GROWS * GCOLS;
  const g = new Float32Array(N).fill(1e9);
  const from = new Int16Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = u.r * GCOLS + u.c;
  const h = (r, c) => Math.max(0, cheb(r, c, t.r, t.c) - u.range);
  g[start] = 0;
  const open = [start];
  let goal = -1;
  while (open.length) {
    let bi = 0, bf = 1e9;
    for (let i = 0; i < open.length; i++) {
      const n = open[i], f = g[n] + h((n / GCOLS) | 0, n % GCOLS);
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cr = (cur / GCOLS) | 0, cc = cur % GCOLS;
    if (cur !== start && cheb(cr, cc, t.r, t.c) <= u.range) { goal = cur; break; }
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = cr + dr, nc = cc + dc;
      if (nr < 0 || nc < 0 || nr >= GROWS || nc >= GCOLS) continue;
      if (B.occ[nr][nc]) continue;
      const n = nr * GCOLS + nc;
      const cost = g[cur] + (dr && dc ? 1.02 : 1); // 대각선을 아주 약간 비싸게 해서 곧은 경로 선호
      if (cost < g[n]) { g[n] = cost; from[n] = cur; open.push(n); }
    }
  }
  if (goal < 0) return null;
  let n = goal;
  while (from[n] !== start && from[n] >= 0) n = from[n];
  return [(n / GCOLS) | 0, n % GCOLS];
}

function attack(B, u, t, dist) {
  u.atkCount++;
  let dmg = effAtk(u);
  if (u.distAmp) dmg *= 1 + u.distAmp * dist;
  const crit = B.rng.chance(u.crit);
  if (crit) dmg *= u.critDmg;
  emit(B, { t: 'atk', uid: u.uid, tuid: t.uid, ranged: u.range > 1 });
  dealDamage(B, u, t, dmg, 'phys', { attack: true, crit });
  u.mana = Math.min(u.manaMax, u.mana + 10 + u.manaPerAtk);
  if (u.fx.has('asRamp')) u.asStacks = Math.min(10, u.asStacks + 1);
  if (u.frostSlow) applySlow(B, t, u.frostSlow, 2, false);
  if (u.burnHitDps) applyBurn(B, t, u.burnHitDps, 3);
  if (u.fx.has('zap') && u.atkCount % 3 === 0) {
    const others = enemiesOf(B, u.side).filter(e => e !== t).sort((a, b) => cheb(a.r, a.c, t.r, t.c) - cheb(b.r, b.c, t.r, t.c)).slice(0, 2);
    for (const e of [t, ...others]) { emit(B, { t: 'zap', uid: u.uid, tuid: e.uid }); dealDamage(B, u, e, 70, 'magic', { skill: true }); }
  }
}

function ghostAct(B, u, dt) {
  const foes = enemiesOf(B, u.side);
  if (!foes.length) return;
  if (!u.target || !targetable(u.target)) u.target = nearestTo(u.r, u.c, foes);
  u.atkCd -= dt;
  if (u.atkCd <= 0) {
    u.atkCd += 1 / effAS(u);
    emit(B, { t: 'atk', uid: u.uid, tuid: u.target.uid, ranged: true, ghost: true });
    dealDamage(B, u, u.target, effAtk(u) * u.ghostMult, 'phys', { attack: true });
  }
}

/* ---------- 유닛 스킬 ---------- */
function castSkill(B, u) {
  const sk = u.d.skill;
  u.mana = u.fx.has('blueBuff') ? 25 : 0;
  emit(B, { t: 'skill', uid: u.uid, name: sk.name });
  const ctx = { side: u.side, caster: u, idx: u.star - 1, mult: 1 + u.ap / 100, last: [] };
  for (const fx of sk.fx) runSkillFx(B, ctx, fx);
}

function selectTargets(B, ctx, fx) {
  const u = ctx.caster, side = ctx.side;
  const foes = enemiesOf(B, side), friends = alliesOf(B, side);
  const ratio = x => x.hp / x.maxHp;
  switch (fx.tgt) {
    case 'self': return [u];
    case 'target': return u.target && targetable(u.target) ? [u.target] : (foes.length ? [nearestTo(u.r, u.c, foes)] : []);
    case 'area': { const c = u.target && targetable(u.target) ? u.target : nearestTo(u.r, u.c, foes); return c ? foes.filter(e => cheb(e.r, e.c, c.r, c.c) <= (fx.r || 1)) : []; }
    case 'selfArea': return foes.filter(e => cheb(e.r, e.c, u.r, u.c) <= (fx.r || 1));
    case 'lowestAlly': return friends.sort((a, b) => ratio(a) - ratio(b)).slice(0, 1);
    case 'lowestAllies': return friends.sort((a, b) => ratio(a) - ratio(b)).slice(0, fx.n || 2);
    case 'allAllies': return friends;
    case 'allEnemies': return foes;
    case 'lowestEnemy': return foes.sort((a, b) => a.hp - b.hp).slice(0, 1);
    case 'randomEnemies': return B.rng.shuffle(foes).slice(0, fx.n || 3);
    case 'farthestEnemy': { const f = farthestFrom(B, u, foes); return f ? [f] : []; }
    case 'last': return ctx.last.filter(targetable);
  }
  return [];
}

function runSkillFx(B, ctx, fx) {
  const u = ctx.caster;
  const v = fx.v ? fx.v[ctx.idx] : 0;
  if (fx.t === 'summon') {
    const n = fx.n || 1;
    for (let i = 0; i < n; i++) {
      const cells = freeCellsNear(B, u.r, u.c, 3);
      if (!cells.length) break;
      const [r, c] = B.rng.pick(cells);
      const s = spawnUnit(B, u.side, fx.unit, u.star, [], r, c, 1);
      emit(B, { t: 'summon', uid: s.uid });
    }
    return;
  }
  if (fx.t === 'leap') {
    const tg = selectTargets(B, ctx, fx)[0];
    if (tg) leapNear(B, u, tg);
    return;
  }
  const targets = selectTargets(B, ctx, fx);
  if (fx.t === 'dmg' || fx.t === 'burn' || fx.t === 'stun' || fx.t === 'slow' || fx.t === 'execute') ctx.last = targets;
  for (const tg of targets) {
    switch (fx.t) {
      case 'dmg': {
        let d = v * ctx.mult;
        let crit = false;
        if (u.fx.has('skillCrit') && B.rng.chance(u.crit)) { d *= u.critDmg; crit = true; }
        emit(B, { t: 'skillHit', uid: u.uid, tuid: tg.uid });
        dealDamage(B, u, tg, d, fx.kind || 'magic', { skill: true, crit });
        break;
      }
      case 'burn': applyBurn(B, tg, v * ctx.mult, fx.dur || 3); break;
      case 'stun': applyStun(B, tg, v); break;
      case 'slow': applySlow(B, tg, v, fx.dur || 2, false); break;
      case 'heal': healUnit(B, u, tg, v * ctx.mult); break;
      case 'shield': addShield(B, tg, v * ctx.mult, fx.dur || 4, u); break;
      case 'buff': addBuff(tg, fx.stat, v, fx.dur || 4); break;
      case 'mana': if (tg !== u && tg.d.skill) tg.mana = Math.min(tg.manaMax, tg.mana + v); break;
      case 'execute':
        if (tg.hp / tg.maxHp <= v && tg.undying <= 0) { emit(B, { t: 'execute', uid: tg.uid }); dealDamage(B, u, tg, tg.hp + sum(tg.shields.map(s => s.amt)) + 1, 'true', { skill: true }); }
        break;
    }
  }
}
