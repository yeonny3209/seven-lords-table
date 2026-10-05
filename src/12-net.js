/* =====================================================================
 * 12. 온라인 대결 — 방(로비), 메시지 전달, 방장 권위 방식 동기화
 *   - 게임 규칙은 방장의 브라우저가 모두 계산한다 (유닛 풀, AI 군주, 전투).
 *   - 손님은 '행동'(구매·배치·주문 등)을 방장에게 보내고, 돌아온 게임 상태를 그대로 그린다.
 *   - 전투는 방장이 진행하면서 매 틱의 스냅샷을 참가자에게 보낸다. 손님은 그 스냅샷으로
 *     전투 객체를 다시 만들어(mirrorBattle) 같은 화면 코드로 그린다.
 *   - 서버(server/server.js)는 방을 만들고 메시지를 전달할 뿐 게임 내용을 모른다.
 * ===================================================================== */

const NET_DEFAULT_SERVER = ''; // 배포한 중계 서버 주소(wss://...). 비워 두면 접속 화면에서 직접 입력
const NET = {
  role: 'off',               // 'off' 혼자 | 'host' 방장 | 'guest' 손님
  ws: null, code: '', slot: 0, peers: {}, lobby: {}, difficulty: 'normal',
  pidOfSlot: {}, slotOfPid: {},   // 방 슬롯 ↔ 게임 속 플레이어 번호
  waiters: {}, nextId: 1, pickWait: null, capture: null, inLobby: false,
};

function netServerUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
    return localStorage.getItem('slt.server') || NET_DEFAULT_SERVER;
  } catch (e) { return NET_DEFAULT_SERVER; }
}
function netStore(k, v) { try { if (v === undefined) return localStorage.getItem('slt.' + k) || ''; localStorage.setItem('slt.' + k, v); } catch (e) { /* 저장 불가 */ } return ''; }

/* ---------- 연결 ---------- */
function netOpen(url, first) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return reject(new Error('서버 주소가 올바르지 않습니다.')); }
    let settled = false;
    const fail = msg => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch (e) { /* 무시 */ } reject(new Error(msg)); };
    const timer = setTimeout(() => fail('서버에 연결할 수 없습니다 (시간 초과).'), 8000);
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!settled) {
        if (m.t === 'hello') { settled = true; clearTimeout(timer); NET.ws = ws; resolve(m); }
        else if (m.t === 'error') fail(m.msg);
        return;
      }
      netOnMsg(m);
    };
    ws.onerror = () => fail('서버에 연결할 수 없습니다.');
    ws.onclose = () => { if (!settled) fail('서버에 연결할 수 없습니다.'); else if (NET.ws === ws) netClosed('서버와 연결이 끊겼습니다.'); };
  });
}
function netRaw(o) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(o)); }
const netSend = d => { if (NET.role === 'guest') netRaw({ t: 'to', d }); };                         // 손님 → 방장
const netBroadcast = d => { if (NET.role === 'host') netRaw({ t: 'to', to: 'all', d }); };          // 방장 → 모두
function netTo(pid, d) { if (NET.role !== 'host') return; const s = NET.slotOfPid[pid]; if (s != null) netRaw({ t: 'to', to: s, d }); }
function netAct(a, p) { netSend({ t: 'act', a, p: p || {} }); return true; }

function netLeave() {
  const ws = NET.ws;
  NET.ws = null; NET.role = 'off'; NET.code = ''; NET.peers = {}; NET.lobby = {}; NET.inLobby = false;
  NET.pidOfSlot = {}; NET.slotOfPid = {}; NET.pickWait = null;
  for (const id in NET.waiters) NET.waiters[id].res(null);
  NET.waiters = {};
  if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* 무시 */ } }
}
function netClosed(reason) {
  const wasInGame = !!G;
  netLeave();
  FLOW.token++;
  cancelTimer(FLOW.iv);
  stopBattle();
  G = null; MY_ID = 0;
  openModal(`<h2>연결 종료</h2><p class="sub">${esc(reason)}</p><div class="row-btns"><button class="primary" id="ncOk">${wasInGame ? '시작 화면으로' : '확인'}</button></div>`,
    box => { box.querySelector('#ncOk').onclick = showTitle; });
}

