// 일곱 군주의 탁자 — 방 중계 서버
// 게임 규칙은 방장의 브라우저가 계산하고, 이 서버는 방을 만들고 메시지를 전달만 한다.
//   클라이언트 → 서버: {t:'create', name} | {t:'join', code, name} | {t:'to', to:'all'|슬롯번호, d} | {t:'lock'}
//   서버 → 클라이언트: {t:'hello', code, slot, host, peers} | {t:'peer', slot, name, joined} | {t:'from', from, d} | {t:'closed', reason} | {t:'error', msg}
// 방장(슬롯 0)만 모두에게 보낼 수 있고, 손님은 방장에게만 보낼 수 있다.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const MAX_PLAYERS = 8;
const MAX_MSG_BYTES = 256 * 1024;
const MAX_ROOMS = 500;
const RATE_LIMIT = 200; // 연결 하나가 초당 보낼 수 있는 메시지 수 (전투 중계 포함)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map(); // code → {code, players: Map(slot → {ws, name}), locked, created}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`seven-lords-table relay: ${rooms.size} rooms\n`);
});
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG_BYTES });

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '군주';

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const peersOf = room => [...room.players].map(([slot, p]) => ({ slot, name: p.name }));

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  room.players.delete(ws.slot);
  if (ws.slot === 0) { // 방장이 나가면 방을 닫는다
    for (const [, p] of room.players) { send(p.ws, { t: 'closed', reason: '방장이 나가서 방이 닫혔습니다.' }); p.ws.room = null; }
    rooms.delete(room.code);
  } else {
    for (const [, p] of room.players) send(p.ws, { t: 'peer', slot: ws.slot, name: '', joined: false });
    if (!room.players.size) rooms.delete(room.code);
  }
}

wss.on('connection', ws => {
  ws.alive = true; ws.room = null; ws.slot = -1; ws.count = 0; ws.winStart = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    const now = Date.now();
    if (now - ws.winStart > 1000) { ws.winStart = now; ws.count = 0; }
    if (++ws.count > RATE_LIMIT) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'create' && !ws.room) {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: '서버가 가득 찼습니다. 잠시 뒤 다시 시도하세요.' });
      const code = newCode();
      if (!code) return send(ws, { t: 'error', msg: '방을 만들 수 없습니다.' });
      const room = { code, players: new Map(), locked: false, created: now };
      rooms.set(code, room);
      ws.room = room; ws.slot = 0;
      room.players.set(0, { ws, name: cleanName(m.name) });
      send(ws, { t: 'hello', code, slot: 0, host: true, peers: peersOf(room) });
    } else if (m.t === 'join' && !ws.room) {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(ws, { t: 'error', msg: '방을 찾을 수 없습니다. 코드를 확인하세요.' });
      if (room.locked) return send(ws, { t: 'error', msg: '이미 게임이 시작된 방입니다.' });
      let slot = -1;
      for (let i = 1; i < MAX_PLAYERS; i++) if (!room.players.has(i)) { slot = i; break; }
      if (slot < 0) return send(ws, { t: 'error', msg: '방이 가득 찼습니다 (최대 8명).' });
      ws.room = room; ws.slot = slot;
      const name = cleanName(m.name);
      room.players.set(slot, { ws, name });
      send(ws, { t: 'hello', code: room.code, slot, host: false, peers: peersOf(room) });
      for (const [s, p] of room.players) if (s !== slot) send(p.ws, { t: 'peer', slot, name, joined: true });
    } else if (m.t === 'to' && ws.room) {
      const room = ws.room;
      if (ws.slot === 0) {
        if (m.to === 'all') { for (const [s, p] of room.players) if (s !== 0) send(p.ws, { t: 'from', from: 0, d: m.d }); }
        else { const p = room.players.get(m.to); if (p) send(p.ws, { t: 'from', from: 0, d: m.d }); }
      } else {
        const host = room.players.get(0);
        if (host) send(host.ws, { t: 'from', from: ws.slot, d: m.d });
      }
    } else if (m.t === 'lock' && ws.room && ws.slot === 0) {
      ws.room.locked = !!m.v;
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// 끊긴 연결 정리 + 무료 호스팅의 유휴 연결 끊김 방지
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
  const cutoff = Date.now() - 6 * 3600 * 1000; // 6시간 지난 방은 정리
  for (const [code, room] of rooms) if (room.created < cutoff) {
    for (const [, p] of room.players) { send(p.ws, { t: 'closed', reason: '방이 오래되어 닫혔습니다.' }); p.ws.room = null; }
    rooms.delete(code);
  }
}, 25000);

server.listen(PORT, () => console.log(`relay listening on :${PORT}`));
