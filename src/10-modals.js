/* =====================================================================
 * 10. 모달 — 시작 화면, 증강, 주문 보상, 공용 선택, 주문서, 군주 열람, 결과
 * ===================================================================== */

function openModal(html, bind) {
  $('#modalBox').innerHTML = html;
  $('#modal').classList.remove('hidden');
  hideTip();
  if (bind) bind($('#modalBox'));
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
const modalOpen = () => !$('#modal').classList.contains('hidden');

/* ---------- 시작 화면 ---------- */
function showTitle() {
  const saved = loadGame();
  let lord = 'war', diff = 'normal';
  openModal(`
    <div class="title-hero"><div class="crown">👑</div><h1>일곱 군주의 탁자</h1>
    <p>상점에서 유닛을 사서 배치하면 전투는 자동으로. 군주 마나로 주문을 시전해 전투에 개입하라.<br>성향이 서로 다른 AI 군주 7명 사이에서 마지막까지 살아남으면 승리.</p></div>
    <h3>군주 유형</h3>
    <div class="choice-grid" id="lordPick">${Object.entries(LORD_TYPES).map(([k, L]) => `
      <div class="choice ${k === lord ? 'sel' : ''}" data-lord="${k}"><div class="ci">${L.icon}</div><div class="cn">${L.name}</div>
      <div class="cd">${L.desc}<br>패시브: <b>${L.passive}</b><br>시작 주문: ${L.spells.map(s => SPELLS[s].icon + ' ' + SPELLS[s].name).join(', ')}</div></div>`).join('')}</div>
    <div class="field"><label>난이도</label><div class="seg" id="diffPick">${Object.entries(DIFFICULTY).map(([k, D]) => `<button data-diff="${k}" class="${k === diff ? 'on' : ''}">${D.name}</button>`).join('')}</div></div>
    <div class="field"><label>시드</label><input id="seedIn" placeholder="비우면 무작위" inputmode="numeric" style="width:160px"><small>같은 시드 = 같은 판</small></div>
    <div class="row-btns">
      <button id="tSim" class="ghost">📊 밸런스 시뮬레이션</button>
      <button id="tOnline">🌐 온라인 대결</button>
      <button id="tHelp" class="ghost">도움말</button>
      ${saved && !saved.over ? `<button id="tCont">이어하기 (${saved.stage}-${saved.round})</button>` : ''}
      <button id="tNew" class="primary">새 게임 시작</button>
    </div>`, box => {
    box.querySelectorAll('[data-lord]').forEach(el => el.onclick = () => {
      lord = el.dataset.lord; box.querySelectorAll('[data-lord]').forEach(x => x.classList.toggle('sel', x === el));
    });
    box.querySelectorAll('[data-diff]').forEach(el => el.onclick = () => {
      diff = el.dataset.diff; box.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x === el));
    });
    box.querySelector('#tNew').onclick = () => {
      const seed = parseInt(box.querySelector('#seedIn').value, 10);
      closeModal();
      startNewGame({ lordType: lord, difficulty: diff, seed: isNaN(seed) ? 0 : seed });
    };
    const c = box.querySelector('#tCont');
    if (c) c.onclick = () => { closeModal(); continueGame(saved); };
    box.querySelector('#tHelp').onclick = () => showHelp(showTitle);
    box.querySelector('#tOnline').onclick = showOnlineMenu;
    box.querySelector('#tSim').onclick = () => showSimulation(showTitle);
  });
}

