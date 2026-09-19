import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { REJOIN_GRACE_MS, type ClientToServer, type PeerRole, type ServerErrorCode, type ServerToClient } from '@shooter/protocol';

// 시그널링 서버: 6자리 방 코드로 두 기기를 짝짓고, WebRTC 협상 메시지를 중계하고,
// P2P가 안 되면 게임 패킷(바이너리)을 그대로 넘겨 주는 릴레이 역할을 한다. 방은 메모리에만 둔다.

const PORT = Number(process.env.PORT ?? 8787); // 호스팅 서비스는 PORT 환경 변수로 포트를 준다

// 방 안의 한 자리 (방을 만든 쪽 또는 참가한 쪽)
interface Slot {
  role: PeerRole;
  token: string; // 재접속할 때 이 자리의 주인임을 증명하는 값
  ws: WebSocket | null; // 지금 붙어 있는 소켓 (끊겼으면 null)
  leaveTimer: NodeJS.Timeout | null; // 끊긴 뒤 유예가 끝나면 자리를 치우는 타이머
}

interface Room {
  code: string;
  host: Slot;
  guest: Slot | null;
}

const rooms = new Map<string, Room>(); // 방 코드 → 방
const slotOf = new WeakMap<WebSocket, { room: Room; slot: Slot }>(); // 소켓 → 그 소켓이 앉은 방과 자리

function send(ws: WebSocket | null, msg: ServerToClient): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); // 닫힌 소켓에는 보내지 않는다
}

function sendError(ws: WebSocket, code: ServerErrorCode): void {
  send(ws, { t: 'error', code });
}

// 같은 방의 상대 자리
function otherSlot(room: Room, slot: Slot): Slot | null {
  return slot === room.host ? room.guest : room.host;
}

function newRoomCode(): string {
  let code: string;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000)); // 100000..999999
  } while (rooms.has(code)); // 이미 쓰는 코드면 다시 뽑는다
  return code;
}

function newSlot(role: PeerRole, ws: WebSocket): Slot {
  return { role, token: randomUUID(), ws, leaveTimer: null }; // 토큰은 추측할 수 없는 무작위 UUID
}

// 재접속한 소켓을 원래 자리에 다시 앉힌다. 유예 타이머를 끄고, 남아 있던 옛 소켓은 닫는다
function attach(ws: WebSocket, room: Room, slot: Slot): void {
  if (slot.leaveTimer) {
    clearTimeout(slot.leaveTimer);
    slot.leaveTimer = null;
  }
  const previous = slot.ws;
  slot.ws = ws;
  slotOf.set(ws, { room, slot });
  if (previous && previous !== ws) {
    slotOf.delete(previous);
    previous.close();
  }
}

// 소켓이 끊기면 슬롯을 비워 두고 유예 시간 뒤에야 방을 정리한다.
function handleClose(ws: WebSocket): void {
  const entry = slotOf.get(ws);
  if (!entry) return;
  slotOf.delete(ws);
  const { room, slot } = entry;
  if (slot.ws !== ws) return; // 이미 새 소켓으로 바뀐 자리의 옛 소켓이 닫힌 것
  slot.ws = null;
  send(otherSlot(room, slot)?.ws ?? null, { t: 'peer_disconnected' }); // 상대에게: 잠깐 끊겼다, 기다려라
  slot.leaveTimer = setTimeout(() => {
    slot.leaveTimer = null;
    if (slot.ws) return; // 유예 안에 돌아왔다
    if (slot === room.host) {
      // 방장이 안 돌아오면 방 자체를 없앤다
      rooms.delete(room.code);
      send(room.guest?.ws ?? null, { t: 'peer_left' });
      if (room.guest?.ws) slotOf.delete(room.guest.ws);
    } else {
      room.guest = null;
      send(room.host.ws, { t: 'peer_left' });
    }
  }, REJOIN_GRACE_MS);
}

// 한 소켓이 다른 방을 만들거나 들어가기 전에 지금 자리를 비운다
function leaveCurrent(ws: WebSocket): void {
  const entry = slotOf.get(ws);
  if (!entry) return;
  handleClose(ws);
}

// JSON 제어 메시지 처리
function handleControl(ws: WebSocket, msg: ClientToServer): void {
  switch (msg.t) {
    case 'create_room': {
      leaveCurrent(ws);
      const code = newRoomCode();
      const room: Room = { code, host: newSlot('host', ws), guest: null };
      rooms.set(code, room);
      slotOf.set(ws, { room, slot: room.host });
      send(ws, { t: 'room_created', code, token: room.host.token });
      return;
    }
    case 'join_room': {
      const room = rooms.get(msg.code);
      if (!room) return sendError(ws, 'room_not_found');
      if (room.guest?.ws) return sendError(ws, 'room_full'); // 참가자 자리에 이미 누가 붙어 있다
      leaveCurrent(ws);
      if (room.guest?.leaveTimer) clearTimeout(room.guest.leaveTimer); // 떠나는 중이던 옛 참가자 자리를 새 사람이 차지한다
      room.guest = newSlot('guest', ws);
      slotOf.set(ws, { room, slot: room.guest });
      send(ws, { t: 'room_joined', code: room.code, token: room.guest.token });
      send(room.host.ws, { t: 'peer_joined' }); // 방장에게: 상대가 왔다 (P2P 협상 시작)
      return;
    }
    case 'rejoin': {
      const room = rooms.get(msg.code);
      if (!room) return sendError(ws, 'room_not_found');
      const slot = room.host.token === msg.token ? room.host : room.guest?.token === msg.token ? room.guest : null; // 토큰으로 자리를 찾는다
      if (!slot) return sendError(ws, 'bad_token');
      attach(ws, room, slot);
      send(ws, { t: 'rejoined', code: room.code, role: slot.role });
      send(otherSlot(room, slot)?.ws ?? null, { t: 'peer_rejoined' });
      return;
    }
    case 'signal': {
      const entry = slotOf.get(ws);
      if (!entry) return;
      send(otherSlot(entry.room, entry.slot)?.ws ?? null, { t: 'signal', data: msg.data }); // 내용은 보지 않고 상대에게 그대로
      return;
    }
    default:
      sendError(ws, 'bad_message');
  }
}

// HTTP 서버 위에 웹소켓을 얹는다. 호스팅 서비스의 헬스체크와 브라우저에서 주소 확인용 응답을 준다.
const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('pocket-arena-shooter signaling server\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      // 바이너리 = 릴레이 게임 패킷: 상대에게 그대로 넘긴다
      const entry = slotOf.get(ws);
      const peer = entry ? otherSlot(entry.room, entry.slot)?.ws : null;
      if (peer?.readyState === WebSocket.OPEN) peer.send(raw, { binary: true });
      return;
    }
    let msg: ClientToServer;
    try {
      msg = JSON.parse(raw.toString()) as ClientToServer;
    } catch {
      return sendError(ws, 'bad_message');
    }
    handleControl(ws, msg);
  });
  ws.on('close', () => handleClose(ws));
});

// 호스팅 프록시가 유휴 연결을 끊지 않도록 30초마다 ping
setInterval(() => {
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.ping();
}, 30_000).unref();

server.listen(PORT, () => console.log(`[signaling] listening on http+ws://0.0.0.0:${PORT}`));
