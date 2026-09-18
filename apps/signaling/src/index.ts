import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { ClientToServer, ServerToClient, ServerErrorCode } from '@shooter/protocol';

const PORT = Number(process.env.PORT ?? 8787);

interface Room {
  code: string;
  host: WebSocket;
  guest?: WebSocket;
}

const rooms = new Map<string, Room>();
const roomOf = new WeakMap<WebSocket, Room>();

function send(ws: WebSocket, msg: ServerToClient): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, code: ServerErrorCode): void {
  send(ws, { t: 'error', code });
}

function peerOf(ws: WebSocket, room: Room): WebSocket | undefined {
  return room.host === ws ? room.guest : room.host;
}

function newRoomCode(): string {
  let code: string;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function leave(ws: WebSocket): void {
  const room = roomOf.get(ws);
  if (!room) return;
  roomOf.delete(ws);
  const peer = peerOf(ws, room);
  if (peer) send(peer, { t: 'peer_left' });
  if (room.host === ws) {
    rooms.delete(room.code);
    if (room.guest) roomOf.delete(room.guest);
  } else {
    room.guest = undefined;
  }
}

function handleControl(ws: WebSocket, msg: ClientToServer): void {
  const room = roomOf.get(ws);
  switch (msg.t) {
    case 'create_room': {
      if (room) leave(ws);
      const code = newRoomCode();
      const created: Room = { code, host: ws };
      rooms.set(code, created);
      roomOf.set(ws, created);
      send(ws, { t: 'room_created', code });
      return;
    }
    case 'join_room': {
      const target = rooms.get(msg.code);
      if (!target) return sendError(ws, 'room_not_found');
      if (target.guest) return sendError(ws, 'room_full');
      if (room) leave(ws);
      target.guest = ws;
      roomOf.set(ws, target);
      send(ws, { t: 'room_joined', code: target.code });
      send(target.host, { t: 'peer_joined' });
      return;
    }
    case 'signal': {
      const peer = room && peerOf(ws, room);
      if (peer) send(peer, { t: 'signal', data: msg.data });
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
      const room = roomOf.get(ws);
      const peer = room && peerOf(ws, room);
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
  ws.on('close', () => leave(ws));
});

console.log(`[signaling] listening on ws://0.0.0.0:${PORT}`);
