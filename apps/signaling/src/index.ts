import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { REJOIN_GRACE_MS, type ClientToServer, type PeerRole, type ServerErrorCode, type ServerToClient } from '@shooter/protocol';

const PORT = Number(process.env.PORT ?? 8787);

interface Slot {
  role: PeerRole;
  token: string;
  ws: WebSocket | null;
  leaveTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  host: Slot;
  guest: Slot | null;
}

const rooms = new Map<string, Room>();
const slotOf = new WeakMap<WebSocket, { room: Room; slot: Slot }>();

function send(ws: WebSocket | null, msg: ServerToClient): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, code: ServerErrorCode): void {
  send(ws, { t: 'error', code });
}

function otherSlot(room: Room, slot: Slot): Slot | null {
  return slot === room.host ? room.guest : room.host;
}

function newRoomCode(): string {
  let code: string;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function newSlot(role: PeerRole, ws: WebSocket): Slot {
  return { role, token: randomUUID(), ws, leaveTimer: null };
}

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
  if (slot.ws !== ws) return;
  slot.ws = null;
  send(otherSlot(room, slot)?.ws ?? null, { t: 'peer_disconnected' });
  slot.leaveTimer = setTimeout(() => {
    slot.leaveTimer = null;
    if (slot.ws) return;
    if (slot === room.host) {
      rooms.delete(room.code);
      send(room.guest?.ws ?? null, { t: 'peer_left' });
      if (room.guest?.ws) slotOf.delete(room.guest.ws);
    } else {
      room.guest = null;
      send(room.host.ws, { t: 'peer_left' });
    }
  }, REJOIN_GRACE_MS);
}

function leaveCurrent(ws: WebSocket): void {
  const entry = slotOf.get(ws);
  if (!entry) return;
  handleClose(ws);
}

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
      if (room.guest?.ws) return sendError(ws, 'room_full');
      leaveCurrent(ws);
      if (room.guest?.leaveTimer) clearTimeout(room.guest.leaveTimer);
      room.guest = newSlot('guest', ws);
      slotOf.set(ws, { room, slot: room.guest });
      send(ws, { t: 'room_joined', code: room.code, token: room.guest.token });
      send(room.host.ws, { t: 'peer_joined' });
      return;
    }
    case 'rejoin': {
      const room = rooms.get(msg.code);
      if (!room) return sendError(ws, 'room_not_found');
      const slot = room.host.token === msg.token ? room.host : room.guest?.token === msg.token ? room.guest : null;
      if (!slot) return sendError(ws, 'bad_token');
      attach(ws, room, slot);
      send(ws, { t: 'rejoined', code: room.code, role: slot.role });
      send(otherSlot(room, slot)?.ws ?? null, { t: 'peer_rejoined' });
      return;
    }
    case 'signal': {
      const entry = slotOf.get(ws);
      if (!entry) return;
      send(otherSlot(entry.room, entry.slot)?.ws ?? null, { t: 'signal', data: msg.data });
      return;
    }
    default:
      sendError(ws, 'bad_message');
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
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

console.log(`[signaling] listening on ws://0.0.0.0:${PORT}`);