function showHelp(back) {
  openModal(`<h2>도움말</h2><p class="sub">배치는 전략, 주문은 전술.</p>
    <div class="help-grid">
      <div><b>준비 단계</b><br>상점에서 유닛을 사고(클릭), 대기석의 유닛을 보드 아래쪽 4줄로 끌어다 놓습니다. 레벨만큼 보드에 올릴 수 있습니다. 같은 유닛 3개 → ★2, ★2 3개 → ★3.</div>
      <div><b>경제</b><br>매 라운드 기본 5골드 + 이자(10골드당 1, 최대 5) + 연승·연패 보너스(2/4/6연속: 1/2/3). 경험치 4골드, 새로고침 2골드.</div>
      <div><b>시너지</b><br>계열(화염·서리·숲·망령·기계·별빛)과 역할(수호자·돌격대·저격수·주술사·암살자·치유사)이 서로 다른 유닛 2/4/6명이면 발동합니다.</div>
      <div><b>아이템</b><br>보관함의 재료를 유닛에 끌어다 놓으면 장착되고, 재료 2개가 모이면 완성 아이템이 됩니다. 유닛당 최대 3개. 판매 시 보관함으로 돌아옵니다.</div>
      <div><b>군주 주문</b><br>전투 중 군주 마나(초당 1.5, 아군 처치 시 +1)가 차면 주문 카드가 밝아집니다. 카드 클릭 또는 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> → 조준(전투 0.25배속) → 대상 클릭. <kbd>Tab</kbd> 대상 순환, <kbd>Enter</kbd> 시전, <kbd>Esc</kbd>/우클릭 취소.</div>
      <div><b>자동 시전</b><br>주문서에서 주문마다 자동 시전 조건을 고를 수 있습니다. 자동 시전은 직접 시전보다 효과가 10% 약합니다. '즉시 결과' 속도에서는 모든 주문이 자동 규칙으로 시전됩니다.</div>
      <div><b>단축키</b><br><kbd>D</kbd> 새로고침 · <kbd>F</kbd> 경험치 · <kbd>E</kbd> 마우스 아래 유닛 판매 · <kbd>Space</kbd> 준비 완료 · <kbd>B</kbd> 주문서 · <kbd>S</kbd> 전투 속도</div>
      <div><b>라운드</b><br>1단계는 몬스터 3라운드. 2단계부터 대전·공용 선택(체력 낮은 순으로 선택)·몬스터 라운드가 섞입니다. 2·3·4단계 시작 시 증강을 고릅니다. 전투는 30초 제한이며, 15초부터 연장전으로 피해가 점점 커집니다.</div>
    </div>
    <div class="row-btns"><button class="primary" id="hBack">닫기</button></div>`, box => {
    box.querySelector('#hBack').onclick = () => (back ? back() : closeModal());
  });
}

function showMenu() {
  openModal(`<h2>메뉴</h2><p class="sub">시드 ${G.seed} · 난이도 ${DIFFICULTY[G.difficulty].name} · ${roundLabel()}</p>
    <div class="row-btns" style="justify-content:flex-start">
      <button id="mResume" class="primary">계속하기</button>
      <button id="mHelp">도움말</button>
      <button id="mSim">밸런스 시뮬레이션</button>
      <button id="mTitle">${NET.role === 'off' ? '시작 화면으로 (자동 저장됨)' : '방 나가기'}</button>
    </div>`, box => {
    box.querySelector('#mResume').onclick = closeModal;
    box.querySelector('#mHelp').onclick = () => showHelp(showMenu);
    box.querySelector('#mSim').onclick = () => showSimulation(showMenu);
    box.querySelector('#mTitle').onclick = leaveToTitle;
  });
}

/* ---------- 증강 ---------- */
function showAugmentPick(offers, done) {
  openModal(`<h2>증강 선택</h2><p class="sub">${G.stage}단계 시작 — 세 가지 중 하나를 고르세요.</p>
    <div class="choice-grid">${offers.map((a, i) => `<div class="choice ${AUGMENTS[a.id].spell ? 'spellc' : ''}" data-i="${i}">
      <div class="ci">${AUGMENTS[a.id].icon}</div><div class="cn">${esc(augName(a))}</div><div class="cd">${esc(augDesc(a))}${AUGMENTS[a.id].spell ? '<br><b style="color:#7cc6ff">주문 증강</b>' : ''}</div></div>`).join('')}</div>`, box => {
    box.querySelectorAll('[data-i]').forEach(el => el.onclick = () => { closeModal(); done(offers[+el.dataset.i]); });
  });
}