/* ---------- 원격 플레이어에게 묻고 기다리기 ---------- */
function netPrompt(pid, kind, data, ms) {
  return new Promise(res => {
    const id = NET.nextId++;
    const timer = later(ms, () => { delete NET.waiters[id]; res(null); });
    NET.waiters[id] = { pid, res: v => { cancelTimer(timer); delete NET.waiters[id]; res(v); } };
    netTo(pid, { t: 'prompt', id, kind, data });
  });
}
function netWaitPick(pid, ms) {
  return new Promise(res => {
    const timer = later(ms, () => { NET.pickWait = null; res(null); });
    NET.pickWait = { pid, res: v => { cancelTimer(timer); NET.pickWait = null; res(v); } };
  });
}
function cancelWaiters(pid) {
  for (const id in NET.waiters) if (NET.waiters[id].pid === pid) NET.waiters[id].res(null);
  if (NET.pickWait && NET.pickWait.pid === pid) NET.pickWait.res(null);
}

/* ---------- 상태 동기화 (방장 → 손님) ---------- */
function syncTo(P, extra) { if (NET.role === 'host') netTo(P.id, { t: 'state', g: G, ...extra }); }
function syncAll() { if (NET.role === 'host') for (const P of G.players) if (P.isHuman && P.id !== MY_ID) syncTo(P); }
function netReadyInfo() {
  if (!G || G.phase !== 'prep') return;
  const hs = G.players.filter(p => p.alive && p.isHuman);
  G.readyInfo = [hs.filter(p => p.ready).length, hs.length];
  netBroadcast({ t: 'timer', left: G.prepLeft, rd: G.readyInfo });
  renderTop();
}

/* ---------- 메시지 처리 ---------- */
function netOnMsg(m) {
  if (m.t === 'peer') {
    if (m.joined) { NET.peers[m.slot] = { name: m.name }; if (NET.role === 'host') { NET.lobby[m.slot] = { lord: 'war' }; lobbyBroadcast(); } }
    else { delete NET.peers[m.slot]; if (NET.role === 'host') { delete NET.lobby[m.slot]; onPeerGone(m.slot); lobbyBroadcast(); } }
    if (NET.inLobby) showLobby();
  } else if (m.t === 'closed') netClosed(m.reason || '방이 닫혔습니다.');
  else if (m.t === 'error') toast(m.msg, 'bad');
  else if (m.t === 'from') { if (NET.role === 'host') onHostMsg(m.from, m.d || {}); else onGuestMsg(m.d || {}); }
}

/* ----- 방장이 받는 메시지 ----- */
function findUnitOf(P, uid) { return allUnits(P).find(u => u.uid === uid); }
const ACTS = {
  buy: (P, p) => {
    const slot = p.slot | 0, id = P.shop[slot];
    if (!buyUnit(P, slot)) { if (id && P.gold < UNITS[id].cost) toast('골드가 부족합니다', 'bad'); else if (id) toast('대기석이 가득 찼습니다', 'bad'); }
  },
  sell: (P, p) => {
    const u = findUnitOf(P, p.uid);
    if (!u || (P.board.includes(u) && !boardEditable())) return;
    toast(`판매 +${sellPrice(u)}🪙`); sellUnit(P, u);
  },
  xp: P => { if (G.phase === 'prep') buyXp(P); },
  roll: P => { reroll(P); },
  move: (P, p) => {
    const u = findUnitOf(P, p.uid), to = p.to;
    if (!u || !to || (to.kind !== 'board' && to.kind !== 'bench')) return;
    moveUnit(P, u, null, { kind: to.kind, r: to.r | 0, c: to.c | 0, i: clamp(to.i | 0, 0, CFG.BENCH - 1) });
  },
  equip: (P, p) => {
    const u = findUnitOf(P, p.uid);
    if (!u) return;
    if (P.board.includes(u) && !boardEditable()) { toast('전투 중에는 보드 유닛에 장착할 수 없습니다', 'bad'); return; }
    equipFromInventory(u, p.idx | 0, P);
  },
  unequip: (P, p) => {
    const u = findUnitOf(P, p.uid);
    if (u && (!P.board.includes(u) || boardEditable())) unequipItem(P, u, p.i | 0);
  },
  eqSpell: (P, p) => { if (G.phase === 'prep' && P.spells[p.i | 0]) toggleEquip(P, p.i | 0); },
  upSpell: (P, p) => { if (G.phase === 'prep' && P.spells[p.i | 0]) upgradeSpell(P, p.i | 0); },
  rule: (P, p) => {
    const s = P.spells[p.i | 0];
    if (s && G.phase === 'prep' && (p.v === 'off' || SPELLS[s.id].auto.includes(p.v))) s.rule = p.v;
  },
  ready: P => { if (G.phase === 'prep') { P.ready = true; if (FLOW.checkReady) FLOW.checkReady(); } },
};

