/* =====================================================================
 * 12. 부가 기능 — 도감, 전적 기록, 일일 도전, 자동 배치
 * ===================================================================== */

/* ---------- 자동 배치 ---------- */
function autoArrange(P) { aiArrange(P, true); }
function doAutoArrange() {
  if (!G || G.phase !== 'prep' || !human().alive) return;
  if (NET.role === 'guest') { netAct('auto'); sfx('click'); return; }
  autoArrange(human());
  sfx('click'); toast('🧩 자동 배치 완료');
  renderAll();
}
$('#btnAuto').onclick = doAutoArrange;
$('#btnCodex').onclick = () => showCodex(G ? closeModal : showTitle);

/* ---------- 전적 기록 (이 브라우저에 저장) ---------- */
const STATS_KEY = 'sevenLordsTable.stats.v1';
let STATS_MEM = null;
const emptyStats = () => ({ games: 0, wins: 0, placeSum: 0, best: 0, rounds: 0, topStage: 0, byLord: {}, daily: {}, online: { games: 0, wins: 0 } });
function loadStats() {
  try { const s = localStorage.getItem(STATS_KEY); if (s) return { ...emptyStats(), ...JSON.parse(s) }; } catch (e) { /* 저장 불가 */ }
  return STATS_MEM || emptyStats();
}
function saveStats(s) { STATS_MEM = s; try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* 저장 불가 */ } }
let lastRecorded = '';
// 게임 오버 때 한 번만 기록 (같은 판의 같은 결과가 두 번 들어오지 않게 막는다)
function recordResult(P) {
  const key = `${G.nonce}:${P.id}:${P.place}`;
  if (key === lastRecorded) return;
  lastRecorded = key;
  const s = loadStats();
  const place = P.place || 8;
  const won = place === 1;
  if (NET.role !== 'off') { s.online.games++; if (won) s.online.wins++; }
  else {
    s.games++; if (won) s.wins++;
    s.placeSum += place; s.best = s.best ? Math.min(s.best, place) : place;
    s.rounds += G.roundsPlayed; s.topStage = Math.max(s.topStage, G.stage);
    const L = s.byLord[P.lordType] || (s.byLord[P.lordType] = { g: 0, w: 0, sum: 0 });
    L.g++; L.sum += place; if (won) L.w++;
    if (G.daily) s.daily[G.daily] = s.daily[G.daily] ? Math.min(s.daily[G.daily], place) : place;
  }
  saveStats(s);
}
function showStats(back) {
  const s = loadStats();
  const avg = s.games ? (s.placeSum / s.games).toFixed(1) : '-';
  const lordRows = Object.entries(s.byLord).map(([k, L]) => `<tr><td>${LORD_TYPES[k].icon} ${LORD_TYPES[k].name}</td><td>${L.g}</td><td>${L.w}</td><td>${(L.sum / L.g).toFixed(1)}위</td></tr>`).join('');
  const days = Object.keys(s.daily).sort().reverse().slice(0, 7);
  openModal(`<h2>🏅 전적</h2><p class="sub">이 브라우저에 저장된 기록입니다 (혼자 하기 기준, 온라인은 따로 집계).</p>
    <div class="cx-stats">
      <div><b>${s.games}</b><small>플레이</small></div><div><b>${s.wins}</b><small>우승</small></div>
      <div><b>${s.games ? Math.round(s.wins / s.games * 100) + '%' : '-'}</b><small>우승률</small></div>
      <div><b>${s.best ? s.best + '위' : '-'}</b><small>최고 순위</small></div>
      <div><b>${avg}</b><small>평균 순위</small></div><div><b>${s.topStage || '-'}</b><small>최고 단계</small></div>
    </div>
    <h3 class="mt">군주 유형별</h3>
    ${lordRows ? `<table class="stats"><tr><th>유형</th><th>플레이</th><th>우승</th><th>평균 순위</th></tr>${lordRows}</table>` : '<div class="empty-note">아직 기록이 없습니다.</div>'}
    <h3 class="mt">일일 도전 (최근 기록)</h3>
    ${days.length ? days.map(d => `<div style="font-size:14px">${d} — ${s.daily[d]}위${s.daily[d] === 1 ? ' 👑' : ''}</div>`).join('') : '<div class="empty-note">오늘의 도전에 도전해 보세요.</div>'}
    <h3 class="mt">온라인 대결</h3><div style="font-size:14px">${s.online.games}판 · 우승 ${s.online.wins}회</div>
    <div class="row-btns"><button id="stReset">기록 지우기</button><button class="primary" id="stClose">닫기</button></div>`, box => {
    box.querySelector('#stClose').onclick = () => (back ? back() : closeModal());
    box.querySelector('#stReset').onclick = () => { if (confirm('전적을 모두 지울까요?')) { saveStats(emptyStats()); showStats(back); } };
  });
}