/* ---------- 주문 보상 ---------- */
function showSpellPick(ids, done) {
  if (!ids.length) return done(null);
  openModal(`<h2>새 주문</h2><p class="sub">보상으로 주문 하나를 얻습니다. 장착은 주문서에서 바꿀 수 있습니다.</p>
    <div class="choice-grid">${ids.map(id => { const sp = SPELLS[id]; return `<div class="choice spellc" data-id="${id}">
      <div class="ci">${sp.icon}</div><div class="cn">${sp.name} <small>마나 ${sp.cost}</small></div>
      <div class="cd">${spellDesc(id, 1)}<br>${sp.once ? '전투당 1회' : '재사용 ' + sp.cd + '초'}</div></div>`; }).join('')}</div>`, box => {
    box.querySelectorAll('[data-id]').forEach(el => el.onclick = () => { closeModal(); done(el.dataset.id); });
  });
}

/* ---------- 주문서 ---------- */
function showSpellbook() {
  const P = human();
  const prep = G.phase === 'prep';
  const render = () => {
    const slots = spellSlots(P);
    openModal(`<h2>📖 주문서</h2><p class="sub">장착 ${P.equipped.length}/${slots}칸 (레벨 7에 3칸) · 강화하면 효과가 오르거나 마나가 줄어듭니다. ${prep ? '' : '<b>전투 중에는 변경할 수 없습니다.</b>'}</p>
      ${P.spells.map((s, i) => {
        const sp = SPELLS[s.id], eq = P.equipped.includes(i);
        const upCost = s.lvl < 3 ? spellUpCost(P, s) : null;
        return `<div class="spellbook-row ${eq ? 'eq' : ''}"><div class="si">${sp.icon}</div>
          <div><b>${sp.name}</b> <small>${'◆'.repeat(s.lvl)}${'◇'.repeat(3 - s.lvl)} · 마나 ${spellCost(s.id, s.lvl)} · ${sp.once ? '전투당 1회' : sp.cd + '초'}</small>
          <div class="sd">${spellDesc(s.id, s.lvl)}${upCost ? ` → <i>${spellDesc(s.id, s.lvl + 1)}</i>` : ''}</div>
          <select data-rule="${i}" ${prep ? '' : 'disabled'}>${['off', ...sp.auto].map(r => `<option value="${r}" ${s.rule === r ? 'selected' : ''}>자동: ${AUTO_RULES[r]}</option>`).join('')}</select></div>
          <div class="sx"><button class="small ${eq ? 'primary' : ''}" data-eq="${i}" ${prep ? '' : 'disabled'}>${eq ? '장착 해제' : '장착'}</button>
          <button class="small" data-up="${i}" ${prep && upCost && P.gold >= upCost ? '' : 'disabled'}>${upCost ? `강화 ${upCost}🪙` : '최대'}</button></div></div>`;
      }).join('')}
      <div class="row-btns"><button class="primary" id="sbClose">닫기</button></div>`, box => {
      box.querySelectorAll('[data-eq]').forEach(el => el.onclick = () => { toggleEquip(P, +el.dataset.eq); if (NET.role === 'guest') netAct('eqSpell', { i: +el.dataset.eq }); render(); renderAll(); });
      box.querySelectorAll('[data-up]').forEach(el => el.onclick = () => { if (upgradeSpell(P, +el.dataset.up)) toast('주문 강화!', 'gold'); if (NET.role === 'guest') netAct('upSpell', { i: +el.dataset.up }); render(); renderAll(); });
      box.querySelectorAll('[data-rule]').forEach(el => el.onchange = () => { P.spells[+el.dataset.rule].rule = el.value; if (NET.role === 'guest') netAct('rule', { i: +el.dataset.rule, v: el.value }); renderAll(); });
      box.querySelector('#sbClose').onclick = closeModal;
    });
  };
  render();
}

