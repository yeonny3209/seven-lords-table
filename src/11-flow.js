/* =====================================================================
 * 11. 진행 — 라운드 흐름, 전투 재생 루프, 공용 선택, 보상, 탈락
 * ===================================================================== */

function startNewGame(opts) {
  stopBattle();
  newGame(opts);
  clearSave();
  beginRound();
}
function continueGame(saved) {
  stopBattle();
  G = saved;
  beginRound();
}
function stopBattle() {
  UI.battle = null; UI.battleView = false; UI.aim = null; UI.pending = null; UI.currentOppId = null;
  FX.floats = []; FX.projs = []; FX.flashes = []; FX.texts = [];
  $('#aimHint').textContent = '';
}

function beginRound() {
  stopBattle();
  if (!G || G.over) return;
  const type = roundType(G.stage, G.round);
  if (type === 'carousel') { G.phase = 'carousel'; renderAll(); return runCarousel(); }
  G.phase = 'prep';
  startPrep();
  const ready = () => { G.phase = 'prep'; renderAll(); toast(`${roundLabel()} 준비 단계 — ${type === 'pve' ? '중립 몬스터' : '대전'}`); };
  if (augmentDue()) {
    for (const P of G.players) if (P.alive && !P.isHuman) applyAugment(P, aiPickAugment(P, augmentOffers(P)));
    G.phase = 'augment';
    renderAll();
    showAugmentPick(augmentOffers(human()), a => { applyAugment(human(), a); ready(); });
  } else ready();
}

function onReady() {
  if (!G || G.phase !== 'prep' || modalOpen()) return;
  const P = human();
  while (P.board.length > boardLimit(P)) {
    const u = P.board.pop();
    const f = benchFree(P);
    if (f >= 0) P.bench[f] = u; else sellUnit(P, u);
  }
  for (const A of G.players) if (A.alive && !A.isHuman) aiPrep(A);
  const type = roundType(G.stage, G.round);
  const seedBase = R().int(2 ** 30);
  const battles = [];
  if (type === 'pve') for (const A of G.players) { if (A.alive) battles.push({ a: A, b: null, pve: true }); }
  else for (const [a, b, ghost] of makePairs()) battles.push({ a, b, ghost: !!ghost });
  for (const bt of battles) if (bt.b && bt.b.isHuman && !bt.ghost) [bt.a, bt.b] = [bt.b, bt.a];
  battles.forEach((bt, i) => { bt.seed = seedBase + i * 7919; });
  const mb = battles.find(bt => bt.a.isHuman);
  for (const bt of battles) if (bt !== mb) bt.B = runBattle(specOf(bt.a), bt.b ? specOf(bt.b) : monsterSpec(), bt.seed);
  G.phase = 'battle';
  UI.pending = { battles, type, mb };
  UI.currentOppId = mb.b ? mb.b.id : null;
  const oppSpec = mb.b ? specOf(mb.b) : monsterSpec();
  if (G.instant) {
    mb.B = runBattle(specOf(P, { forceAuto: true }), oppSpec, mb.seed);
    renderAll();
    finishRound();
    return;
  }
  mb.B = UI.battle = createBattle(specOf(P), oppSpec, mb.seed);
  UI.battleView = true; UI.acc = 0; UI.ending = false;
  pushEffects(UI.battle, UI.battle.ev); UI.battle.ev = [];
  renderAll();
  renderTraitsBattle();
}

// 전투 중에는 시너지 패널에 실제 발동 단계 표시 (스냅샷)
function renderTraitsBattle() { renderTraits(); }