/* ---------- 일일 도전: 오늘 날짜가 시드 → 모두가 같은 AI 군주 구성 ---------- */
function dailyKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dailySeed(key = dailyKey()) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
}
function startDaily(lordType) {
  startNewGame({ lordType, difficulty: 'normal', seed: dailySeed(), daily: dailyKey() });
}

/* ---------- 도감 ---------- */
// 필터 줄은 탭을 열 때 한 번만 그리고, 결과 목록만 다시 그린다 (한글 입력 중 입력창이 바뀌면 조합이 끊기므로)
function showCodex(back, tab = 'unit') {
  const TABS = [['unit', '유닛'], ['trait', '시너지'], ['spell', '주문'], ['aug', '증강'], ['item', '아이템']];
  const st = { cost: 0, trait: '', q: '', star: 1, pick: null };
  const filters = {
    unit: () => `<div class="cx-filters"><input id="cxQ" placeholder="이름 검색">
      <div class="seg">${[0, 1, 2, 3, 4, 5].map(c => `<button data-cost="${c}" class="${c === 0 ? 'on' : ''}">${c ? c + '코스트' : '전체'}</button>`).join('')}</div>
      <select id="cxT"><option value="">모든 시너지</option>${TRAIT_KEYS.map(t => `<option value="${t}">${TRAITS[t].icon} ${TRAITS[t].name}</option>`).join('')}</select></div>`,
    aug: () => '<div class="cx-filters"><input id="cxQ" placeholder="이름·효과 검색"></div>',
  };
  const body = {
    unit() {
      const ids = Object.keys(UNITS).filter(id => {
        const u = UNITS[id];
        return (!st.cost || u.cost === st.cost) && (!st.trait || u.traits.includes(st.trait)) && (!st.q || u.name.includes(st.q));
      }).sort((a, b) => UNITS[a].cost - UNITS[b].cost || UNITS[a].name.localeCompare(UNITS[b].name, 'ko'));
      const detail = st.pick ? `<div class="cx-detail">${unitTooltip(st.pick, st.star)}<div class="seg" style="margin-top:6px">${[1, 2, 3].map(n => `<button data-star="${n}" class="${st.star === n ? 'on' : ''}">★${n}</button>`).join('')}</div></div>` : '<div class="empty-note" style="margin-bottom:8px">유닛을 누르면 자세한 정보가 나옵니다.</div>';
      return `${detail}<div class="cx-count">${ids.length}종</div>
        <div class="cx-grid">${ids.map(id => { const u = UNITS[id]; return `<div class="cx-card ${st.pick === id ? 'sel' : ''}" data-u="${id}" style="--cc:${COST_COLOR[u.cost]}"><div class="se">${u.emoji}</div><div class="sn">${u.name}</div><div class="st">${u.cost}🪙 ${u.traits.map(t => TRAITS[t].icon).join('')}</div></div>`; }).join('')}</div>`;
    },
    trait() {
      return TRAIT_KEYS.map(t => {
        const T = TRAITS[t];
        const units = Object.values(UNITS).filter(u => u.traits.includes(t)).sort((a, b) => a.cost - b.cost);
        return `<div class="cx-row" style="border-left:4px solid ${T.color}"><div class="cx-h">${T.icon} <b>${T.name}</b> <small>${T.kind === 'origin' ? '계열' : '역할'} · ${units.length}종</small></div>
          ${T.tiers.map((n, i) => `<div><b>${n}</b>명: ${T.desc[i]}</div>`).join('')}
          <div class="cx-emo">${units.map(u => `<span title="${u.name} (${u.cost}코스트)">${u.emoji}</span>`).join('')}</div></div>`;
      }).join('');
    },
    spell() {
      return SPELL_KEYS.map(id => {
        const sp = SPELLS[id];
        return `<div class="cx-row"><div class="cx-h">${sp.icon} <b>${sp.name}</b> <small>${{ atk: '공격형', def: '방어형', ctl: '제어형' }[sp.kind]} · 마나 ${sp.cost} · ${sp.once ? '전투당 1회' : '재사용 ' + sp.cd + '초'}</small></div>
          ${[1, 2, 3].map(l => `<div><b>${'◆'.repeat(l)}</b> ${spellDesc(id, l)}${l > 1 ? ` <small>(마나 ${spellCost(id, l)}, 강화 ${sp.up[l - 2]}🪙)</small>` : ''}</div>`).join('')}</div>`;
      }).join('');
    },
    aug() {
      const keys = AUG_KEYS.filter(k => !st.q || AUGMENTS[k].name.includes(st.q) || AUGMENTS[k].desc.includes(st.q));
      return `<div class="cx-count">${keys.length}종</div>` +
        keys.map(k => { const a = AUGMENTS[k]; return `<div class="cx-row ${a.spell ? 'sp' : ''}"><div class="cx-h">${a.icon} <b>${a.name}</b>${a.spell ? ' <small style="color:#7cc6ff">주문 증강</small>' : ''}</div><div>${esc(a.desc.replace('{trait}', '선택한 계열'))}</div></div>`; }).join('');
    },
    item() {
      return `<h3>재료 8종 <small>(유닛당 최대 3개, 재료 2개가 합쳐지면 완성 아이템)</small></h3>
        <div class="cx-grid">${COMP_KEYS.map(k => { const c = COMPONENTS[k]; return `<div class="cx-card" style="--cc:#777"><div class="se">${c.icon}</div><div class="sn">${c.name}</div><div class="st">${c.desc}</div></div>`; }).join('')}</div>
        <h3 class="mt">고유 효과 완성 아이템 20종 <small>(나머지 16종은 재료 능력치 합산 ×1.2)</small></h3>
        ${Object.entries(UNIQUE_ITEMS).map(([key, it]) => { const [a, b] = key.split('+'); return `<div class="cx-row"><div class="cx-h">${COMPONENTS[a].icon}+${COMPONENTS[b].icon} → ${it.icon} <b>${it.name}</b></div><div>${it.desc}</div></div>`; }).join('')}`;
    },
  };
  openModal(`<h2>📚 도감</h2>
    <div class="seg cx-tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${filters[tab] ? filters[tab]() : ''}
    <div id="cxBody"></div>
    <div class="row-btns"><button class="primary" id="cxClose">닫기</button></div>`, box => {
    const bodyEl = box.querySelector('#cxBody');
    const render = () => {
      bodyEl.innerHTML = body[tab]();
      bodyEl.querySelectorAll('[data-star]').forEach(b => { b.onclick = () => { st.star = +b.dataset.star; render(); }; });
      bodyEl.querySelectorAll('[data-u]').forEach(c => { c.onclick = () => { st.pick = c.dataset.u; render(); bodyEl.scrollIntoView({ block: 'start' }); }; });
    };
    box.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => showCodex(back, b.dataset.tab); });
    box.querySelectorAll('[data-cost]').forEach(b => {
      b.onclick = () => { st.cost = +b.dataset.cost; box.querySelectorAll('[data-cost]').forEach(x => x.classList.toggle('on', x === b)); render(); };
    });
    const t = box.querySelector('#cxT'); if (t) t.onchange = () => { st.trait = t.value; render(); };
    const q = box.querySelector('#cxQ'); if (q) q.oninput = () => { st.q = q.value.trim(); render(); };
    box.querySelector('#cxClose').onclick = () => (back ? back() : closeModal());
    render();
  });
}
