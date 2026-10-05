/* =====================================================================
 * 08. 화면 그리기 — 캔버스 보드, 유닛, 체력·마나바, 공격 이펙트, 피해 숫자
 * ===================================================================== */

const VIEW = { CELL: 64, W: 448, BOARD_H: 512, GAP: 14, BENCH_H: 58 };
VIEW.H = VIEW.BOARD_H + VIEW.GAP + VIEW.BENCH_H;
VIEW.BENCH_Y = VIEW.BOARD_H + VIEW.GAP;
VIEW.BENCH_W = VIEW.W / CFG.BENCH;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
let DPR = 1;
function resizeCanvas() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = VIEW.W * DPR; canvas.height = VIEW.H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

// 전투 연출 상태
const FX = { floats: [], projs: [], flashes: [], texts: [], shake: 0 };
const UI = {
  mySide: 0, flip: false, // 지금 보는 전투에서 내가 속한 진영
  hover: null,          // {kind:'board'|'bench', r, c, i}
  drag: null,           // {unit, from, x, y} 또는 {item, idx}
  aim: null,            // {slot, step, first}
  aimHover: null,
  battle: null,         // 진행 중인 전투 B
  battleView: false,
  lastFrame: 0, acc: 0,
};

// 전투 화면에서 위쪽 진영(side 1)의 플레이어는 보드를 180도 돌려서 본다 → 항상 내 유닛이 아래
const flipped = () => UI.flip && UI.battleView;
const vr = r => (flipped() ? GROWS - 1 - r : r);
const vc = c => (flipped() ? GCOLS - 1 - c : c);
function cellCenter(r, c) { return [vc(c) * VIEW.CELL + VIEW.CELL / 2, vr(r) * VIEW.CELL + VIEW.CELL / 2]; }
function benchCenter(i) { return [i * VIEW.BENCH_W + VIEW.BENCH_W / 2, VIEW.BENCH_Y + VIEW.BENCH_H / 2]; }

function unitScreenPos(u) {
  let p = 1;
  if (u.moveCd > 0 && u.moveDur > 0) p = 1 - u.moveCd / u.moveDur;
  const [x0, y0] = cellCenter(u.fr, u.fc), [x1, y1] = cellCenter(u.r, u.c);
  return [x0 + (x1 - x0) * p, y0 + (y1 - y0) * p];
}

/* ---------- 메인 그리기 ---------- */
function draw(now) {
  ctx.clearRect(0, 0, VIEW.W, VIEW.H);
  drawBoardBg();
  if (UI.battleView && UI.battle) drawBattle(UI.battle);
  else drawPrep();
  drawBench();
  drawEffects();
  if (UI.drag && UI.drag.unit) drawDragGhostHint();
}

function drawBoardBg() {
  const C = VIEW.CELL;
  for (let r = 0; r < GROWS; r++) for (let c = 0; c < GCOLS; c++) {
    const mine = r >= 4;
    const dark = (r + c) % 2 === 0;
    ctx.fillStyle = mine ? (dark ? '#3a2e24' : '#33291f') : (dark ? '#2b2420' : '#26201c');
    ctx.fillRect(c * C, r * C, C, C);
  }
  // 중앙선
  ctx.fillStyle = '#f2c14e33';
  ctx.fillRect(0, 4 * C - 1, VIEW.W, 2);
  ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1;
  for (let r = 0; r <= GROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * C + .5); ctx.lineTo(VIEW.W, r * C + .5); ctx.stroke(); }
  for (let c = 0; c <= GCOLS; c++) { ctx.beginPath(); ctx.moveTo(c * C + .5, 0); ctx.lineTo(c * C + .5, VIEW.BOARD_H); ctx.stroke(); }
}

