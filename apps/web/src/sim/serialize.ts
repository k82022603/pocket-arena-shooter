import { characterAt, characterIndex, type CharacterId } from './characters';
import type {
  BulletOwner,
  BulletState,
  CoopState,
  EnemyKind,
  EnemyState,
  InputFrame,
  PickupState,
  PlayerState,
  SimState,
  WavePhase,
} from './types';

export const PACKET_INPUT = 0x01;
export const PACKET_CHARACTER = 0x02;
export const PACKET_SNAPSHOT = 0x03;

// 입력 패킷은 최신 틱과 그 직전 틱들의 프레임을 중복 실어 손실을 재전송 없이 메운다.
export const INPUT_REDUNDANCY = 3;
const FRAME_BYTES = 5;
export const INPUT_PACKET_SIZE = 1 + 4 + INPUT_REDUNDANCY * FRAME_BYTES;

const BIT_FIRE = 1 << 0;
const BIT_DASH = 1 << 1;
const BIT_SKILL = 1 << 2;

function quantize(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127);
}

export interface TickedInput {
  tick: number;
  frame: InputFrame;
}

// frames[0]이 `tick`의 입력, frames[i]는 `tick - i`의 입력. 부족하면 마지막 것을 반복한다.
export function encodeInput(tick: number, frames: readonly InputFrame[]): Uint8Array {
  const out = new Uint8Array(INPUT_PACKET_SIZE);
  const view = new DataView(out.buffer);
  view.setUint8(0, PACKET_INPUT);
  view.setUint32(1, tick >>> 0);
  for (let i = 0; i < INPUT_REDUNDANCY; i++) {
    const f = frames[Math.min(i, frames.length - 1)]!;
    const o = 5 + i * FRAME_BYTES;
    view.setInt8(o, quantize(f.moveX));
    view.setInt8(o + 1, quantize(f.moveY));
    view.setInt8(o + 2, quantize(f.aimX));
    view.setInt8(o + 3, quantize(f.aimY));
    view.setUint8(o + 4, (f.fire ? BIT_FIRE : 0) | (f.dash ? BIT_DASH : 0) | (f.skill ? BIT_SKILL : 0));
  }
  return out;
}

export function decodeInput(buf: Uint8Array): TickedInput[] | null {
  if (buf.byteLength < INPUT_PACKET_SIZE || buf[0] !== PACKET_INPUT) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, INPUT_PACKET_SIZE);
  const tick = view.getUint32(1);
  const result: TickedInput[] = [];
  for (let i = 0; i < INPUT_REDUNDANCY; i++) {
    const o = 5 + i * FRAME_BYTES;
    const bits = view.getUint8(o + 4);
    result.push({
      tick: tick - i,
      frame: {
        moveX: view.getInt8(o) / 127,
        moveY: view.getInt8(o + 1) / 127,
        aimX: view.getInt8(o + 2) / 127,
        aimY: view.getInt8(o + 3) / 127,
        fire: (bits & BIT_FIRE) !== 0,
        dash: (bits & BIT_DASH) !== 0,
        skill: (bits & BIT_SKILL) !== 0,
      },
    });
  }
  return result;
}

export function encodeCharacter(id: CharacterId): Uint8Array {
  return Uint8Array.of(PACKET_CHARACTER, characterIndex(id));
}

export function decodeCharacter(buf: Uint8Array): CharacterId | null {
  if (buf.byteLength !== 2 || buf[0] !== PACKET_CHARACTER) return null;
  return characterAt(buf[1]!);
}

class Writer {
  private o = 0;
  readonly view: DataView;
  constructor(readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(v: number): void {
    this.view.setUint8(this.o, v);
    this.o += 1;
  }
  u16(v: number): void {
    this.view.setUint16(this.o, v);
    this.o += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.o, v >>> 0);
    this.o += 4;
  }
  f32(v: number): void {
    this.view.setFloat32(this.o, v);
    this.o += 4;
  }
}

class Reader {
  private o = 0;
  private readonly view: DataView;
  constructor(buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get remaining(): number {
    return this.view.byteLength - this.o;
  }
  u8(): number {
    const v = this.view.getUint8(this.o);
    this.o += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.o);
    this.o += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.o);
    this.o += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.o);
    this.o += 4;
    return v;
  }
}

// snapshot: header, player x2, bullet xN, (coop) core/wave, enemy xM, pickup xK
const HEADER_BYTES = 1 + 4 + 4 + 4 + 1 + 1 + 1 + 1;
const PLAYER_BYTES = 1 + 4 + 4 + 2 + 4 + 1 + 1 + 1 + 1;
const BULLET_BYTES = 4 + 1 + 4 + 4 + 4 + 4 + 4 + 1 + 1;
const COOP_BYTES = 2 + 1 + 1 + 2 + 4 + 1 + 1;
const ENEMY_BYTES = 4 + 1 + 4 + 4 + 2;
const PICKUP_BYTES = 4 + 4 + 4;
const MAX_LIST = 255;

export interface Snapshot {
  state: SimState;
  ackTick: number;
}