function onHostMsg(slot, d) {
  if (d.t === 'lord') { // 로비에서 군주 유형 선택
    if (NET.lobby[slot] && LORD_TYPES[d.lord]) { NET.lobby[slot].lord = d.lord; lobbyBroadcast(); if (NET.inLobby) showLobby(); }
    return;
  }
  const pid = NET.pidOfSlot[slot];
  const P = G && pid != null ? G.players[pid] : null;
  if (!P || !P.isHuman) return;
  if (d.t === 'act') {
    if (!P.alive || G.over || typeof ACTS[d.a] !== 'function') return;
    const toasts = [];
    NET.capture = toasts; // 이 행동이 만든 알림은 방장 화면이 아니라 그 손님에게 보낸다
    try { ACTS[d.a](P, d.p || {}); } finally { NET.capture = null; }
    syncTo(P, { toasts });
    if (P.id === MY_ID) renderAll();
    renderPlayers();
  } else if (d.t === 'reply') {
    const w = NET.waiters[d.id];
    if (w && w.pid === pid) w.res(d.v);
  } else if (d.t === 'pick') {
    if (NET.pickWait && NET.pickWait.pid === pid) NET.pickWait.res(d.i | 0);
  } else if (d.t === 'cast') {
    const L = LIVE.list.find(x => x.bt.viewers.some(([q]) => q.id === pid));
    if (!L || L.B.over) return;
    const side = L.bt.viewers.find(([q]) => q.id === pid)[1];
    const t = d.target && typeof d.target === 'object' ? d.target : {};
    const target = {};
    for (const k of ['uid', 'uid2', 'r', 'c']) if (Number.isFinite(t[k])) target[k] = t[k];
    queueSpell(L.B, side, d.slot | 0, target);
  }
}

// 게임 도중 손님이 나가면 AI가 그 군주를 이어받는다
function onPeerGone(slot) {
  const pid = NET.pidOfSlot[slot];
  if (pid == null || !G) return;
  const P = G.players[pid];
  delete NET.slotOfPid[pid];
  if (!P || !P.isHuman) return;
  P.isHuman = false; P.ready = true; P.pendingSpell = false;
  cancelWaiters(pid);
  toast(`${P.name} 연결 끊김 — AI가 대신 플레이합니다`, 'bad');
  if (FLOW.checkReady) FLOW.checkReady();
  renderAll();
}

