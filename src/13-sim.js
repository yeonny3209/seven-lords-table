/* =====================================================================
 * 13. 밸런스 시뮬레이션 — 무작위 보드끼리 화면 없이 수백 판을 돌려
 *     시너지별·주문별 승률과 '주문 유무에 따른 승률 차이'를 측정한다.
 * ===================================================================== */

function simRandomBoard(rng, level) {
  const focus = [rng.pick(TRAIT_KEYS), rng.pick(TRAIT_KEYS)];
  const ids = Object.keys(UNITS);
  const chosen = [];
  let guard = 0;
  while (chosen.length < level && guard++ < 500) {
    const cost = rng.weighted(SHOP_ODDS[level]) + 1;
    let cand = ids.filter(id => UNITS[id].cost === cost && !chosen.some(u => u.defId === id));
    if (rng.chance(0.65)) {
      const f = cand.filter(id => UNITS[id].traits.some(t => focus.includes(t)));
      if (f.length) cand = f;
    }
    if (!cand.length) continue;
    chosen.push({ uid: 0, defId: rng.pick(cand), star: rng.chance(0.4) ? 2 : 1, items: [] });
  }
  // 핵심 유닛에게 무작위 완성 아이템 2개
  const carry = chosen.slice().sort((a, b) => UNITS[b.defId].cost - UNITS[a.defId].cost)[0];
  for (let i = 0; i < 2; i++) carry.items.push(itemKey(rng.pick(COMP_KEYS), rng.pick(COMP_KEYS)));
  const P = { board: [], aug: [], ai: { focus } };
  placeFormation(P, chosen);
  return P;
}
function simSpec(P, spells, lordType) {
  return {
    name: '시뮬', emoji: '🤖', units: P.board.map(u => ({ defId: u.defId, star: u.star, items: u.items, r: u.r, c: u.c })),
    traits: computeTraits(P.board, []), aug: [], lordType, spells,
    ai: spells.length ? { tend: 0.5, castDelay: 0, mult: CFG.AUTO_CAST_MULT } : null,
  };
}
function simSpells(rng) {
  const ids = rng.shuffle(SPELL_KEYS.slice());
  const out = [];
  for (const id of ids) {
    if (out.length >= 2) break;
    if (SPELLS[id].once && out.some(s => SPELLS[s.id].once)) continue;
    out.push({ id, lvl: 1 + rng.int(2) });
  }
  return out;
}

function runSimulation(n, onProgress, onDone) {
  const rng = new RNG(20261003);
  const traits = {}, spells = {};
  let noSpell = 0, withSpell = 0, i = 0, timeouts = 0;
  const rec = (map, k, win) => { const s = map[k] || (map[k] = { g: 0, w: 0 }); s.g++; if (win) s.w++; };
  const chunk = () => {
    const end = Math.min(n, i + 8);
    for (; i < end; i++) {
      const A = simRandomBoard(rng, 7), Bd = simRandomBoard(rng, 7);
      const sA = simSpells(rng), sB = simSpells(rng);
      const lA = rng.pick(['war', 'guard', 'tactic']), lB = rng.pick(['war', 'guard', 'tactic']);
      const seed = rng.int(2 ** 30);
      const r0 = runBattle(simSpec(A, [], lA), simSpec(Bd, [], lB), seed).result;
      const r1 = runBattle(simSpec(A, sA, lA), simSpec(Bd, [], lB), seed).result;
      const r2 = runBattle(simSpec(A, sA, lA), simSpec(Bd, sB, lB), seed).result;
      if (r0.winner === 0) noSpell++;
      if (r1.winner === 0) withSpell++;
      if (r2.timeout) timeouts++;
      for (const [P, side] of [[A, 0], [Bd, 1]]) {
        const c = computeTraits(P.board, []);
        for (const t of TRAIT_KEYS) if (traitTier(t, c[t] || 0)) rec(traits, t, r2.winner === side);
      }
      for (const s of sA) rec(spells, s.id, r2.winner === 0);
      for (const s of sB) rec(spells, s.id, r2.winner === 1);
    }
    onProgress(i / n);
    if (i < n) setTimeout(chunk, 0);
    else onDone({ n, traits, spells, noSpell: noSpell / n, withSpell: withSpell / n, timeouts: timeouts / n });
  };
  chunk();
}

function showSimulation(back) {
  openModal(`<h2>📊 밸런스 시뮬레이션</h2>
    <p class="sub">레벨 7 무작위 보드끼리 화면 없이 전투를 돌립니다. 같은 보드·같은 시드에서 '주문 없음' 대 '한쪽만 주문 사용'을 비교해 주문의 영향력(목표 15~25%p)을 측정합니다.</p>
    <div class="field"><label>전투 수</label><select id="simN"><option>60</option><option selected>150</option><option>300</option></select>
    <button class="primary" id="simGo">실행</button><span id="simProg" class="pill">대기</span></div>
    <div id="simOut"></div>
    <div class="row-btns"><button id="simBack">닫기</button></div>`, box => {
    box.querySelector('#simBack').onclick = () => (back ? back() : closeModal());
    box.querySelector('#simGo').onclick = () => {
      const n = +box.querySelector('#simN').value;
      box.querySelector('#simGo').disabled = true;
      runSimulation(n, p => { box.querySelector('#simProg').textContent = Math.round(p * 100) + '%'; }, res => {
        box.querySelector('#simGo').disabled = false;
        const row = (name, s) => `<tr><td>${name}</td><td>${s.g}</td><td>${Math.round(s.w / s.g * 100)}%</td><td style="width:40%"><div class="bar" style="width:${s.w / s.g * 100}%"></div></td></tr>`;
        const diff = Math.round((res.withSpell - res.noSpell) * 100);
        box.querySelector('#simOut').innerHTML = `
          <h3>주문 영향력</h3><div style="font-size:14px">A 진영 승률: 주문 없음 <b>${Math.round(res.noSpell * 100)}%</b> → 주문 사용 <b>${Math.round(res.withSpell * 100)}%</b>
          (차이 <b style="color:${diff >= 15 && diff <= 25 ? 'var(--green)' : 'var(--gold)'}">${diff >= 0 ? '+' : ''}${diff}%p</b>, 목표 +15~25%p) · 시간 초과 ${Math.round(res.timeouts * 100)}%</div>
          <h3 class="mt">시너지별 승률 (발동 시)</h3><table class="stats"><tr><th>시너지</th><th>판</th><th>승률</th><th></th></tr>
          ${Object.entries(res.traits).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g).map(([t, s]) => row(TRAITS[t].icon + ' ' + TRAITS[t].name, s)).join('')}</table>
          <h3 class="mt">주문별 승률 (양쪽 주문 사용)</h3><table class="stats"><tr><th>주문</th><th>판</th><th>승률</th><th></th></tr>
          ${Object.entries(res.spells).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g).map(([id, s]) => row(SPELLS[id].icon + ' ' + SPELLS[id].name, s)).join('')}</table>`;
      });
    };
  });
}

/* =====================================================================
 * 14. 시작
 * ===================================================================== */
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(frame);
showTitle();