export function encodeSnapshot(state: SimState, ackTick: number): Uint8Array {
  const bullets = state.bullets.length > MAX_LIST ? state.bullets.slice(-MAX_LIST) : state.bullets;
  const coop = state.coop;
  const enemies = coop ? coop.enemies.slice(0, MAX_LIST) : [];
  const pickups = coop ? coop.pickups.slice(0, MAX_LIST) : [];
  const size =
    HEADER_BYTES +
    2 * PLAYER_BYTES +
    bullets.length * BULLET_BYTES +
    (coop ? COOP_BYTES + enemies.length * ENEMY_BYTES + pickups.length * PICKUP_BYTES : 0);
  const w = new Writer(new Uint8Array(size));

  w.u8(PACKET_SNAPSHOT);
  w.u32(state.tick);
  w.u32(ackTick);
  w.u32(state.nextBulletId);
  w.u8(state.mode === 'coop' ? 1 : 0);
  w.u8(state.playerCount);
  w.u8(bullets.length);
  w.u8(0);

  for (const p of state.players) {
    w.u8(characterIndex(p.character));
    w.f32(p.x);
    w.f32(p.y);
    w.u16(p.hp);
    w.f32(p.aimAngle);
    w.u8(p.fireCooldown);
    w.u8(p.dashTicks);
    w.u8(p.dashCooldown);
    w.u8(p.reviveProgress);
  }
  for (const b of bullets) {
    w.u32(b.id);
    w.u8(b.owner);
    w.u32(b.spawnTick);
    w.f32(b.x);
    w.f32(b.y);
    w.f32(b.vx);
    w.f32(b.vy);
    w.u8(b.damage);
    w.u8(b.ttl);
  }
  if (coop) {
    w.u16(coop.coreHp);
    w.u8(coop.wave);
    w.u8(coop.phase);
    w.u16(coop.timer);
    w.u32(coop.nextEnemyId);
    w.u8(enemies.length);
    w.u8(pickups.length);
    for (const e of enemies) {
      w.u32(e.id);
      w.u8(e.kind);
      w.f32(e.x);
      w.f32(e.y);
      w.u16(e.hp);
    }
    for (const pk of pickups) {
      w.u32(pk.id);
      w.f32(pk.x);
      w.f32(pk.y);
    }
  }
  return w.buf;
}

export function decodeSnapshot(buf: Uint8Array): Snapshot | null {
  if (buf.byteLength < HEADER_BYTES + 2 * PLAYER_BYTES || buf[0] !== PACKET_SNAPSHOT) return null;
  const r = new Reader(buf);
  r.u8();
  const tick = r.u32();
  const ackTick = r.u32();
  const nextBulletId = r.u32();
  const mode = r.u8() === 1 ? 'coop' : 'duel';
  const playerCount = r.u8() === 1 ? 1 : 2;
  const bulletCount = r.u8();
  r.u8();
  if (r.remaining < 2 * PLAYER_BYTES + bulletCount * BULLET_BYTES) return null;

  const players: PlayerState[] = [];
  for (let id = 0 as 0 | 1; id < 2; id = (id + 1) as 0 | 1) {
    players.push({
      id,
      character: characterAt(r.u8()),
      x: r.f32(),
      y: r.f32(),
      hp: r.u16(),
      aimAngle: r.f32(),
      fireCooldown: r.u8(),
      dashTicks: r.u8(),
      dashCooldown: r.u8(),
      reviveProgress: r.u8(),
    });
  }
  const bullets: BulletState[] = [];
  for (let i = 0; i < bulletCount; i++) {
    bullets.push({
      id: r.u32(),
      owner: r.u8() as BulletOwner,
      spawnTick: r.u32(),
      lagTicks: 0,
      x: r.f32(),
      y: r.f32(),
      vx: r.f32(),
      vy: r.f32(),
      damage: r.u8(),
      ttl: r.u8(),
    });
  }

  let coop: CoopState | null = null;
  if (mode === 'coop') {
    if (r.remaining < COOP_BYTES) return null;
    const coreHp = r.u16();
    const wave = r.u8();
    const phase = r.u8() as WavePhase;
    const timer = r.u16();
    const nextEnemyId = r.u32();
    const enemyCount = r.u8();
    const pickupCount = r.u8();
    if (r.remaining < enemyCount * ENEMY_BYTES + pickupCount * PICKUP_BYTES) return null;
    const enemies: EnemyState[] = [];
    for (let i = 0; i < enemyCount; i++) {
      enemies.push({
        id: r.u32(),
        kind: r.u8() as EnemyKind,
        x: r.f32(),
        y: r.f32(),
        hp: r.u16(),
        fireCooldown: 0,
        contactCooldown: 0,
      });
    }
    const pickups: PickupState[] = [];
    for (let i = 0; i < pickupCount; i++) {
      pickups.push({ id: r.u32(), x: r.f32(), y: r.f32() });
    }
    coop = { coreHp, wave, phase, timer, spawnQueue: [], enemies, pickups, nextEnemyId, pickupTimer: 0 };
  }

  return {
    state: {
      mode,
      playerCount,
      tick,
      rngState: 0,
      players: players as [PlayerState, PlayerState],
      bullets,
      nextBulletId,
      coop,
    },
    ackTick,
  };
}
