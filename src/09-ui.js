/* =====================================================================
 * 09. 화면 패널 — 상단 정보, 시너지, 보관함, 주문 카드, 상점, 순위표, 툴팁
 * ===================================================================== */

function toast(msg, kind) {
  if (NET.capture) { NET.capture.push([msg, kind]); return; } // 방장이 손님의 행동을 처리하는 중이면 그 손님에게 보낼 알림으로 모아 둔다
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function renderAll() {
  if (!G) return;
  renderTop(); renderTraits(); renderInventory(); renderAugs(); renderSpellBar(); renderShop(); renderPlayers();
}

function renderTop() {
  const P = human();
  $('#roundLabel').textContent = roundLabel();
  const t = roundType(G.stage, G.round);
  $('#roundType').textContent = { pve: '👾 몬스터', pvp: '⚔️ 대전', carousel: '🎠 공용 선택' }[t];
  $('#hpVal').textContent = Math.max(0, P.hp);
  $('#goldVal').textContent = P.gold;
  $('#interestVal').textContent = `+${interest(P)}`;
  $('#lvlVal').textContent = P.level;
  const need = XP_TABLE[P.level];
  $('#xpVal').textContent = P.level >= 9 ? 'MAX' : `${P.xp}/${need}`;
  $('#xpFill').style.width = P.level >= 9 ? '100%' : `${(P.xp / need) * 100}%`;
  $('#streakIcon').textContent = P.streak > 0 ? '🔥' : P.streak < 0 ? '🧊' : '➖';
  $('#streakVal').textContent = Math.abs(P.streak);
  $('#btnSpeed').textContent = NET.role !== 'off' ? '실시간' : G.instant ? '즉시 결과' : `${G.battleSpeed}배속`;
  const tm = $('#timerVal');
  tm.classList.toggle('hidden', !(G.phase === 'prep' && G.prepLeft > 0));
  tm.textContent = `⏱ ${G.prepLeft}초`;
  const prep = G.phase === 'prep';
  $('#btnXp').disabled = !prep || P.gold < xpCost(P) || P.level >= 9;
  $('#btnXp').innerHTML = `⬆ 경험치<br><small>${xpCost(P)}🪙</small>`;
  $('#btnRoll').disabled = P.gold < rerollCost(P) || !P.alive || G.phase === 'over';
  $('#btnRoll').innerHTML = `🔄 새로고침<br><small>${rerollCost(P)}🪙</small>`;
  $('#btnReady').disabled = !prep || P.ready || !P.alive;
  const rd = G.readyInfo && NET.role !== 'off' ? ` (${G.readyInfo[0]}/${G.readyInfo[1]})` : '';
  $('#btnReady').textContent = prep ? (P.ready ? '다른 플레이어 대기 중' + rd : '준비 완료 ▶' + rd) : G.phase === 'battle' ? '전투 중…' : '대기 중';
}

function renderTraits() {
  const P = human();
  const units = UI.battleView && UI.battle ? null : P.board;
  const counts = computeTraits(units || P.board, P.aug);
  const keys = TRAIT_KEYS.filter(t => counts[t]).sort((a, b) => traitTier(b, counts[b]) - traitTier(a, counts[a]) || counts[b] - counts[a]);
  const box = $('#traits');
  if (!keys.length) { box.innerHTML = '<div class="empty-note">보드에 유닛을 올리면 시너지가 표시됩니다.</div>'; return; }
  box.innerHTML = keys.map(t => {
    const T = TRAITS[t], n = counts[t], tier = traitTier(t, n);
    const next = T.tiers.find(x => x > n);
    return `<div class="trait ${tier ? 'on' : 'off'} t${tier}" style="--tc:${T.color}" data-tip="trait:${t}">
      <div class="ti">${T.icon}</div><div class="tn">${T.name}</div>
      <div class="tc"><b>${n}</b> / ${next || T.tiers[2]}</div></div>`;
  }).join('');
}

function renderInventory() {
  const P = human();
  if (UI.selItem != null && UI.selItem >= P.items.length) UI.selItem = null;
  const box = $('#inventory');
  if (!P.items.length) { box.innerHTML = '<div class="empty-note">아이템 없음</div>'; return; }
  box.innerHTML = P.items.map((it, i) => {
    const info = itemInfo(it);
    return `<div class="item-chip ${info.component ? '' : 'done'} ${UI.selItem === i ? 'sel' : ''}" data-item="${i}" data-tip="item:${it}">${info.icon}</div>`;
  }).join('');
}

function renderAugs() {
  const P = human();
  $('#augList').innerHTML = P.aug.length ? P.aug.map(a => `<div class="aug-chip" data-tip="aug:${a.id}:${a.param || ''}">${AUGMENTS[a.id].icon} ${esc(augName(a))}</div>`).join('') : '<div class="empty-note">2·3·4단계 시작 시 선택</div>';
}

function renderSpellBar() {
  const P = human();
  const B = UI.battleView ? UI.battle : null;
  const S = B ? B.sides[UI.mySide] : null;
  const lm = S ? S.lm : (hasAug(P, 'manaHead') ? 3 : 0);
  const lmMax = S ? S.lmMax : (hasAug(P, 'manaVault') ? 14 : CFG.LORD_MANA_MAX);
  $('#lmVal').textContent = Math.floor(lm);
  $('#lmMax').textContent = lmMax;
  const bar = $('#lmBar');
  if (bar.children.length !== lmMax) { bar.innerHTML = '<i><b></b></i>'.repeat(lmMax); bar.style.gridTemplateColumns = `repeat(${lmMax}, 1fr)`; }
  [...bar.children].forEach((el, i) => { el.firstChild.style.transform = `scaleX(${clamp(lm - i, 0, 1)})`; });
  const eq = S ? S.spells : equippedSpells(P);
  const html = eq.map((s, i) => {
    const sp = SPELLS[s.id];
    const cost = S ? spellCostNow(S, s) : spellCost(s.id, s.lvl);
    const ready = S && spellReady(S, i);
    const aiming = UI.aim && UI.aim.slot === i;
    const cdTxt = S && s.cd > 0 ? `<div class="sc-cd">${s.cd.toFixed(1)}</div>` : '';
    const used = S && s.used;
    return `<div class="spell-card ${ready ? 'ready' : ''} ${aiming ? 'aiming' : ''} ${used ? 'used' : ''}" data-spell="${i}" data-tip="spell:${s.id}:${s.lvl}">
      <div class="sc-top"><span class="sc-icon">${sp.icon}</span>${sp.name}<span class="sc-cost">${cost}</span></div>
      <div class="sc-sub"><span>${'◆'.repeat(s.lvl)}${'◇'.repeat(3 - s.lvl)}</span><span>${sp.once ? '1회' : sp.cd + '초'}</span></div>
      ${s.rule !== 'off' ? '<div class="sc-auto">자동 시전</div>' : ''}
      <span class="sc-key">${i + 1}</span>${cdTxt}${used ? '<div class="sc-cd">사용함</div>' : ''}</div>`;
  }).join('');
  const box = $('#spellCards');
  if (box.dataset.html !== html) { box.innerHTML = html || '<div class="empty-note">장착한 주문이 없습니다 (주문서)</div>'; box.dataset.html = html; }
}

function renderShop() {
  const P = human();
  const owned = {};
  for (const u of allUnits(P)) if (u.star === 1) owned[u.defId] = (owned[u.defId] || 0) + 1;
  const ownedAny = {};
  for (const u of allUnits(P)) ownedAny[u.defId] = true;
  $('#shop').style.setProperty('--n', P.shop.length);
  $('#shop').innerHTML = P.shop.map((id, i) => {
    if (!id) return `<div class="shop-card sold" style="--cc:#333"></div>`;
    const d = UNITS[id];
    const cls = [ownedAny[id] ? 'owned' : '', owned[id] >= 2 ? 'merge' : '', P.gold < d.cost ? 'poor' : ''].join(' ');
    return `<div class="shop-card ${cls}" style="--cc:${COST_COLOR[d.cost]}" data-shop="${i}" data-own="보유 ${owned[id] || 0}" data-tip="unit:${id}:1">
      <span class="sp">${d.cost}🪙</span><div class="se">${d.emoji}</div><div class="sn">${d.name}</div>
      <div class="st">${d.traits.map(t => TRAITS[t].icon).join('')}</div></div>`;
  }).join('');
}

function renderPlayers() {
  const list = G.players.slice().sort((a, b) => (b.alive - a.alive) || (b.hp - a.hp) || (a.place - b.place));
  const opp = UI.currentOppId;
  $('#players').innerHTML = list.map(P => {
    const hp = Math.max(0, P.hp);
    const st = P.streak > 1 ? `🔥${P.streak}` : P.streak < -1 ? `🧊${-P.streak}` : '';
    return `<div class="prow ${P.id === MY_ID ? 'me' : ''} ${P.alive ? '' : 'dead'} ${opp === P.id ? 'opp' : ''}" data-player="${P.id}">
      <div class="pe">${P.emoji}</div>
      <div class="pm"><div class="pn">${esc(P.name)} <span class="ps">${P.isHuman ? '👤' : ''}Lv${P.level} ${LORD_TYPES[P.lordType].icon} ${st}</span></div>
      <div class="ph"><i style="width:${Math.min(100, hp)}%"></i></div></div>
      <div class="pv">${P.alive ? hp : '#' + P.place}</div></div>`;
  }).join('');
}

/* ---------- 툴팁 ---------- */
function unitTooltip(defId, star, u, cu) {
  const d = unitDef(defId);
  const m = CFG.STAR_MULT[star] || 1;
  const sk = d.skill;
  let skillTxt = '';
  if (sk) {
    const parts = sk.fx.map(f => {
      const v = f.v ? f.v[star - 1] : null;
      switch (f.t) {
        case 'dmg': return `${f.kind === 'phys' ? '물리' : '마법'} 피해 ${v}`;
        case 'heal': return `회복 ${v}`;
        case 'shield': return `보호막 ${v}`;
        case 'stun': return `기절 ${v}초`;
        case 'slow': return `공속 -${pctS(v)}`;
        case 'burn': return `화상 초당 ${v}`;
        case 'buff': return { as: `공속 +${pctS(v)}`, atk: `공격력 +${pctS(v)}`, armor: `방어 +${v}`, mr: `마저 +${v}` }[f.stat] + (f.tgt === 'allAllies' ? ' (아군 전체)' : '');
        case 'mana': return `아군 마나 +${v}`;
        case 'leap': return '가장 먼 적에게 도약';
        case 'execute': return `체력 ${pctS(v)} 이하 처형`;
        case 'summon': return `${unitDef(f.unit).name} ${f.n}기 소환`;
      }
      return '';
    }).filter(Boolean).join(', ');
    skillTxt = `<hr><b>${sk.name}</b> <span class="tt-sub">(마나 ${d.mana})</span><br>${parts}`;
  }
  const hp = cu ? `${Math.round(cu.hp)}/${Math.round(cu.maxHp)}` : Math.round(d.hp * m);
  const atk = cu ? Math.round(effAtk(cu)) : Math.round(d.atk * m);
  const items = (u || cu) ? (u || cu).items : [];
  return `<h4>${d.emoji} ${d.name} ${'★'.repeat(star)}</h4>
    <div class="tt-sub">${d.cost ? d.cost + '코스트 · ' : ''}${(d.traits || []).map(t => TRAITS[t].icon + ' ' + TRAITS[t].name).join(' · ')}</div>
    <div class="tt-row"><span>❤️ ${hp}</span><span>⚔️ ${atk}</span><span>⚡ ${(cu ? effAS(cu) : d.as).toFixed(2)}</span><span>🎯 사거리 ${cu ? cu.range : d.range}</span>
    <span>🛡️ ${Math.round(cu ? effArmor(cu) : d.armor)}</span><span>🧥 ${Math.round(cu ? effMr(cu) : d.mr)}</span></div>
    ${skillTxt}
    ${items.length ? '<hr>' + items.map(it => { const i = itemInfo(it); return `${i.icon} <b>${i.name}</b> — ${i.desc}${i.component ? '' : ' (' + statText(i.stats) + ')'}`; }).join('<br>') : ''}
    ${u && !UI.battleView ? `<hr><span class="tt-sub">판매가 ${sellPrice(u)}🪙 · 끌어서 이동 · E 키로 판매</span>` : ''}`;
}
function traitTooltip(t) {
  const T = TRAITS[t];
  const P = human();
  const n = computeTraits(P.board, P.aug)[t] || 0;
  const tier = traitTier(t, n);
  const units = Object.values(UNITS).filter(u => u.traits.includes(t)).map(u => u.emoji).join(' ');
  return `<h4>${T.icon} ${T.name} <span class="tt-sub">(${T.kind === 'origin' ? '계열' : '역할'})</span></h4>
    ${T.tiers.map((x, i) => `<div style="opacity:${tier === i + 1 ? 1 : .55}">${tier === i + 1 ? '▶' : '·'} <b>${x}</b>: ${T.desc[i]}</div>`).join('')}
    <hr><div class="tt-sub">${units}</div>`;
}
function spellTooltip(id, lvl) {
  const sp = SPELLS[id];
  const next = lvl < 3 ? `<hr>다음 단계(${G ? spellUpCost(human(), { id, lvl }) : sp.up[lvl - 1]}🪙): ${spellDesc(id, lvl + 1)} · 마나 ${spellCost(id, lvl + 1)}` : '';
  return `<h4>${sp.icon} ${sp.name} ${'◆'.repeat(lvl)}</h4><div class="tt-sub">마나 ${spellCost(id, lvl)} · ${sp.once ? '전투당 1회' : '재사용 ' + sp.cd + '초'} · ${{ atk: '공격형', def: '방어형', ctl: '제어형' }[sp.kind]}</div>
    <div>${spellDesc(id, lvl)}</div>${next}`;
}

function showTip(html, x, y) {
  const el = $('#tooltip');
  el.innerHTML = html;
  el.classList.remove('hidden');
  const w = el.offsetWidth, h = el.offsetHeight;
  let tx = x + 16, ty = y + 14;
  if (tx + w > window.innerWidth - 8) tx = x - w - 12;
  if (ty + h > window.innerHeight - 8) ty = window.innerHeight - h - 8;
  el.style.left = Math.max(8, tx) + 'px'; el.style.top = Math.max(8, ty) + 'px';
}
function hideTip() { $('#tooltip').classList.add('hidden'); }

function tipFor(spec) {
  const [kind, a, b] = spec.split(':');
  if (kind === 'trait') return traitTooltip(a);
  if (kind === 'unit') return unitTooltip(a, +b || 1);
  if (kind === 'item') { const i = itemInfo(spec.slice(5)); return `<h4>${i.icon} ${i.name}</h4><div>${i.desc}</div>${i.component ? '<div class="tt-sub">다른 재료와 같은 유닛에 장착하면 완성 아이템이 됩니다.</div>' : `<div class="tt-sub">${statText(i.stats)}</div>`}`; }
  if (kind === 'spell') return spellTooltip(a, +b || 1);
  if (kind === 'aug') { const ag = { id: a, param: b || undefined }; return `<h4>${AUGMENTS[a].icon} ${esc(augName(ag))}</h4><div>${esc(augDesc(ag))}</div>`; }
  return '';
}