/* ---------- 재생 루프 ---------- */
let lastBarUpdate = 0;
function frame(now) {
  const dt = Math.min(0.05, ((now - UI.lastFrame) / 1000) || 0.016);
  UI.lastFrame = now; UI.frameDt = dt;
  const B = UI.battle;
  if (B && UI.battleView && !B.over && !modalOpen()) {
    UI.acc += dt * G.battleSpeed * (UI.aim ? 0.25 : 1);
    let steps = 0;
    while (UI.acc >= CFG.TICK && steps < 12 && !B.over) {
      UI.acc -= CFG.TICK; steps++;
      stepBattle(B);
      pushEffects(B, B.ev); B.ev = [];
    }
    if (UI.aim && !spellReady(B.sides[0], UI.aim.slot) && !UI.aim.first) cancelAim();
  }
  if (B && B.over && UI.battleView && !UI.ending) {
    UI.ending = true; cancelAim();
    const w = B.result.winner;
    toast(w === 0 ? '승리!' : B.result.timeout ? '시간 초과' : '패배', w === 0 ? 'gold' : 'bad');
    setTimeout(finishRound, 1100);
  }
  if (G) draw(now);
  if (G && UI.battleView && now - lastBarUpdate > 90) { lastBarUpdate = now; renderSpellBar(); }
  requestAnimationFrame(frame);
}

/* ---------- 라운드 종료 ---------- */
function pveRewards(P, won) {
  const r = R(), got = [];
  const comps = G.stage === 1 ? 1 : won ? 2 : 1;
  const gold = won ? (G.stage === 1 ? 1 : 3) : 0;
  for (let i = 0; i < comps; i++) { const it = r.pick(COMP_KEYS); P.items.push(it); got.push(COMPONENTS[it].icon + ' ' + COMPONENTS[it].name); }
  if (gold) { P.gold += gold; got.push(`🪙 ${gold}`); }
  const spellReward = (G.stage === 1 && G.round === 3) || (G.stage >= 2 && won);
  if (spellReward) {
    if (P.isHuman) G.pendingSpellPick = true;
    else { const ids = spellOffers(P, 3); if (ids.length) addSpell(P, aiPickSpell(P, ids)); }
    got.push('📜 새 주문');
  }
  return got.join(' · ');
}

function finishRound() {
  if (!UI.pending) return;
  const { battles, mb } = UI.pending;
  const base = stageBaseDamage(G.stage);
  const others = [];
  let info = null;
  for (const bt of battles) {
    const res = bt.B.result;
    if (bt.pve) {
      const won = res.winner === 0;
      const dmg = won ? 0 : Math.max(1, base + survivorDamage(res.survivors[1]));
      applyResult(bt.a, won, dmg, false, '중립 몬스터');
      const rw = pveRewards(bt.a, won);
      if (bt === mb) info = { won, dmg, timeout: res.timeout, oppName: '중립 몬스터', rewards: rw };
    } else {
      const w = res.winner;
      const draw = res.timeout || w === -1;
      const dA = draw ? Math.max(1, base) : base + survivorDamage(res.survivors[1]);
      const dB = draw ? Math.max(1, base) : base + survivorDamage(res.survivors[0]);
      applyResult(bt.a, w === 0, dA, true, bt.b.name);
      if (!bt.ghost) applyResult(bt.b, w === 1, dB, true, bt.a.name);
      if (bt === mb) info = { won: w === 0, dmg: dA, timeout: res.timeout, oppName: bt.b.name, ghost: bt.ghost };
      else {
        const tag = draw ? '무승부' : `${(w === 0 ? bt.a : bt.b).emoji} 승`;
        others.push(`${bt.a.emoji} ${esc(bt.a.name)} vs ${bt.b.emoji} ${esc(bt.b.name)}${bt.ghost ? '(유령)' : ''} → ${tag}`);
      }
    }
  }
  if (battles[0].pve) others.push(...battles.filter(bt => bt !== mb).map(bt => `${bt.a.emoji} ${esc(bt.a.name)} → ${bt.B.result.winner === 0 ? '몬스터 처치' : '몬스터에게 패배'}`));
  info.B = mb.B; info.others = others;
  G.phase = 'result';
  renderAll();
  const H = human();
  const proceed = () => {
    const out = processEliminations();
    for (const P of out) toast(`${P.emoji} ${P.name} 탈락 (${P.place}위)`, 'bad');
    const alive = G.players.filter(p => p.alive);
    if (!H.alive || alive.length <= 1) {
      G.over = true; G.phase = 'over';
      stopBattle(); renderAll(); showGameOver(H);
      return;
    }
    advanceRound();
    saveGame();
    beginRound();
  };
  showBattleResult(info, () => {
    if (G.pendingSpellPick) {
      G.pendingSpellPick = false;
      showSpellPick(spellOffers(H, 3), id => { if (id) { addSpell(H, id); toast(`${SPELLS[id].icon} ${SPELLS[id].name} 획득`, 'gold'); } proceed(); });
    } else proceed();
  });
}