/* ---------- 군주 열람 ---------- */
function showPlayer(id) {
  const P = G.players.find(p => p.id === id);
  if (!P) return;
  const counts = computeTraits(P.board, P.aug);
  const cells = [];
  for (let r = CFG.ROWS - 1; r >= 0; r--) for (let c = 0; c < CFG.COLS; c++) {
    const u = P.board.find(x => x.r === r && x.c === c);
    cells.push(u ? `<div style="border-color:${COST_COLOR[UNITS[u.defId].cost]}" data-tip="unit:${u.defId}:${u.star}">${UNITS[u.defId].emoji}<small>${'★'.repeat(u.star)}</small></div>` : '<div></div>');
  }
  const traits = TRAIT_KEYS.filter(t => traitTier(t, counts[t] || 0)).map(t => `${TRAITS[t].icon}${TRAITS[t].name} ${counts[t]}`).join(' · ') || '없음';
  const spells = equippedSpells(P).map(s => `${SPELLS[s.id].icon} ${SPELLS[s.id].name} ${'◆'.repeat(s.lvl)}`).join(', ') || '없음';
  const owned = P.spells.map(s => SPELLS[s.id].icon).join(' ');
  openModal(`<h2>${P.emoji} ${esc(P.name)}</h2>
    <p class="sub">${LORD_TYPES[P.lordType].icon} ${LORD_TYPES[P.lordType].name}${P.ai ? ' · ' + esc(P.ai.style) : ''} · 체력 ${Math.max(0, P.hp)} · Lv${P.level} · 🪙${P.gold} · ${P.streak > 0 ? P.streak + '연승' : P.streak < 0 ? -P.streak + '연패' : '연속 기록 없음'}</p>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px">
      <div><h3>보드 <small>(앞줄이 아래)</small></h3><div class="mini-board">${cells.join('')}</div>
        <div style="margin-top:6px;font-size:13px">대기석: ${P.bench.filter(Boolean).map(u => UNITS[u.defId].emoji + (u.star > 1 ? '★' + u.star : '')).join(' ') || '없음'}</div></div>
      <div style="font-size:13px;line-height:1.7"><h3>시너지</h3>${traits}<h3 class="mt">가져갈 주문</h3>${spells}<br><small>보유: ${owned}</small>
        <h3 class="mt">증강</h3>${P.aug.map(a => AUGMENTS[a.id].icon + ' ' + esc(augName(a))).join('<br>') || '없음'}
        <h3 class="mt">최근 전적</h3>${P.history.slice(-8).map(h => h === 'W' ? '🟢' : '🔴').join('') || '-'}</div>
    </div>
    <div class="row-btns"><button class="primary" id="pClose">닫기</button></div>`, box => { box.querySelector('#pClose').onclick = closeModal; });
}

