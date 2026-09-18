import { characterAt, characterIndex, type CharacterId } from './characters';
import type { BulletState, InputFrame, PlayerState, SimState } from './types';

export const PACKET_INPUT = 0x01;
export const PACKET_CHARACTER = 0x02;
export const PACKET_SNAPSHOT = 0x03;

export const INPUT_PACKET_SIZE = 10;

const BIT_FIRE = 1 << 0;
const BIT_DASH = 1 << 1;
const BIT_SKILL = 1 << 2;

function quantize(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127);
}

export function encodeInput(tick: number, f: InputFrame, out = new Uint8Array(INPUT_PACKET_SIZE)): Uint8Array {
  const view = new DataView(out.buffer, out.byteOffset, INPUT_PACKET_SIZE);
  view.setUint8(0, PACKET_INPUT);
  view.setUint32(1, tick >>> 0);
  view.setInt8(5, quantize(f.moveX));
  view.setInt8(6, quantize(f.moveY));
  view.setInt8(7, quantize(f.aimX));
  view.setInt8(8, quantize(f.aimY));
  view.setUint8(9, (f.fire ? BIT_FIRE : 0) | (f.dash ? BIT_DASH : 0) | (f.skill ? BIT_SKILL : 0));
  return out;
}

export function decodeInput(buf: Uint8Array): { tick: number; frame: InputFrame } | null {
  if (buf.byteLength < INPUT_PACKET_SIZE || buf[0] !== PACKET_INPUT) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, INPUT_PACKET_SIZE);
  const bits = view.getUint8(9);
  return {
    tick: view.getUint32(1),
    frame: {
      moveX: view.getInt8(5) / 127,
      moveY: view.getInt8(6) / 127,
      aimX: view.getInt8(7) / 127,
      aimY: view.getInt8(8) / 127,
      fire: (bits & BIT_FIRE) !== 0,
      dash: (bits & BIT_DASH) !== 0,
      skill: (bits & BIT_SKILL) !== 0,
    },
  };
}

export function encodeCharacter(id: CharacterId): Uint8Array {
  return Uint8Array.of(PACKET_CHARACTER, characterIndex(id));
}

export function decodeCharacter(buf: Uint8Array): CharacterId | null {
  if (buf.byteLength !== 2 || buf[0] !== PACKET_CHARACTER) return null;
  return characterAt(buf[1]!);
}

// snapshot: [type u8][tick u32][ackTick u32][nextBulletId u32][bulletCount u8][player x2][bullet xN]
const SNAPSHOT_HEADER = 1 + 4 + 4 + 4 + 1;
const PLAYER_BYTES = 1 + 4 + 4 + 2 + 4 + 1 + 1 + 1;
const BULLET_BYTES = 4 + 1 + 4 + 4 + 4 + 4 + 1 + 1;
const MAX_SNAPSHOT_BULLETS = 255;

export interface Snapshot {
  state: SimState;
  ackTick: number;
}

export function encodeSnapshot(state: SimState, ackTick: number): Uint8Array {
  const bullets = state.bullets.length > MAX_SNAPSHOT_BULLETS ? state.bullets.slice(-MAX_SNAPSHOT_BULLETS) : state.bullets;
  const buf = new Uint8Array(SNAPSHOT_HEADER + 2 * PLAYER_BYTES + bullets.length * BULLET_BYTES);
  const v = new DataView(buf.buffer);
  let o = 0;
  v.setUint8(o, PACKET_SNAPSHOT);
  v.setUint32(o + 1, state.tick >>> 0);
  v.setUint32(o + 5, ackTick >>> 0);
  v.setUint32(o + 9, state.nextBulletId >>> 0);
  v.setUint8(o + 13, bullets.length);
  o = SNAPSHOT_HEADER;
  for (const p of state.players) {
    v.setUint8(o, characterIndex(p.character));
    v.setFloat32(o + 1, p.x);
    v.setFloat32(o + 5, p.y);
    v.setUint16(o + 9, p.hp);
    v.setFloat32(o + 11, p.aimAngle);
    v.setUint8(o + 15, p.fireCooldown);
    v.setUint8(o + 16, p.dashTicks);
    v.setUint8(o + 17, p.dashCooldown);
    o += PLAYER_BYTES;
  }
  for (const b of bullets) {
    v.setUint32(o, b.id >>> 0);
    v.setUint8(o + 4, b.owner);
    v.setFloat32(o + 5, b.x);
    v.setFloat32(o + 9, b.y);
    v.setFloat32(o + 13, b.vx);
    v.setFloat32(o + 17, b.vy);
    v.setUint8(o + 21, b.damage);
    v.setUint8(o + 22, b.ttl);
    o += BULLET_BYTES;
  }
  return buf;
}

export function decodeSnapshot(buf: Uint8Array): Snapshot | null {
  if (buf.byteLength < SNAPSHOT_HEADER + 2 * PLAYER_BYTES || buf[0] !== PACKET_SNAPSHOT) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tick = v.getUint32(1);
  const ackTick = v.getUint32(5);
  const nextBulletId = v.getUint32(9);
  const bulletCount = v.getUint8(13);
  if (buf.byteLength < SNAPSHOT_HEADER + 2 * PLAYER_BYTES + bulletCount * BULLET_BYTES) return null;

  let o = SNAPSHOT_HEADER;
  const players: PlayerState[] = [];
  for (let id = 0 as 0 | 1; id < 2; id = (id + 1) as 0 | 1) {
    players.push({
      id,
      character: characterAt(v.getUint8(o)),
      x: v.getFloat32(o + 1),
      y: v.getFloat32(o + 5),
      hp: v.getUint16(o + 9),
      aimAngle: v.getFloat32(o + 11),
      fireCooldown: v.getUint8(o + 15),
      dashTicks: v.getUint8(o + 16),
      dashCooldown: v.getUint8(o + 17),
    });
    o += PLAYER_BYTES;
  }
  const bullets: BulletState[] = [];
  for (let i = 0; i < bulletCount; i++) {
    bullets.push({
      id: v.getUint32(o),
      owner: v.getUint8(o + 4) as 0 | 1,
      x: v.getFloat32(o + 5),
      y: v.getFloat32(o + 9),
      vx: v.getFloat32(o + 13),
      vy: v.getFloat32(o + 17),
      damage: v.getUint8(o + 21),
      ttl: v.getUint8(o + 22),
    });
    o += BULLET_BYTES;
  }
  return { state: { tick, players: players as [PlayerState, PlayerState], bullets, nextBulletId }, ackTick };
}
