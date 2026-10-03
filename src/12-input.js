/* =====================================================================
 * 12. 입력 — 끌어놓기, 클릭, 주문 조준(감속), 키보드
 * ===================================================================== */

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * VIEW.W / rect.width, (e.clientY - rect.top) * VIEW.H / rect.height];
}
function hitTest(x, y) {
  if (x < 0 || x >= VIEW.W || y < 0) return null;
  if (y < VIEW.BOARD_H) return { kind: 'board', r: Math.floor(y / VIEW.CELL), c: Math.floor(x / VIEW.CELL) };
  if (y >= VIEW.BENCH_Y && y < VIEW.H) return { kind: 'bench', i: clamp(Math.floor(x / VIEW.BENCH_W), 0, CFG.BENCH - 1) };
  return null;
}
function overEl(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}
// 준비 화면에서 칸에 있는 플레이어 유닛
function unitAt(h) {
  const P = human();
  if (!h) return null;
  if (h.kind === 'bench') return P.bench[h.i];
  if (h.r < 4) return null;
  return P.board.find(u => u.r === h.r - 4 && u.c === h.c) || null;
}
const boardEditable = () => G && G.phase === 'prep' && !UI.battleView;

/* ---------- 끌어놓기 ---------- */
function beginDrag(e, payload, icon) {
  UI.drag = payload;
  const d = $('#drag');
  d.textContent = icon; d.classList.remove('hidden');
  d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px';
  if (payload.unit) {
    // 끄는 동안 상점 위에 판매 영역을 덮는다
    const z = $('#sellZone'), s = $('#shop');
    z.textContent = `여기에 놓으면 판매 +${sellPrice(payload.unit) + (hasAug(human(), 'broker') ? 1 : 0)}🪙`;
    Object.assign(z.style, { left: s.offsetLeft + 'px', top: s.offsetTop + 'px', width: s.offsetWidth + 'px', height: s.offsetHeight + 'px' });
    z.classList.add('active');
  }
  hideTip();
}
function endDrag() {
  UI.drag = null;
  $('#drag').classList.add('hidden');
  $('#sellZone').classList.remove('active');
}

canvas.addEventListener('pointerdown', e => {
  if (!G || modalOpen()) return;
  const [x, y] = canvasPoint(e);
  const h = hitTest(x, y);
  if (UI.battleView && UI.battle) {
    if (e.button === 2) { cancelAim(); return; }
    if (UI.aim) { aimClick(h); return; }
  }
  if (e.button !== 0) return;
  const u = unitAt(h);
  if (!u) return;
  if (h.kind === 'board' && !boardEditable()) return;
  canvas.setPointerCapture(e.pointerId);
  beginDrag(e, { unit: u, from: h }, UNITS[u.defId].emoji);
});

window.addEventListener('pointermove', e => {
  if (UI.drag) { const d = $('#drag'); d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }
  if (!G) return;
  const [x, y] = canvasPoint(e);
  const h = (e.target === canvas || UI.drag) ? hitTest(x, y) : null;
  UI.hover = h;
  if (UI.aim && UI.battle) {
    if (h && h.kind === 'board') {
      const occ = UI.battle.occ[h.r][h.c];
      UI.aimHover = { r: h.r, c: h.c, uid: occ || null };
    }
    return;
  }
  if (UI.drag || e.target !== canvas) return;
  // 캔버스 툴팁
  let html = null;
  if (UI.battleView && UI.battle && h && h.kind === 'board') {
    const bu = UI.battle.units.find(u => (u.alive || u.ghost > 0) && Math.hypot((u.sx || 0) - x, (u.sy || 0) - y) < 26);
    if (bu) html = unitTooltip(bu.defId, bu.star, null, bu);
  }
  if (!html) { const u = unitAt(h); if (u && !(UI.battleView && h.kind === 'board')) html = unitTooltip(u.defId, u.star, u); }
  if (html) showTip(html, e.clientX, e.clientY); else hideTip();
});
canvas.addEventListener('pointerleave', () => { if (!UI.drag) { hideTip(); UI.hover = null; } });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); cancelAim(); });

