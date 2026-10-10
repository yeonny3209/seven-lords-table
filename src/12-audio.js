/* =====================================================================
 * 12. 효과음 — Web Audio로 합성 (파일 없음). 음소거는 브라우저에 기억한다.
 * ===================================================================== */

const AUDIO = { ctx: null, muted: false, last: {}, master: 0.5 };
try { AUDIO.muted = localStorage.getItem('slt.mute') === '1'; } catch (e) { /* 저장 불가 환경 */ }

function audioCtx() {
  if (!AUDIO.ctx) {
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) AUDIO.ctx = new C(); } catch (e) { /* 오디오 없음 */ }
  }
  if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume().catch(() => {});
  return AUDIO.ctx;
}
// 브라우저 정책상 소리는 사용자가 한 번 누른 뒤부터 난다
window.addEventListener('pointerdown', () => { if (!AUDIO.muted) audioCtx(); }, { once: false, passive: true });

function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  const c = AUDIO.ctx; if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol * AUDIO.master, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseBurst(dur, vol = 0.15, filterHz = 1800, delay = 0) {
  const c = AUDIO.ctx; if (!c) return;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = filterHz;
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(vol * AUDIO.master, t0);
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
}

// 이름 → [재생 함수, 같은 소리 최소 간격(ms)]
const SFX = {
  click:   [() => tone(700, 0.04, 'square', 0.07), 60],
  err:     [() => tone(180, 0.12, 'sawtooth', 0.12, 120), 150],
  buy:     [() => { tone(520, 0.07, 'triangle', 0.2); tone(780, 0.1, 'triangle', 0.2, null, 0.06); }, 60],
  sell:    [() => { tone(700, 0.07, 'triangle', 0.18); tone(430, 0.1, 'triangle', 0.18, null, 0.06); }, 60],
  roll:    [() => { noiseBurst(0.08, 0.1, 3000); tone(900, 0.05, 'square', 0.06, 500); }, 80],
  xp:      [() => { tone(440, 0.08, 'triangle', 0.18); tone(660, 0.08, 'triangle', 0.18, null, 0.07); tone(880, 0.12, 'triangle', 0.18, null, 0.14); }, 100],
  merge:   [() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'triangle', 0.22, null, i * 0.07)); }, 200],
  level:   [() => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'square', 0.1, null, i * 0.08)); }, 300],
  ready:   [() => tone(600, 0.1, 'triangle', 0.18, 900), 200],
  hit:     [() => { noiseBurst(0.05, 0.1, 1500); tone(180, 0.05, 'square', 0.05, 90); }, 70],
  crit:    [() => { noiseBurst(0.08, 0.16, 3500); tone(420, 0.1, 'sawtooth', 0.1, 160); }, 90],
  skill:   [() => { tone(300, 0.2, 'sawtooth', 0.09, 900); tone(600, 0.15, 'triangle', 0.1, 1200, 0.05); }, 120],
  spell:   [() => { tone(260, 0.28, 'sawtooth', 0.12, 1040); tone(520, 0.3, 'sine', 0.14, 1560, 0.04); noiseBurst(0.15, 0.06, 5000, 0.1); }, 200],
  enemySpell: [() => { tone(420, 0.25, 'sawtooth', 0.1, 140); tone(300, 0.3, 'triangle', 0.1, 110, 0.05); }, 250],
  shield:  [() => tone(880, 0.12, 'sine', 0.1, 1320), 150],
  stun:    [() => tone(240, 0.12, 'square', 0.07, 120), 150],
  whoosh:  [() => noiseBurst(0.18, 0.08, 4500), 150],
  death:   [() => { tone(300, 0.22, 'sawtooth', 0.11, 70); noiseBurst(0.12, 0.08, 900); }, 100],
  win:     [() => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, 'triangle', 0.22, null, i * 0.09)); }, 800],
  lose:    [() => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.12, null, i * 0.14)); }, 800],
};

function sfx(name) {
  if (AUDIO.muted) return;
  const def = SFX[name]; if (!def) return;
  const now = performance.now();
  if (now - (AUDIO.last[name] || 0) < def[1]) return;
  AUDIO.last[name] = now;
  if (!audioCtx()) return;
  try { def[0](); } catch (e) { /* 소리 실패는 무시 */ }
}

function toggleMute() {
  AUDIO.muted = !AUDIO.muted;
  try { localStorage.setItem('slt.mute', AUDIO.muted ? '1' : '0'); } catch (e) { /* 저장 불가 */ }
  updateSoundButton();
  if (!AUDIO.muted) sfx('click');
}
function updateSoundButton() {
  const b = $('#btnSound');
  b.textContent = AUDIO.muted ? '🔇' : '🔊';
  b.title = AUDIO.muted ? '효과음 켜기 (M)' : '효과음 끄기 (M)';
}
$('#btnSound').onclick = toggleMute;
updateSoundButton();