function drawPrep() {
  const P = human();
  // 상대 진영 안내
  ctx.fillStyle = '#ffffff10';
  ctx.font = '600 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a8987f88';
  const t = roundType(G.stage, G.round);
  ctx.fillText(t === 'pve' ? '👾 중립 몬스터가 기다린다' : '⚔️ 상대 군주 진영', VIEW.W / 2, 2 * VIEW.CELL);
  ctx.font = '12px sans-serif';
  ctx.fillText(`보드 ${P.board.length} / ${boardLimit(P)}`, VIEW.W / 2, 2 * VIEW.CELL + 22);
  // 드래그 중 놓을 수 있는 칸 강조
  if (UI.drag && UI.drag.unit) {
    for (let r = 0; r < CFG.ROWS; r++) for (let c = 0; c < CFG.COLS; c++) {
      const [gr, gc] = toGlobal(0, r, c);
      ctx.fillStyle = '#f2c14e14';
      ctx.fillRect(gc * VIEW.CELL + 2, gr * VIEW.CELL + 2, VIEW.CELL - 4, VIEW.CELL - 4);
    }
  }
  if (UI.hover && UI.hover.kind === 'board' && UI.drag) {
    ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2;
    ctx.strokeRect(UI.hover.c * VIEW.CELL + 2, UI.hover.r * VIEW.CELL + 2, VIEW.CELL - 4, VIEW.CELL - 4);
  }
  for (const u of P.board) {
    if (UI.drag && UI.drag.unit === u) continue;
    const [gr, gc] = toGlobal(0, u.r, u.c);
    const [x, y] = cellCenter(gr, gc);
    drawUnitToken(x, y, 25, u, { side: 0 });
  }
}

