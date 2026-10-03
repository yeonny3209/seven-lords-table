'use strict';
/* =====================================================================
 * 00. 공용 도구 — 시드 기반 난수, 작은 유틸리티
 * ===================================================================== */

// mulberry32: 상태가 정수 하나라서 저장·복원이 쉽다.
class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + this.next() * (b - a); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = this.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  weighted(weights) { // weights: 배열, 인덱스 반환
    let sum = 0; for (const w of weights) sum += w;
    let x = this.next() * sum;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cheb = (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
const sum = arr => arr.reduce((a, b) => a + b, 0);
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// 시너지 단계: 0 = 미발동, 1~3 = 2/4/6명 단계
function traitTier(trait, count) {
  const t = TRAITS[trait].tiers;
  let tier = 0;
  for (let i = 0; i < t.length; i++) if (count >= t[i]) tier = i + 1;
  return tier;
}

// 보드 유닛 목록 → 시너지 카운트 (서로 다른 유닛만, 문장 증강 반영)
function computeTraits(boardUnits, aug) {
  const seen = new Set();
  const counts = {};
  for (const u of boardUnits) {
    if (seen.has(u.defId)) continue;
    seen.add(u.defId);
    const d = UNITS[u.defId];
    if (!d) continue;
    for (const t of d.traits) counts[t] = (counts[t] || 0) + 1;
  }
  if (aug) for (const a of aug) if (a.id === 'emblem' && counts[a.param]) counts[a.param] += 1;
  return counts;
}
