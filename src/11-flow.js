/* =====================================================================
 * 11. 진행 — 라운드 흐름(비동기), 전투 재생, 공용 선택, 보상, 탈락
 *     혼자 하기와 온라인 방장이 같은 코드를 쓴다 (혼자 = 사람 1명짜리 방).
 *     사람 플레이어에게 묻는 일(증강·주문·결과 확인)은 ask()로 통일:
 *       내 화면이면 모달, 원격 플레이어면 네트워크 메시지, AI면 즉시 null.
 * ===================================================================== */

const PREP_TIME = 60;                  // 온라인 준비 시간(초). 혼자 할 때는 제한 없음
const FLOW = { token: 0, checkReady: null, localPick: null, iv: 0 };
const LIVE = { list: [], res: null, endAt: 0, last: 0 };
// 타이머: 방장이 다른 탭을 보고 있어도 게임이 멈추지 않도록 Web Worker 시계로 돌린다
// (백그라운드 탭의 setTimeout/setInterval은 브라우저가 크게 늦춘다)
const TIMERS = [];
function later(ms, fn) { const t = { at: performance.now() + ms, fn, dead: false, every: 0 }; TIMERS.push(t); return t; }
function everySec(fn) { const t = { at: performance.now() + 1000, fn, dead: false, every: 1000 }; TIMERS.push(t); return t; }
function cancelTimer(t) { if (t) t.dead = true; }
function pumpTimers() {
  const now = performance.now();
  for (const t of TIMERS.slice()) {
    if (t.dead || now < t.at) continue;
    if (t.every) t.at += t.every; else t.dead = true;
    t.fn();
  }
  for (let i = TIMERS.length - 1; i >= 0; i--) if (TIMERS[i].dead) TIMERS.splice(i, 1);
}
const sleep = ms => new Promise(r => later(ms, r));
// 진행 중 게임이 바뀌었으면(시작 화면으로 나감 등) 이어서 실행하지 않고 중단
const W = async (p, tok) => { const v = await p; if (tok !== FLOW.token) throw 'aborted'; return v; };

function startNewGame(opts) {
  stopBattle();
  MY_ID = 0;
  newGame(opts);
  if (NET.role === 'off') clearSave();
  runGame();
}
function continueGame(saved) {
  stopBattle();
  MY_ID = 0;
  G = saved;
  runGame();
}
function stopBattle() {
  UI.battle = null; UI.battleView = false; UI.aim = null; UI.pending = null; UI.currentOppId = null;
  UI.mySide = 0; UI.flip = false;
  LIVE.list = []; LIVE.endAt = 0;
  FX.floats = []; FX.projs = []; FX.flashes = []; FX.texts = [];
  $('#aimHint').textContent = '';
}
// 진행 중인 게임을 버리고 시작 화면으로
function leaveToTitle() {
  if (NET.role === 'off' && G && !G.over && G.phase === 'prep') saveGame();
  FLOW.token++;
  cancelTimer(FLOW.iv);
  FLOW.checkReady = null; FLOW.localPick = null;
  netLeave();
  stopBattle();
  if (NET.role === 'off') MY_ID = 0;
  G = null;
  showTitle();
}

async function runGame() {
  const tok = ++FLOW.token;
  try {
    while (G && !G.over) {
      const type = roundType(G.stage, G.round);
      if (type === 'carousel') await carouselRound(tok); else await playRound(type, tok);
      if (G.over) break;
      advanceRound();
      if (NET.role === 'off') saveGame();
    }
  } catch (e) {
    if (e !== 'aborted') { console.error(e); toast('오류가 발생했습니다: ' + (e && e.message), 'bad'); }
  }
}

/* ---------- 사람에게 묻기 ---------- */
function ask(P, kind, data) {
  if (!P.alive || !P.isHuman) return Promise.resolve(null);
  if (P.id === MY_ID) return new Promise(res => showPrompt(kind, data, res));
  return netPrompt(P.id, kind, data, kind === 'result' ? 30000 : 40000);
}
function showPrompt(kind, data, done) {
  if (kind === 'augment') showAugmentPick(data.offers, done);
  else if (kind === 'spell') showSpellPick(data.ids, done);
  else if (kind === 'result') showBattleResult(data, () => done(true));
}

/* ---------- 한 라운드 ---------- */
async function playRound(type, tok) {
  stopBattle();
  startPrep();
  for (const P of G.players) P.ready = false;
  if (augmentDue()) await augmentStage(tok);
  G.phase = 'prep';
  G.prepLeft = NET.role === 'off' ? 0 : PREP_TIME;
  syncAll(); renderAll();
  toast(`${roundLabel()} 준비 단계 — ${type === 'pve' ? '중립 몬스터' : '대전'}`);
  await W(prepWait(), tok);
  await W(battleRound(type, tok), tok);
}