window.addEventListener('pointerup', e => {
  if (!UI.drag || !G) return;
  const drag = UI.drag;
  endDrag();
  const P = human();
  if (drag.unit) {
    if (overEl(e, $('#sellZone')) || overEl(e, $('#shop'))) {
      if (P.board.includes(drag.unit) && !boardEditable()) return;
      sellUnit(P, drag.unit); toast(`판매 +${sellPrice(drag.unit)}🪙`); renderAll(); return;
    }
    const [x, y] = canvasPoint(e);
    const h = hitTest(x, y);
    if (h) moveUnit(P, drag.unit, drag.from, h);
    renderAll();
    return;
  }
  if (drag.item != null) {
    const [x, y] = canvasPoint(e);
    const h = hitTest(x, y);
    const u = unitAt(h);
    if (!u) return;
    if (h.kind === 'board' && !boardEditable()) { toast('전투 중에는 보드 유닛에 장착할 수 없습니다', 'bad'); return; }
    const it = P.items[drag.item];
    if (equipItem(u, it)) { P.items.splice(drag.item, 1); toast(`${itemInfo(u.items[u.items.length - 1]).icon} 장착`); }
    else toast('아이템 칸이 가득 찼습니다 (최대 3개)', 'bad');
    renderAll();
  }
});

function moveUnit(P, u, from, to) {
  const onBoard = P.board.includes(u);
  if (to.kind === 'board') {
    if (!boardEditable()) return;
    if (to.r < 4) { toast('아래쪽 4줄에만 배치할 수 있습니다', 'bad'); return; }
    const lr = to.r - 4, lc = to.c;
    const other = P.board.find(x => x.r === lr && x.c === lc);
    if (other === u) return;
    if (onBoard) {
      if (other) { other.r = u.r; other.c = u.c; }
      u.r = lr; u.c = lc;
    } else {
      const bi = P.bench.indexOf(u);
      if (other) { // 대기석 유닛과 보드 유닛 교체
        P.board.splice(P.board.indexOf(other), 1); P.bench[bi] = other;
        delete other.r; delete other.c;
      } else if (P.board.length >= boardLimit(P)) { toast(`보드는 최대 ${boardLimit(P)}명 (레벨을 올리세요)`, 'bad'); return; }
      else P.bench[bi] = null;
      u.r = lr; u.c = lc; P.board.push(u);
    }
  } else if (to.kind === 'bench') {
    const other = P.bench[to.i];
    if (onBoard) {
      if (!boardEditable()) return;
      if (other) { // 교체
        other.r = u.r; other.c = u.c; P.board.push(other);
      }
      P.board.splice(P.board.indexOf(u), 1);
      delete u.r; delete u.c;
      P.bench[to.i] = u;
    } else {
      const bi = P.bench.indexOf(u);
      P.bench[bi] = other; P.bench[to.i] = u;
    }
  }
}

// 보관함 아이템 끌기
$('#inventory').addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-item]');
  if (!el || !G) return;
  e.preventDefault();
  const idx = +el.dataset.item;
  beginDrag(e, { item: idx }, itemInfo(human().items[idx]).icon);
});