/* ----- 손님이 받는 메시지 ----- */
function onGuestMsg(d) {
  switch (d.t) {
    case 'lobby':
      NET.peers = d.peers; NET.lobby = d.lobby; NET.difficulty = d.diff;
      if (NET.inLobby) showLobby();
      break;
    case 'start':
      NET.inLobby = false; MY_ID = d.myId; G = null; closeModal(); stopBattle();
      break;
    case 'state': {
      const prevPhase = G && G.phase;
      G = d.g;
      if (G.phase === 'prep' || G.phase === 'augment' || G.phase === 'carousel') { if (UI.battleView) stopBattle(); }
      renderAll();
      for (const [msg, kind] of (d.toasts || [])) toast(msg, kind);
      if (G.phase === 'prep' && prevPhase !== 'prep') toast(`${roundLabel()} 준비 단계`);
      break;
    }
    case 'timer': if (G) { G.prepLeft = d.left; G.readyInfo = d.rd; renderTop(); } break;
    case 'prompt': showPrompt(d.kind, d.data, v => netSend({ t: 'reply', id: d.id, v })); break;
    case 'carousel':
      if (G && human().alive) showCarousel(d.st, i => netSend({ t: 'pick', i }));
      break;
    case 'carouselEnd': if ($('#modalBox').textContent.includes('공용 선택')) closeModal(); break;
    case 'bstart':
      UI.mySide = d.side; UI.flip = d.side === 1; UI.battleView = true; UI.currentOppId = d.opp; UI.battle = null; UI.aim = null; UI.announced = false;
      renderAll();
      break;
    case 'tick': {
      const B = mirrorBattle(d.b);
      UI.battle = B;
      pushEffects(B, d.ev || []);
      if (B.over && !UI.announced) {
        UI.announced = true; cancelAim();
        toast(B.result.winner === UI.mySide ? '승리!' : B.result.timeout ? '시간 초과' : '패배', B.result.winner === UI.mySide ? 'gold' : 'bad');
      }
      break;
    }
    case 'over': if (G) { stopBattle(); showGameOver(human()); } break;
  }
}

/* ---------- 전투 스냅샷 (방장 → 손님) ---------- */
function snapBattle(B) {
  const r1 = x => Math.round(x * 10) / 10;
  return {
    k: B.tick, over: B.over, w: B.result ? B.result.winner : null, to: B.result ? B.result.timeout : false,
    z: B.zones.map(z => ({ side: z.side, row: z.row, t: r1(z.t) })),
    u: B.units.filter(u => u.alive || u.ghost > 0 || u.reviving > 0).map(u => ({
      i: u.uid, s: u.side, d: u.defId, st: u.star, it: u.items, r: u.r, c: u.c, fr: u.fr, fc: u.fc,
      hp: r1(u.hp), mh: r1(u.maxHp), mn: r1(u.mana), mm: u.manaMax, a: u.alive ? 1 : 0, g: r1(u.ghost), rv: r1(u.reviving),
      sn: r1(u.stun), fz: r1(u.freeze), ud: r1(u.undying), tt: r1(u.taunt), mc: r1(u.moveCd), md: r1(u.moveDur),
      sh: u.shields.map(s => Math.round(s.amt)), bn: u.burn ? 1 : 0, sl: u.slows.map(s => [r1(s.v), s.move ? 1 : 0]), sd: u.sunder ? r1(u.sunder.amp) : 0,
      atk: r1(u.atk), as: u.as, ab: r1(u.asBonus), ar: Math.round(u.armor), mr: Math.round(u.mr), bf: u.buffs.map(b => [b.stat, r1(b.v)]),
      fx: [...u.fx], rg: u.range, cr: r1(u.crit),
    })),
    sd: B.sides.map(S => ({
      lm: r1(S.lm), mx: S.lmMax, lt: S.lordType, cc: S.castCount, ag: [...S.aug], nm: S.name, em: S.emoji,
      sp: S.spells.map(s => ({ id: s.id, lvl: s.lvl, cd: r1(s.cd), used: s.used, rule: s.rule })),
    })),
  };
}
// 스냅샷으로 화면 코드가 읽는 필드만 갖춘 전투 객체를 만든다 (시뮬레이션은 하지 않음)
function mirrorBattle(s) {
  const B = {
    tick: s.k, over: s.over, result: s.over ? { winner: s.w, timeout: s.to } : null, zones: s.z, units: [],
    occ: Array.from({ length: GROWS }, () => new Array(GCOLS).fill(0)), ev: [], log: [], headless: true,
  };
  for (const o of s.u) {
    const d = unitDef(o.d);
    const u = {
      uid: o.i, side: o.s, defId: o.d, d, star: o.st, items: o.it, r: o.r, c: o.c, fr: o.fr, fc: o.fc,
      hp: o.hp, maxHp: o.mh, mana: o.mn, manaMax: o.mm, alive: !!o.a, ghost: o.g, reviving: o.rv,
      stun: o.sn, freeze: o.fz, undying: o.ud, taunt: o.tt, moveCd: o.mc, moveDur: o.md,
      shields: o.sh.map(a => ({ amt: a })), burn: o.bn ? { dps: 0 } : null, slows: o.sl.map(([v, m]) => ({ v, move: !!m })), sunder: o.sd ? { amp: o.sd } : null,
      atk: o.atk, as: o.as, asBonus: o.ab, asStacks: 0, armor: o.ar, mr: o.mr, buffs: o.bf.map(([stat, v]) => ({ stat, v })),
      fx: new Set(o.fx), range: o.rg, crit: o.cr, traits: d.traits || [], summon: !!d.summon, sx: 0, sy: 0,
    };
    B.units.push(u);
    if (u.alive) B.occ[u.r][u.c] = u.uid;
  }
  B.sides = s.sd.map((x, idx) => ({ idx, lm: x.lm, lmMax: x.mx, lordType: x.lt, castCount: x.cc, aug: new Set(x.ag), name: x.nm, emoji: x.em, spells: x.sp, stats: {} }));
  return B;
}