async function augmentStage(tok) {
  G.phase = 'augment';
  syncAll(); renderAll();
  const jobs = [];
  for (const P of G.players) {
    if (!P.alive) continue;
    if (P.isHuman) jobs.push(humanAugment(P));
    else applyAugment(P, aiPickAugment(P, augmentOffers(P)));
  }
  await W(Promise.all(jobs), tok);
}
async function humanAugment(P) {
  const offers = augmentOffers(P);
  const resp = await ask(P, 'augment', { offers });
  applyAugment(P, offers.find(o => resp && o.id === resp.id && o.param === resp.param) || offers[0]);
  await humanSpellReward(P);
  syncTo(P);
}
// 주문 보상(몬스터 라운드 승리, 주문 증강)을 받을 차례면 3장 중 하나 고르게 한다
async function humanSpellReward(P) {
  if (!P.pendingSpell) return;
  P.pendingSpell = false;
  const ids = spellOffers(P, 3);
  if (!ids.length) return;
  const pick = await ask(P, 'spell', { ids });
  const id = ids.includes(pick) ? pick : ids[0];
  if (addSpell(P, id) && P.id === MY_ID) toast(`${SPELLS[id].icon} ${SPELLS[id].name} 획득`, 'gold');
}

// 모든 사람이 '준비 완료'를 누르거나 시간이 다 될 때까지 기다린다
function prepWait() {
  return new Promise(res => {
    const humans = () => G.players.filter(p => p.alive && p.isHuman);
    let left = G.prepLeft;
    const finish = () => { cancelTimer(FLOW.iv); FLOW.checkReady = null; G.prepLeft = 0; res(); };
    FLOW.checkReady = () => { if (humans().every(p => p.ready)) finish(); else netReadyInfo(); };
    cancelTimer(FLOW.iv);
    if (left > 0) FLOW.iv = everySec(() => {
      left--; G.prepLeft = left; netReadyInfo(); renderTop();
      if (left <= 0) { for (const p of humans()) p.ready = true; finish(); }
    });
    netReadyInfo();
    FLOW.checkReady();
  });
}
function onReady() {
  if (!G || G.phase !== 'prep' || modalOpen()) return;
  const P = human();
  if (!P.alive || P.ready) return;
  P.ready = true;
  if (NET.role === 'guest') netAct('ready');
  else if (FLOW.checkReady) FLOW.checkReady();
  renderTop();
}

/* ---------- 전투 ---------- */
function trimBoard(P) {
  while (P.board.length > boardLimit(P)) {
    const u = P.board.pop();
    const f = benchFree(P);
    if (f >= 0) P.bench[f] = u; else sellUnit(P, u);
  }
}

async function battleRound(type, tok) {
  for (const P of G.players) if (P.alive && P.isHuman) trimBoard(P);
  for (const A of G.players) if (A.alive && !A.isHuman) aiPrep(A);
  const seedBase = R().int(2 ** 30);
  const battles = [];
  if (type === 'pve') { for (const A of G.players) if (A.alive) battles.push({ a: A, b: null, pve: true }); }
  else for (const [a, b, ghost] of makePairs()) battles.push({ a, b, ghost: !!ghost });
  // 사람과 AI의 대전에서는 항상 사람이 a(아래쪽 진영)
  for (const bt of battles) if (bt.b && !bt.a.isHuman && bt.b.isHuman && !bt.ghost) [bt.a, bt.b] = [bt.b, bt.a];
  battles.forEach((bt, i) => { bt.seed = seedBase + i * 7919; });

  const instant = NET.role === 'off' && G.instant;
  const live = [];
  for (const bt of battles) {
    bt.viewers = [];
    if (bt.a.isHuman) bt.viewers.push([bt.a, 0]);
    if (bt.b && bt.b.isHuman && !bt.ghost) bt.viewers.push([bt.b, 1]);
    const sa = specOf(bt.a, { forceAuto: instant && bt.a.isHuman });
    const sb = bt.b ? specOf(bt.b) : monsterSpec();
    if (bt.viewers.length && !instant) { bt.B = createBattle(sa, sb, bt.seed); live.push(bt); }
    else bt.B = runBattle(sa, sb, bt.seed);
  }
  G.phase = 'battle'; G.prepLeft = 0;
  syncAll(); renderAll();
  if (live.length) await W(liveRun(live), tok);
  await W(finishRound(battles, tok), tok);
}