/* ---------- 상점·버튼 ---------- */
$('#shop').addEventListener('click', e => {
  const el = e.target.closest('[data-shop]');
  if (!el || !G || !human().alive || G.phase === 'over') return;
  const P = human();
  const id = P.shop[+el.dataset.shop];
  if (!buyUnit(P, +el.dataset.shop)) {
    if (id && P.gold < UNITS[id].cost) toast('골드가 부족합니다', 'bad');
    else if (id) toast('대기석이 가득 찼습니다', 'bad');
  }
  renderAll();
});
$('#btnXp').onclick = () => { if (G && G.phase === 'prep' && buyXp(human())) renderAll(); };
$('#btnRoll').onclick = () => { if (G && G.phase !== 'over' && reroll(human())) renderAll(); };
$('#btnReady').onclick = onReady;
$('#btnSpellbook').onclick = () => G && showSpellbook();
$('#btnHelp').onclick = () => showHelp();
$('#btnMenu').onclick = () => G && showMenu();
$('#btnSpeed').onclick = cycleSpeed;
function cycleSpeed() {
  if (!G) return;
  if (G.instant) { G.instant = false; G.battleSpeed = 1; }
  else if (G.battleSpeed === 1) G.battleSpeed = 2;
  else G.instant = true;
  // 즉시 결과로 바꾸면 진행 중 전투도 자동 시전으로 즉시 마무리
  if (G.instant && UI.battle && UI.battleView && !UI.battle.over) {
    UI.battle.sides[0].forceAuto = true;
    UI.battle.headless = true;
    cancelAim();
    let guard = 0;
    while (!UI.battle.over && guard++ < 1000) stepBattle(UI.battle);
    UI.battle.ev = [];
  }
  renderTop();
}
$('#players').addEventListener('click', e => { const el = e.target.closest('[data-player]'); if (el) showPlayer(+el.dataset.player); });
$('#spellCards').addEventListener('click', e => {
  const el = e.target.closest('[data-spell]');
  if (!el || !G) return;
  if (UI.battleView && UI.battle && !UI.battle.over) startAim(+el.dataset.spell);
  else showSpellbook();
});

/* ---------- 툴팁 (DOM) ---------- */
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el || UI.drag) return;
  showTip(tipFor(el.dataset.tip), e.clientX, e.clientY);
});
document.addEventListener('mousemove', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && !UI.drag) showTip(tipFor(el.dataset.tip), e.clientX, e.clientY);
});
document.addEventListener('mouseout', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hideTip();
});