/* ---------- 로비 화면 ---------- */
function lobbyBroadcast() {
  netBroadcast({ t: 'lobby', peers: NET.peers, lobby: NET.lobby, diff: NET.difficulty });
}
function lobbyOrder() { return Object.keys(NET.peers).map(Number).sort((a, b) => a - b); }

function showOnlineMenu() {
  const nick = netStore('name') || '';
  const url = netServerUrl();
  openModal(`<h2>🌐 온라인 대결</h2>
    <p class="sub">같은 방에 최대 8명이 들어와 서로 겨룹니다. 남는 자리는 AI 군주가 채웁니다. 방 만들기는 방장의 컴퓨터가 게임을 진행하므로, 방장은 게임이 끝날 때까지 창을 닫지 마세요.</p>
    <div class="field"><label>서버 주소</label><input id="onUrl" style="flex:1;min-width:220px" placeholder="wss://내서버.onrender.com" value="${esc(url)}"></div>
    <div class="field"><label>닉네임</label><input id="onName" maxlength="12" placeholder="군주" value="${esc(nick)}"></div>
    <div id="onErr" style="color:var(--red);font-size:13px;min-height:18px"></div>
    <div class="field"><label>방 만들기</label><button class="primary" id="onCreate">방 만들기</button></div>
    <div class="field"><label>코드로 입장</label><input id="onCode" maxlength="4" placeholder="ABCD" style="width:90px;text-transform:uppercase"><button id="onJoin">입장</button></div>
    <div class="row-btns"><button id="onBack">뒤로</button></div>`, box => {
    const err = m => { box.querySelector('#onErr').textContent = m || ''; };
    const params = () => {
      const u = box.querySelector('#onUrl').value.trim(), n = box.querySelector('#onName').value.trim() || '군주';
      if (!/^wss?:\/\//i.test(u)) { err('서버 주소는 wss:// 또는 ws:// 로 시작해야 합니다. (서버는 README의 안내대로 직접 배포하세요)'); return null; }
      netStore('server', u); netStore('name', n);
      return { u, n };
    };
    const go = async (first, role) => {
      const p = params(); if (!p) return;
      err('연결 중…');
      box.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const m = await netOpen(p.u, { ...first, name: p.n });
        NET.role = role; NET.code = m.code; NET.slot = m.slot; NET.difficulty = 'normal';
        NET.peers = {}; for (const x of m.peers) NET.peers[x.slot] = { name: x.name };
        NET.lobby = {}; if (role === 'host') NET.lobby[0] = { lord: 'war' };
        showLobby();
      } catch (e) {
        err(e.message); box.querySelectorAll('button').forEach(b => { b.disabled = false; });
      }
    };
    box.querySelector('#onCreate').onclick = () => go({ t: 'create' }, 'host');
    box.querySelector('#onJoin').onclick = () => go({ t: 'join', code: box.querySelector('#onCode').value.trim() }, 'guest');
    box.querySelector('#onBack').onclick = showTitle;
  });
}