/* ---------- 전투 결과 ---------- */
// info는 네트워크로도 전달되므로 순수 데이터만 담는다 (battleInfo 참고)
function showBattleResult(info, done) {
  const mine = info.mine.slice().sort((a, b) => b.dmgDone - a.dmgDone);
  const maxD = Math.max(1, ...mine.map(u => u.dmgDone));
  const S = info.stats;
  const head = info.won ? '<div class="result-head win">승리!</div>' : info.timeout ? `<div class="result-head lose">시간 초과 — 양쪽 패배 (-${info.dmg})</div>` : `<div class="result-head lose">패배 (-${info.dmg})</div>`;
  openModal(`${head}<p class="sub">${info.roundLabel} · 상대: ${esc(info.oppName)}${info.ghost ? ' (유령 복제)' : ''} · 전투 시간 ${(info.ticks * CFG.TICK).toFixed(1)}초</p>
    <h3>유닛별 기여</h3>
    <table class="stats"><tr><th>유닛</th><th>준 피해</th><th style="width:40%"></th><th>받은 피해</th><th>회복</th></tr>
    ${mine.map(u => `<tr><td>${u.emoji} ${esc(u.name)} ${'★'.repeat(u.star)}</td><td>${Math.round(u.dmgDone)}</td>
      <td><div class="bar" style="width:${(u.dmgDone / maxD) * 100}%"></div></td><td>${Math.round(u.dmgTaken)}</td><td>${Math.round(u.healDone)}</td></tr>`).join('')}</table>
    <h3 class="mt">주문 기여</h3>
    <div style="font-size:13px">시전 ${S.casts}회 · 주문 피해 ${Math.round(S.spellDmg)} · 회복 ${Math.round(S.spellHeal)} · 보호막 ${Math.round(S.spellShield)}
    ${info.spellLog.map(l => `<span class="pill">${l.t.toFixed(1)}s ${l.icon}${l.auto ? '(자동)' : ''}</span>`).join(' ')}</div>
    ${info.rewards ? `<h3 class="mt">보상</h3><div style="font-size:14px">${info.rewards}</div>` : ''}
    <h3 class="mt">다른 탁자</h3><div style="font-size:13px;line-height:1.6">${info.others.join('<br>') || '-'}</div>
    <div class="row-btns"><button class="primary" id="rNext">계속 ▶</button></div>`, box => {
    box.querySelector('#rNext').onclick = () => { closeModal(); done(); };
  });
}

// 전투 B에서 side 진영의 결과 요약 (네트워크 전송용 순수 데이터)
function battleInfo(B, side) {
  const S = B.sides[side];
  return {
    roundLabel: roundLabel(), ticks: B.result.ticks, stats: { ...S.stats },
    mine: B.units.filter(u => u.side === side && !u.summon).map(u => ({ name: u.d.name, emoji: u.d.emoji, star: u.star, dmgDone: u.dmgDone, dmgTaken: u.dmgTaken, healDone: u.healDone })),
    spellLog: B.log.filter(l => l.side === side).map(l => ({ t: l.tick * CFG.TICK, icon: SPELLS[S.spells[l.slot].id].icon, auto: l.auto })),
  };
}

/* ---------- 공용 선택 화면 (방장·손님 공통: 상태를 받아 그린다) ---------- */
// st: {options:[{kind,defId,item,id,takenBy}], order:[플레이어 id], idx}
function showCarousel(st, onPick) {
  const cur = G.players[st.order[st.idx]];
  const myTurn = cur && cur.id === MY_ID;
  openModal(`<h2>🎠 공용 선택</h2><p class="sub">체력이 낮은 군주부터 하나씩 고릅니다. ${cur ? (myTurn ? '<b style="color:var(--gold)">당신의 차례입니다!</b>' : `${cur.emoji} ${esc(cur.name)} 고르는 중…`) : '선택 완료'}</p>
    <div class="queue">${st.order.map((id, i) => { const P = G.players[id]; return `<span class="${i < st.idx ? 'done' : i === st.idx ? 'now' : ''}" title="${esc(P.name)} (${P.hp})">${P.emoji}</span>`; }).join('')}</div>
    <div class="carousel">${st.options.map((o, i) => {
      const tk = o.takenBy != null ? `<div class="taken-by">${G.players[o.takenBy].emoji} 선택</div>` : '';
      const dis = o.takenBy != null ? 'disabled' : '';
      if (o.kind === 'unit') {
        const d = UNITS[o.defId], it = COMPONENTS[o.item];
        return `<div class="choice ${dis}" data-c="${i}" style="border-color:${COST_COLOR[d.cost]}" data-tip="unit:${o.defId}:1">
          <div class="ci">${d.emoji}</div><div class="cn">${d.name}</div><div class="cd">${d.cost}코스트 · ${it.icon} ${it.name}</div>${tk}</div>`;
      }
      const sp = SPELLS[o.id];
      return `<div class="choice spellc ${dis}" data-c="${i}" data-tip="spell:${o.id}:1"><div class="ci">${sp.icon}</div><div class="cn">${sp.name}</div><div class="cd">주문 · 마나 ${sp.cost}</div>${tk}</div>`;
    }).join('')}</div>`, box => {
    box.querySelectorAll('[data-c]').forEach(el => el.onclick = () => {
      const i = +el.dataset.c;
      if (!myTurn || st.options[i].takenBy != null) return;
      onPick(i);
    });
  });
}