function drawBench() {
  const P = human();
  ctx.fillStyle = '#1a1512';
  ctx.fillRect(0, VIEW.BENCH_Y, VIEW.W, VIEW.BENCH_H);
  for (let i = 0; i < CFG.BENCH; i++) {
    const x = i * VIEW.BENCH_W;
    ctx.fillStyle = (UI.hover && UI.hover.kind === 'bench' && UI.hover.i === i && UI.drag) ? '#4a3a26' : '#2a221d';
    roundRect(x + 2, VIEW.BENCH_Y + 3, VIEW.BENCH_W - 4, VIEW.BENCH_H - 6, 7); ctx.fill();
    const u = P.bench[i];
    if (u && !(UI.drag && UI.drag.unit === u)) {
      const [cx, cy] = benchCenter(i);
      drawUnitToken(cx, cy - 2, 19, u, { side: 0, small: true });
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// 유닛 토큰: 코스트 색 테두리 + 이모지 + 별
function drawUnitToken(x, y, rad, u, o = {}) {
  const d = unitDef(u.defId);
  const col = d.cost ? COST_COLOR[d.cost] : '#777';
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = o.side === 1 ? '#3a1d1d' : '#1d2a3a'; // side: 0 = 아군, 1 = 적군
  ctx.fill();
  ctx.lineWidth = o.small ? 2.5 : 3.5; ctx.strokeStyle = col; ctx.stroke();
  if (o.side === 1) { ctx.lineWidth = 1.5; ctx.strokeStyle = '#ff5f5f'; ctx.beginPath(); ctx.arc(x, y, rad + 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.font = `${Math.round(rad * 1.15)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.emoji, x, y + 1);
  // 별
  if (u.star > 1) {
    ctx.font = `bold ${o.small ? 9 : 11}px sans-serif`;
    ctx.fillStyle = u.star === 3 ? '#ffd84a' : '#d8e6ff';
    ctx.fillText('★'.repeat(u.star), x, y - rad - (o.small ? 4 : 6));
  }
  // 아이템
  if (u.items && u.items.length) {
    ctx.font = `${o.small ? 9 : 11}px "Segoe UI Emoji",sans-serif`;
    const n = u.items.length, w = o.small ? 10 : 13;
    u.items.forEach((it, i) => ctx.fillText(itemInfo(it).icon, x - (n - 1) * w / 2 + i * w, y + rad + (o.small ? 4 : 7)));
  }
  ctx.restore();
}

/* ---------- 전투 ---------- */
function drawBattle(B) {
  // 화염 지대
  for (const z of B.zones) {
    ctx.fillStyle = `rgba(255,90,30,${0.18 + 0.08 * Math.sin(performance.now() / 120)})`;
    ctx.fillRect(0, vr(z.row) * VIEW.CELL, VIEW.W, VIEW.CELL);
    ctx.font = '14px sans-serif';
    for (let c = 0; c < GCOLS; c++) ctx.fillText('🔥', c * VIEW.CELL + 12, vr(z.row) * VIEW.CELL + 14);
  }
  drawAimOverlay(B);
  const list = B.units.filter(u => u.alive || u.ghost > 0 || u.reviving > 0);
  list.sort((a, b) => a.r - b.r);
  for (const u of list) {
    const [x, y] = unitScreenPos(u);
    u.sx = x; u.sy = y;
    const alpha = u.ghost > 0 ? 0.45 : u.reviving > 0 ? 0.3 : 1;
    const isAimTarget = UI.aimHover && UI.aimHover.uid === u.uid;
    if (u.undying > 0) glow(x, y, 30, '#ffd84a');
    if (u.taunt > 0) glow(x, y, 30, '#ff8f5a');
    if (isAimTarget) glow(x, y, 32, '#f2c14e');
    drawUnitToken(x, y, 23, u, { side: u.side === UI.mySide ? 0 : 1, alpha });
    if (u.freeze > 0) { ctx.fillStyle = '#8fd8ff66'; ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.fill(); }
    if (u.ghost <= 0 && u.reviving <= 0) drawBars(u, x, y);
    // 상태 아이콘
    const icons = [];
    if (u.stun > 0) icons.push('💫');
    if (u.burn) icons.push('🔥');
    if (u.slows.length) icons.push('🧊');
    if (u.sunder) icons.push('🎯');
    if (u.taunt > 0) icons.push('🚩');
    if (icons.length) { ctx.font = '11px "Segoe UI Emoji",sans-serif'; ctx.fillText(icons.join(''), x + 18, y - 22); }
  }
}
function glow(x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
  g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function drawBars(u, x, y) {
  const w = 44, h = 5, bx = x - w / 2, by = y - 33;
  const shield = sum(u.shields.map(s => s.amt));
  const tot = Math.max(u.maxHp, u.hp + shield);
  ctx.fillStyle = '#000a'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
  ctx.fillStyle = u.side === UI.mySide ? '#59d97a' : '#ff5f5f';
  ctx.fillRect(bx, by, w * (u.hp / tot), h);
  if (shield > 0) { ctx.fillStyle = '#e8f0ff'; ctx.fillRect(bx + w * (u.hp / tot), by, w * (shield / tot), h); }
  // 체력 눈금 (300마다)
  ctx.fillStyle = '#0006';
  for (let v = 300; v < tot; v += 300) ctx.fillRect(bx + w * (v / tot), by, 1, h);
  if (u.d.skill) {
    ctx.fillStyle = '#000a'; ctx.fillRect(bx - 1, by + h + 1, w + 2, 4);
    ctx.fillStyle = '#5aa9ff'; ctx.fillRect(bx, by + h + 2, w * clamp(u.mana / u.manaMax, 0, 1), 2);
  }
}

function drawAimOverlay(B) {
  if (!UI.aim) return;
  const S = B.sides[UI.mySide];
  const sl = S.spells[UI.aim.slot];
  const sp = SPELLS[sl.id];
  const h = UI.aimHover;
  if (sp.target === 'row' && h && h.r != null) {
    ctx.fillStyle = '#ff7a3044'; ctx.fillRect(0, vr(h.r) * VIEW.CELL, VIEW.W, VIEW.CELL);
  }
  if ((sp.target === 'cell') && h && h.r != null) {
    ctx.fillStyle = '#7cc6ff33';
    ctx.fillRect((vc(h.c) - 1) * VIEW.CELL, (vr(h.r) - 1) * VIEW.CELL, VIEW.CELL * 3, VIEW.CELL * 3);
    ctx.strokeStyle = '#7cc6ff'; ctx.lineWidth = 2;
    ctx.strokeRect((vc(h.c) - 1) * VIEW.CELL, (vr(h.r) - 1) * VIEW.CELL, VIEW.CELL * 3, VIEW.CELL * 3);
  }
  if (sp.target === 'allyCell' && UI.aim.first && h && h.r != null && !B.occ[h.r][h.c]) {
    ctx.strokeStyle = '#b07cff'; ctx.lineWidth = 2;
    ctx.strokeRect(vc(h.c) * VIEW.CELL + 3, vr(h.r) * VIEW.CELL + 3, VIEW.CELL - 6, VIEW.CELL - 6);
  }
  if (UI.aim.first) {
    const a = unitByUid(B, UI.aim.first);
    if (a) glow(a.sx || 0, a.sy || 0, 34, '#b07cff');
  }
}

/* ---------- 이펙트 ---------- */
function pushEffects(B, events) {
  const pos = uid => { const u = unitByUid(B, uid); return u ? unitScreenPos(u) : null; };
  for (const e of events) {
    switch (e.t) {
      case 'atk': {
        const a = pos(e.uid), b = pos(e.tuid);
        if (!a || !b) break;
        if (e.ranged) FX.projs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], t: 0, dur: 0.18, color: e.ghost ? '#c9a6ff' : '#fff2b0' });
        else FX.flashes.push({ x: b[0], y: b[1], t: 0, dur: 0.15, kind: 'slash' });
        break;
      }
      case 'zap': case 'skillHit': {
        const a = pos(e.uid), b = pos(e.tuid);
        if (a && b) FX.projs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], t: 0, dur: 0.22, color: e.t === 'zap' ? '#8fd0ff' : '#d58cff', big: true });
        break;
      }
      case 'dmg': {
        const p = pos(e.uid); if (!p) break;
        if (e.a < 1) break;
        const big = e.a >= 250 || e.crit;
        FX.floats.push({ x: p[0] + (Math.random() - .5) * 16, y: p[1] - 10, text: Math.round(e.a) + (e.crit ? '!' : ''), color: e.spell ? '#7cc6ff' : e.kind === 'magic' ? '#d58cff' : e.kind === 'true' ? '#ffffff' : (e.crit ? '#ffd84a' : '#ffb27a'), size: big ? 17 : 12, t: 0, dur: 0.8 });
        break;
      }
      case 'heal': { const p = pos(e.uid); if (p) FX.floats.push({ x: p[0], y: p[1] - 14, text: '+' + Math.round(e.a), color: '#59d97a', size: 12, t: 0, dur: 0.8 }); break; }
      case 'shield': { const p = pos(e.uid); if (p) FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.4, kind: 'ring', color: '#e8f0ff' }); break; }
      case 'stun': { const p = pos(e.uid); if (p) FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.3, kind: 'ring', color: '#ffd84a' }); break; }
      case 'skill': {
        const p = pos(e.uid); if (!p) break;
        FX.texts.push({ x: p[0], y: p[1] - 40, text: e.name, color: '#d6b4ff', t: 0, dur: 1.1 });
        FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.35, kind: 'ring', color: '#b07cff' });
        break;
      }
      case 'spell': showSpellBanner(e); {
        const t = e.target || {};
        if (t.uid != null) { const p = pos(t.uid); if (p) FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.6, kind: 'burst', color: e.side === UI.mySide ? '#7cc6ff' : '#ff6b6b' }); }
        if (t.r != null && t.c != null && t.uid == null) { const [x, y] = cellCenter(t.r, t.c); FX.flashes.push({ x, y, t: 0, dur: 0.6, kind: 'burst', color: '#7cc6ff', size: 90 }); }
        if (e.id === 'timestop') FX.shake = 0.3;
        break;
      }
      case 'death': { const p = pos(e.uid); if (p) FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.5, kind: 'burst', color: '#ffffff' }); break; }
      case 'execute': { const p = pos(e.uid); if (p) FX.texts.push({ x: p[0], y: p[1] - 30, text: '처형!', color: '#ff5f5f', t: 0, dur: 1 }); break; }
      case 'leap': case 'blink': { const p = pos(e.uid); if (p) FX.flashes.push({ x: p[0], y: p[1], t: 0, dur: 0.4, kind: 'ring', color: '#ff8f5a' }); break; }
      case 'ghost': { const p = pos(e.uid); if (p) FX.texts.push({ x: p[0], y: p[1] - 30, text: '유령화', color: '#c9a6ff', t: 0, dur: 0.9 }); break; }
      case 'reviveStart': { const p = pos(e.uid); if (p) FX.texts.push({ x: p[0], y: p[1] - 30, text: '부활 중', color: '#fff2b0', t: 0, dur: 1 }); break; }
      case 'laststand': { const p = pos(e.uid); if (p) FX.texts.push({ x: p[0], y: p[1] - 30, text: '최후의 저항!', color: '#ff8f5a', t: 0, dur: 1.2 }); break; }
      case 'overtime': FX.texts.push({ x: VIEW.W / 2, y: VIEW.BOARD_H / 2, text: '⏱ 연장전 — 피해 증가', color: '#ffd84a', t: 0, dur: 1.8 }); break;
      case 'miss': { const p = pos(e.uid); if (p) FX.floats.push({ x: p[0], y: p[1] - 10, text: '회피', color: '#cccccc', size: 11, t: 0, dur: 0.6 }); break; }
    }
  }
}

function drawEffects() {
  const dt = UI.frameDt || 0.016;
  for (const p of FX.projs) {
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    const x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(x, y, p.big ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    if (p.big) { ctx.strokeStyle = p.color + '88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x0 + (p.x1 - p.x0) * Math.max(0, k - .3), p.y0 + (p.y1 - p.y0) * Math.max(0, k - .3)); ctx.lineTo(x, y); ctx.stroke(); }
  }
  FX.projs = FX.projs.filter(p => p.t < p.dur);
  for (const f of FX.flashes) {
    f.t += dt;
    const k = f.t / f.dur;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k);
    if (f.kind === 'slash') {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(f.x - 12, f.y - 12 + k * 6); ctx.lineTo(f.x + 12, f.y + 12 - k * 6); ctx.stroke();
    } else if (f.kind === 'ring') {
      ctx.strokeStyle = f.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 18 + k * 14, 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'burst') {
      const s = (f.size || 40) * (0.4 + k);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, s);
      g.addColorStop(0, f.color + 'cc'); g.addColorStop(1, f.color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  FX.flashes = FX.flashes.filter(f => f.t < f.dur);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of FX.floats) {
    f.t += dt;
    const k = f.t / f.dur;
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    ctx.font = `800 ${f.size}px sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    ctx.strokeText(f.text, f.x, f.y - k * 22);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - k * 22);
  }
  FX.floats = FX.floats.filter(f => f.t < f.dur);
  for (const f of FX.texts) {
    f.t += dt;
    const k = f.t / f.dur;
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    ctx.font = '700 12px sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    ctx.strokeText(f.text, f.x, f.y - k * 10);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - k * 10);
  }
  FX.texts = FX.texts.filter(f => f.t < f.dur);
  ctx.globalAlpha = 1;
  if (FX.shake > 0) {
    FX.shake -= dt;
    ctx.fillStyle = `rgba(140,200,255,${FX.shake})`;
    ctx.fillRect(0, 0, VIEW.W, VIEW.BOARD_H);
  }
}

function showSpellBanner(e) {
  const el = document.createElement('div');
  el.className = 'spell-banner' + (e.side !== UI.mySide ? ' enemy' : '');
  el.textContent = `${e.emoji} ${e.lord} — ${e.icon} ${e.name}${e.auto ? ' (자동)' : ''}`;
  const box = document.getElementById('banner');
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => el.remove(), 1700);
}

function drawDragGhostHint() {
  // 대기석 위에서 끄는 동안 상점 영역 판매 강조는 DOM에서 처리
}