function showLobby() {
  NET.inLobby = true;
  const host = NET.role === 'host';
  const slots = lobbyOrder();
  const me = (NET.lobby[NET.slot] || {}).lord || 'war';
  const rows = slots.map((s, i) => {
    const L = NET.lobby[s] ? LORD_TYPES[NET.lobby[s].lord] : null;
    return `<div class="prow ${s === NET.slot ? 'me' : ''}"><div class="pe">${HUMAN_EMOJIS[i]}</div><div class="pm"><div class="pn">${esc((NET.peers[s] || {}).name || '?')} ${s === 0 ? '👑' : ''}</div></div><div class="pv" style="width:auto">${L ? L.icon + ' ' + L.name : ''}</div></div>`;
  }).join('');
  openModal(`<h2>방 코드 <span style="letter-spacing:.2em;color:var(--text)">${esc(NET.code)}</span></h2>
    <p class="sub">친구에게 이 코드를 알려 주세요. 현재 ${slots.length}명 · 남는 ${8 - slots.length}자리는 AI 군주가 채웁니다.</p>
    <div id="lobbyRows">${rows}</div>
    <h3 class="mt">내 군주 유형</h3>
    <div class="choice-grid">${Object.entries(LORD_TYPES).map(([k, L]) => `<div class="choice ${k === me ? 'sel' : ''}" data-lord="${k}"><div class="ci">${L.icon}</div><div class="cn">${L.name}</div><div class="cd">${L.passive}</div></div>`).join('')}</div>
    ${host ? `<div class="field"><label>AI 난이도</label><div class="seg" id="lbDiff">${Object.entries(DIFFICULTY).map(([k, D]) => `<button data-diff="${k}" class="${k === NET.difficulty ? 'on' : ''}">${D.name}</button>`).join('')}</div></div>` : `<p class="sub" style="margin-top:12px">방장이 시작하기를 기다리는 중… (AI 난이도: ${DIFFICULTY[NET.difficulty].name})</p>`}
    <div class="row-btns"><button id="lbLeave">나가기</button>${host ? `<button class="primary" id="lbStart" ${slots.length < 2 ? 'disabled' : ''}>${slots.length < 2 ? '2명 이상 모이면 시작' : '게임 시작'}</button>` : ''}</div>`, box => {
    box.querySelectorAll('[data-lord]').forEach(el => el.onclick = () => {
      const lord = el.dataset.lord;
      if (host) { NET.lobby[0].lord = lord; lobbyBroadcast(); showLobby(); } else netSend({ t: 'lord', lord });
    });
    box.querySelectorAll('[data-diff]').forEach(el => el.onclick = () => { NET.difficulty = el.dataset.diff; lobbyBroadcast(); showLobby(); });
    box.querySelector('#lbLeave').onclick = () => { netLeave(); showTitle(); };
    const st = box.querySelector('#lbStart');
    if (st) st.onclick = hostStartGame;
  });
}

function hostStartGame() {
  const slots = lobbyOrder();
  if (slots.length < 2) return;
  NET.inLobby = false;
  const humans = slots.map(s => ({ name: NET.peers[s].name, lordType: (NET.lobby[s] || {}).lord || 'war', slot: s }));
  NET.pidOfSlot = {}; NET.slotOfPid = {};
  humans.forEach((h, pid) => { NET.pidOfSlot[h.slot] = pid; NET.slotOfPid[pid] = h.slot; });
  netRaw({ t: 'lock', v: true });
  closeModal();
  humans.forEach((h, pid) => { if (pid !== 0) netTo(pid, { t: 'start', myId: pid }); });
  startNewGame({ humans, difficulty: NET.difficulty, seed: 0 });
}