// 사람이 참여하는 전투들을 실시간으로 진행한다 (방장 컴퓨터가 모두 계산)
function liveRun(list) {
  return new Promise(res => {
    LIVE.list = list.map(bt => ({ bt, B: bt.B, acc: 0, announced: false }));
    LIVE.res = res; LIVE.endAt = 0; LIVE.last = performance.now();
    for (const L of LIVE.list) {
      const { bt } = L;
      for (const [P, side] of bt.viewers) {
        const opp = (side === 0 ? bt.b : bt.a);
        if (P.id === MY_ID) {
          UI.battle = L.B; UI.mySide = side; UI.flip = side === 1; UI.battleView = true;
          UI.currentOppId = opp ? opp.id : null; UI.acc = 0; UI.aim = null;
        } else netTo(P.id, { t: 'bstart', side, opp: opp ? opp.id : null });
      }
      dispatchEv(L);
    }
    renderAll();
  });
}
// 한 틱의 결과를 화면 효과와 원격 관전자에게 전달
function dispatchEv(L) {
  const B = L.B;
  if (B === UI.battle) pushEffects(B, B.ev);
  if (NET.role === 'host') {
    let snap = null;
    for (const [P] of L.bt.viewers) if (P.id !== MY_ID && P.isHuman) {
      snap = snap || snapBattle(B);
      netTo(P.id, { t: 'tick', b: snap, ev: B.ev });
    }
  }
  B.ev = [];
}
function liveFrame() {
  if (!LIVE.list.length) return;
  const now = performance.now();
  const el = Math.min((now - LIVE.last) / 1000, NET.role === 'off' ? 0.1 : 5);
  LIVE.last = now;
  for (const L of LIVE.list) {
    const B = L.B;
    if (B.over) continue;
    const mine = B === UI.battle;
    const spd = NET.role === 'off' ? G.battleSpeed * (mine && UI.aim ? 0.25 : 1) : 1;
    L.acc += el * spd;
    let steps = 0;
    while (L.acc >= CFG.TICK && steps < 60 && !B.over) { L.acc -= CFG.TICK; steps++; stepBattle(B); dispatchEv(L); }
    if (B.over && !L.announced) {
      L.announced = true;
      if (mine) { cancelAim(); toast(B.result.winner === UI.mySide ? '승리!' : B.result.timeout ? '시간 초과' : '패배', B.result.winner === UI.mySide ? 'gold' : 'bad'); }
      dispatchEv(L);
    }
  }
  if (!LIVE.endAt && LIVE.list.every(L => L.B.over)) LIVE.endAt = now + 1100;
  if (LIVE.endAt && now >= LIVE.endAt) { const r = LIVE.res; LIVE.endAt = 0; LIVE.res = null; r && r(); }
}
// 시계: Worker가 50ms마다 신호를 주면 전투와 타이머를 진행 (Worker를 못 쓰는 환경은 setInterval)
(function startClock() {
  const tick = () => { liveFrame(); pumpTimers(); };
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},50)'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = tick;
    w.onerror = () => setInterval(tick, 50);
  } catch (e) { setInterval(tick, 50); }
})();

// 화면 그리기 루프 (전투 진행은 liveFrame이 맡는다)
let lastBarUpdate = 0;
function frame(now) {
  UI.frameDt = Math.min(0.05, ((now - UI.lastFrame) / 1000) || 0.016);
  UI.lastFrame = now;
  const B = UI.battle;
  if (B && UI.battleView && UI.aim && !B.over && !UI.aim.first && !spellReady(B.sides[UI.mySide], UI.aim.slot)) cancelAim();
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
    if (P.isHuman) P.pendingSpell = true;
    else { const ids = spellOffers(P, 3); if (ids.length) addSpell(P, aiPickSpell(P, ids)); }
    got.push('📜 새 주문');
  }
  return got.join(' · ');
}