/* ---------- 주문 조준 ---------- */
function startAim(i) {
  const B = UI.battle;
  if (!B || B.over) return;
  const S = B.sides[0];
  const sl = S.spells[i];
  if (!sl) return;
  if (!spellReady(S, i)) {
    toast(sl.used ? '이미 사용한 주문입니다' : sl.cd > 0 ? `재사용 대기 ${sl.cd.toFixed(1)}초` : `군주 마나 부족 (${spellCostNow(S, sl)} 필요)`, 'bad');
    return;
  }
  const sp = SPELLS[sl.id];
  if (sp.target === 'none') { queueSpell(B, 0, i, {}); cancelAim(); return; }
  UI.aim = { slot: i, first: null };
  UI.aimHover = null; UI.tabIdx = -1;
  updateAimHint();
  renderSpellBar();
}
function cancelAim() {
  UI.aim = null; UI.aimHover = null;
  $('#aimHint').textContent = '';
}
function updateAimHint() {
  if (!UI.aim) { $('#aimHint').textContent = ''; return; }
  const sp = SPELLS[UI.battle.sides[0].spells[UI.aim.slot].id];
  const t = {
    ally: '아군 유닛을 선택', enemy: '적 유닛을 선택', row: '가로 줄을 선택', cell: '범위 중심 칸을 선택',
    ally2: UI.aim.first ? '맞바꿀 두 번째 아군 선택' : '첫 번째 아군 선택', allyCell: UI.aim.first ? '이동할 빈 칸 선택' : '이동시킬 아군 선택',
  }[sp.target];
  $('#aimHint').textContent = `${sp.icon} ${sp.name} — ${t} (0.25배속 · Tab 순환 · Enter 시전 · Esc 취소)`;
}
function aimClick(h) {
  if (!h || h.kind !== 'board') return;
  const B = UI.battle;
  const occ = B.occ[h.r][h.c];
  UI.aimHover = { r: h.r, c: h.c, uid: occ || null };
  confirmAim();
}
function confirmAim() {
  const B = UI.battle, a = UI.aim, hv = UI.aimHover;
  if (!B || !a || !hv) return;
  const S = B.sides[0];
  const sp = SPELLS[S.spells[a.slot].id];
  const u = hv.uid ? unitByUid(B, hv.uid) : null;
  const ally = u && u.side === 0 && targetable(u), foe = u && u.side === 1 && targetable(u);
  let target = null;
  switch (sp.target) {
    case 'ally': if (ally) target = { uid: u.uid }; break;
    case 'enemy': if (foe) target = { uid: u.uid }; break;
    case 'row': target = { r: hv.r }; break;
    case 'cell': target = { r: hv.r, c: hv.c }; break;
    case 'ally2':
      if (!ally) break;
      if (!a.first) { a.first = u.uid; updateAimHint(); return; }
      if (u.uid !== a.first) target = { uid: a.first, uid2: u.uid };
      break;
    case 'allyCell':
      if (!a.first) { if (ally) { a.first = u.uid; updateAimHint(); } return; }
      if (!B.occ[hv.r][hv.c]) target = { uid: a.first, r: hv.r, c: hv.c };
      break;
  }
  if (!target) { toast('올바른 대상이 아닙니다', 'bad'); return; }
  queueSpell(B, 0, a.slot, target);
  cancelAim();
}
// Tab: 유효한 대상을 순환
function aimCandidates() {
  const B = UI.battle, a = UI.aim;
  const sp = SPELLS[B.sides[0].spells[a.slot].id];
  const allies = B.units.filter(u => u.side === 0 && targetable(u)), foes = B.units.filter(u => u.side === 1 && targetable(u));
  const asHover = u => ({ r: u.r, c: u.c, uid: u.uid });
  switch (sp.target) {
    case 'ally': return allies.map(asHover);
    case 'enemy': case 'cell': return foes.map(asHover);
    case 'row': return [...new Set(foes.map(u => u.r))].map(r => ({ r, c: 3, uid: null }));
    case 'ally2': return allies.filter(u => u.uid !== a.first).map(asHover);
    case 'allyCell': {
      if (!a.first) return allies.map(asHover);
      const c = [];
      for (let r = 4; r < GROWS; r++) for (let cc = 0; cc < GCOLS; cc++) if (!B.occ[r][cc]) c.push({ r, c: cc, uid: null });
      return c;
    }
  }
  return [];
}

/* ---------- 키보드 ---------- */
window.addEventListener('keydown', e => {
  if (!G) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  if (modalOpen()) {
    if (k === 'escape') { const b = $('#pClose, #sbClose, #hBack, #mResume'); if (b) b.click(); }
    return;
  }
  if (UI.aim) {
    if (k === 'escape') { cancelAim(); e.preventDefault(); return; }
    if (k === 'tab') {
      e.preventDefault();
      const list = aimCandidates();
      if (!list.length) return;
      UI.tabIdx = (UI.tabIdx + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      UI.aimHover = list[UI.tabIdx];
      return;
    }
    if (k === 'enter') { e.preventDefault(); confirmAim(); return; }
  }
  if (['1', '2', '3', '4'].includes(k) && UI.battleView) { startAim(+k - 1); return; }
  if (k === 'd') $('#btnRoll').click();
  else if (k === 'f') $('#btnXp').click();
  else if (k === ' ') { e.preventDefault(); onReady(); }
  else if (k === 'b') showSpellbook();
  else if (k === 's') cycleSpeed();
  else if (k === 'h') showHelp();
  else if (k === 'e') {
    const u = unitAt(UI.hover);
    if (u && (!human().board.includes(u) || boardEditable())) { sellUnit(human(), u); toast(`판매 +${sellPrice(u)}🪙`); hideTip(); renderAll(); }
  }
});