function showGameOver(P) {
  if (NET.role === 'off') clearSave();
  const win = P.place === 1;
  openModal(`<div class="title-hero"><div class="crown">${win ? '👑' : '🪦'}</div>
    <h1>${win ? '탁자의 주인이 되었습니다!' : `${P.place}위로 탈락`}</h1>
    <p>${roundLabel()}까지 생존 · 레벨 ${P.level} · 시드 ${G.seed}</p></div>
    <h3>최종 순위</h3>
    <div style="font-size:14px;line-height:1.8">${G.players.slice().sort((a, b) => (b.alive - a.alive) || (a.alive ? b.hp - a.hp : a.place - b.place)).map(x => `${x.alive ? (G.players.filter(p => p.alive).length === 1 ? '1위' : `생존 (체력 ${x.hp})`) : x.place + '위'} ${x.emoji} ${esc(x.name)}${x.ai ? ` <small>${esc(x.ai.style)}</small>` : ''}`).join('<br>')}</div>
    <div class="row-btns">${NET.role !== 'off' && !G.over ? '<button id="goWatch">관전 계속</button>' : ''}<button id="goTitle">${NET.role === 'off' ? '시작 화면' : '방 나가기'}</button>${NET.role === 'off' ? '<button class="primary" id="goNew">같은 설정으로 새 게임</button>' : ''}</div>`, box => {
    box.querySelector('#goTitle').onclick = leaveToTitle;
    const gw = box.querySelector('#goWatch'); if (gw) gw.onclick = closeModal;
    const gn = box.querySelector('#goNew'); if (gn) gn.onclick = () => { const o = { lordType: human().lordType, difficulty: G.difficulty, seed: 0 }; closeModal(); startNewGame(o); };
  });
}

/* ---------- 유닛 정보 창: 장비 해제 · 판매 (모바일에서도 사용) ---------- */
function showUnitPanel(u) {
  const P = human();
  if (!allUnits(P).includes(u)) return;
  const editable = !P.board.includes(u) || boardEditable();
  openModal(`<div style="font-size:13px;line-height:1.6">${unitTooltip(u.defId, u.star, u)}</div>
    <h3 class="mt">장착한 아이템 (${u.items.length}/${CFG.ITEM_MAX})</h3>
    ${u.items.length ? u.items.map((it, i) => { const info = itemInfo(it); return `<div class="unit-item"><span style="font-size:22px">${info.icon}</span>
      <div class="ui-d"><b>${info.name}</b><br><small>${info.desc}</small></div><button class="small" data-un="${i}" ${editable ? '' : 'disabled'}>빼기</button></div>`; }).join('') : '<div class="empty-note">없음 — 보관함의 아이템을 누른 뒤 이 유닛을 누르면 장착됩니다.</div>'}
    <div class="row-btns"><button id="upSell" ${editable ? '' : 'disabled'}>판매 +${sellPrice(u) + (hasAug(P, 'broker') ? 1 : 0)}🪙</button><button class="primary" id="upClose">닫기</button></div>`, box => {
    box.querySelectorAll('[data-un]').forEach(el => el.onclick = () => { unequipItem(P, u, +el.dataset.un); renderAll(); showUnitPanel(u); });
    box.querySelector('#upSell').onclick = () => { if (NET.role === 'guest') netAct('sell', { uid: u.uid }); else { sellUnit(P, u); toast('판매 완료'); } closeModal(); renderAll(); };
    box.querySelector('#upClose').onclick = closeModal;
  });
}