async function finishRound(battles, tok) {
  const base = stageBaseDamage(G.stage);
  const infos = {}, lines = [];
  for (const bt of battles) {
    const res = bt.B.result;
    if (bt.pve) {
      const won = res.winner === 0;
      const dmg = won ? 0 : Math.max(1, base + survivorDamage(res.survivors[1]));
      applyResult(bt.a, won, dmg, false, '중립 몬스터');
      const rw = pveRewards(bt.a, won);
      if (bt.a.isHuman) infos[bt.a.id] = { ...battleInfo(bt.B, 0), won, dmg: bt.a.lastResult.dmg, timeout: res.timeout, oppName: '중립 몬스터', rewards: rw, bt };
      lines.push({ bt, text: `${bt.a.emoji} ${esc(bt.a.name)} → ${won ? '몬스터 처치' : '몬스터에게 패배'}` });
    } else {
      const w = res.winner;
      const draw = res.timeout || w === -1;
      const dA = draw ? Math.max(1, base) : base + survivorDamage(res.survivors[1]);
      const dB = draw ? Math.max(1, base) : base + survivorDamage(res.survivors[0]);
      applyResult(bt.a, w === 0, dA, true, bt.b.name);
      if (!bt.ghost) applyResult(bt.b, w === 1, dB, true, bt.a.name);
      if (bt.a.isHuman) infos[bt.a.id] = { ...battleInfo(bt.B, 0), won: w === 0, dmg: bt.a.lastResult.dmg, timeout: res.timeout, oppName: bt.b.name, ghost: bt.ghost, bt };
      if (bt.b.isHuman && !bt.ghost) infos[bt.b.id] = { ...battleInfo(bt.B, 1), won: w === 1, dmg: bt.b.lastResult.dmg, timeout: res.timeout, oppName: bt.a.name, bt };
      const tag = draw ? '무승부' : `${(w === 0 ? bt.a : bt.b).emoji} 승`;
      lines.push({ bt, text: `${bt.a.emoji} ${esc(bt.a.name)} vs ${bt.b.emoji} ${esc(bt.b.name)}${bt.ghost ? '(유령)' : ''} → ${tag}` });
    }
  }
  G.phase = 'result';
  syncAll(); renderAll();

  // 사람마다 결과를 보여 주고 주문 보상을 고르게 한다 (동시에 진행)
  const jobs = [];
  for (const P of G.players) {
    if (!P.alive || !P.isHuman || !infos[P.id]) continue;
    jobs.push((async () => {
      const { bt, ...info } = infos[P.id];
      info.others = lines.filter(l => l.bt !== bt).map(l => l.text);
      await ask(P, 'result', info);
      await humanSpellReward(P);
      syncTo(P);
    })());
  }
  await W(Promise.all(jobs), tok);

  const out = processEliminations();
  for (const P of out) toast(`${P.emoji} ${P.name} 탈락 (${P.place}위)`, 'bad');
  const alive = G.players.filter(p => p.alive);
  const over = alive.length <= 1 || !alive.some(p => p.isHuman);
  if (over) { G.over = true; G.phase = 'over'; }
  syncAll();
  stopBattle(); renderAll();
  for (const P of G.players) {
    if (!P.isHuman || !(out.includes(P) || (over && P.alive))) continue;
    if (P.id === MY_ID) showGameOver(P); else netTo(P.id, { t: 'over' });
  }
}

/* ---------- 공용 선택 라운드 ---------- */
async function carouselRound(tok) {
  const r = R();
  G.phase = 'carousel';
  const alive = G.players.filter(P => P.alive);
  const n = alive.length + 1;
  const costs = G.stage <= 2 ? [1, 2] : G.stage === 3 ? [2, 3] : G.stage === 4 ? [3, 4] : [4, 5];
  const nSpells = Math.min(2, Math.floor(n / 3));
  const options = [];
  for (let i = 0; i < n - nSpells; i++) {
    const cost = r.pick(costs);
    const ids = Object.keys(UNITS).filter(k => UNITS[k].cost === cost && G.pool[k] > 0);
    if (!ids.length) continue;
    options.push({ kind: 'unit', defId: r.pick(ids), item: r.pick(COMP_KEYS), taken: false, takenBy: null });
  }
  for (const id of r.shuffle(SPELL_KEYS.slice()).slice(0, nSpells)) options.push({ kind: 'spell', id, taken: false, takenBy: null });
  r.shuffle(options);
  const order = r.shuffle(alive.slice()).sort((a, b) => a.hp - b.hp);
  const st = { options, order: order.map(P => P.id), idx: 0 };
  const take = (P, i) => {
    const o = options[i];
    o.taken = true; o.takenBy = P.id;
    if (o.kind === 'unit') {
      takeFromPool(o.defId, 1);
      P.items.push(o.item);
      const f = benchFree(P);
      if (f >= 0) { P.bench[f] = makeUnit(o.defId, 1); checkMerge(P); }
      else { P.gold += UNITS[o.defId].cost; G.pool[o.defId]++; }
    } else if (!addSpell(P, o.id)) P.gold += 2;
  };
  const show = () => {
    netBroadcast({ t: 'carousel', st });
    if (human().alive) showCarousel(st, i => FLOW.localPick && FLOW.localPick(i));
  };
  syncAll(); renderAll();
  for (let k = 0; k < order.length; k++) {
    st.idx = k;
    const cur = order[k];
    show();
    let pick;
    if (!cur.isHuman) { await W(sleep(420), tok); pick = aiCarouselPick(cur, options); }
    else {
      const free = options.map((o, i) => i).filter(i => !options[i].taken);
      const p = cur.id === MY_ID
        ? new Promise(res => { FLOW.localPick = i => { FLOW.localPick = null; res(i); }; })
        : netWaitPick(cur.id, 25000);
      const v = await W(p, tok);
      pick = free.includes(v) ? v : free[0];
    }
    take(cur, pick);
    syncAll(); renderAll();
  }
  st.idx = order.length;
  show();
  await W(sleep(700), tok);
  netBroadcast({ t: 'carouselEnd' });
  if ($('#modalBox').textContent.includes('공용 선택')) closeModal();
  syncAll(); renderAll();
}