/* ---------- 공용 선택 라운드 ---------- */
function runCarousel() {
  const r = R();
  const alive = G.players.filter(P => P.alive);
  const n = alive.length + 1;
  const costs = G.stage <= 2 ? [1, 2] : G.stage === 3 ? [2, 3] : G.stage === 4 ? [3, 4] : [4, 5];
  const nSpells = Math.min(2, Math.floor(n / 3));
  const options = [];
  for (let i = 0; i < n - nSpells; i++) {
    const cost = r.pick(costs);
    const ids = Object.keys(UNITS).filter(k => UNITS[k].cost === cost && G.pool[k] > 0);
    if (!ids.length) continue;
    options.push({ kind: 'unit', defId: r.pick(ids), item: r.pick(COMP_KEYS) });
  }
  for (const id of r.shuffle(SPELL_KEYS.slice()).slice(0, nSpells)) options.push({ kind: 'spell', id });
  r.shuffle(options);
  const order = r.shuffle(alive.slice()).sort((a, b) => a.hp - b.hp);
  let idx = 0;
  const take = (P, i) => {
    const o = options[i];
    o.taken = P;
    if (o.kind === 'unit') {
      takeFromPool(o.defId, 1);
      P.items.push(o.item);
      const f = benchFree(P);
      if (f >= 0) { P.bench[f] = makeUnit(o.defId, 1); checkMerge(P); }
      else { P.gold += UNITS[o.defId].cost; G.pool[o.defId]++; }
    } else if (!addSpell(P, o.id)) P.gold += 2;
  };
  const render = () => {
    const cur = order[idx];
    openModal(`<h2>🎠 공용 선택</h2><p class="sub">체력이 낮은 군주부터 하나씩 고릅니다. ${cur ? (cur.isHuman ? '<b style="color:var(--gold)">당신의 차례입니다!</b>' : `${cur.emoji} ${esc(cur.name)} 고르는 중…`) : ''}</p>
      <div class="queue">${order.map((P, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}" title="${esc(P.name)} (${P.hp})">${P.emoji}</span>`).join('')}</div>
      <div class="carousel">${options.map((o, i) => {
        const tk = o.taken ? `<div class="taken-by">${o.taken.emoji} 선택</div>` : '';
        if (o.kind === 'unit') {
          const d = UNITS[o.defId], it = COMPONENTS[o.item];
          return `<div class="choice ${o.taken ? 'disabled' : ''}" data-c="${i}" style="border-color:${COST_COLOR[d.cost]}" data-tip="unit:${o.defId}:1">
            <div class="ci">${d.emoji}</div><div class="cn">${d.name}</div><div class="cd">${d.cost}코스트 · ${it.icon} ${it.name}</div>${tk}</div>`;
        }
        const sp = SPELLS[o.id];
        return `<div class="choice spellc ${o.taken ? 'disabled' : ''}" data-c="${i}" data-tip="spell:${o.id}:1"><div class="ci">${sp.icon}</div><div class="cn">${sp.name}</div><div class="cd">주문 · 마나 ${sp.cost}</div>${tk}</div>`;
      }).join('')}</div>`, box => {
      box.querySelectorAll('[data-c]').forEach(el => el.onclick = () => {
        const i = +el.dataset.c;
        if (!order[idx] || !order[idx].isHuman || options[i].taken) return;
        take(order[idx], i); idx++; render(); renderAll(); setTimeout(step, 350);
      });
    });
  };
  const step = () => {
    if (idx >= order.length) {
      setTimeout(() => { closeModal(); advanceRound(); saveGame(); beginRound(); }, 700);
      return;
    }
    const cur = order[idx];
    render();
    if (cur.isHuman) return;
    setTimeout(() => { take(cur, aiCarouselPick(cur, options)); idx++; render(); step(); }, 420);
  };
  step();
}
