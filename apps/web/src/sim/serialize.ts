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
  PlayerStats,
  SimState,
  WavePhase,
} from './types';
import type { PickupKind, WeaponKind } from './weapons';

// 네트워크로 오가는 게임 패킷의 바이너리 인코딩/디코딩. JSON보다 약 5배 작다.
// 모든 패킷의 첫 바이트가 종류를 가리킨다. 다중 바이트 값은 DataView 기본값인 빅엔디언이다.

export const PACKET_INPUT = 0x01; // 참가한 쪽 → 방을 만든 쪽: 입력 (지연 우선 채널)
export const PACKET_CHARACTER = 0x02; // 양방향: 고른 파티마와 무기 (신뢰 채널)
export const PACKET_SNAPSHOT = 0x03; // 방을 만든 쪽 → 참가한 쪽: 월드 전체 상태 (20Hz)
export const PACKET_REMATCH = 0x04; // 양방향: 다시 하기 신호

// 결과 화면에서 "다시 하기"를 눌렀다는 신호. 양쪽이 준비되면 같이 시작한다.
export function encodeRematch(): Uint8Array {
  return Uint8Array.of(PACKET_REMATCH);
}

export function isRematch(buf: Uint8Array): boolean {
  return buf.byteLength === 1 && buf[0] === PACKET_REMATCH;
}

// 입력 패킷은 최신 틱과 그 직전 틱들의 프레임을 중복 실어 손실을 재전송 없이 메운다.
export const INPUT_REDUNDANCY = 3; // 한 패킷에 실는 프레임 수 (지금 틱 + 직전 2틱)
const FRAME_BYTES = 5; // 이동 x·y, 조준 x·y 각 1바이트 + 버튼 비트 1바이트
export const INPUT_PACKET_SIZE = 1 + 4 + INPUT_REDUNDANCY * FRAME_BYTES; // 종류 + 틱 + 프레임들 = 20바이트

// 버튼 바이트의 비트 배치. 3~4번 비트에는 무기 교체 번호(0~3)가 들어간다
const BIT_FIRE = 1 << 0;
const BIT_DASH = 1 << 1;
const BIT_SKILL = 1 << 2;

// -1..1 실수를 -127..127 정수로 줄인다 (1바이트). 정밀도는 약 0.008
function quantize(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127);
}

export interface TickedInput {
  tick: number; // 이 입력이 적용될 틱
  frame: InputFrame;
}

// frames[0]이 `tick`의 입력, frames[i]는 `tick - i`의 입력. 부족하면 마지막 것을 반복한다.
export function encodeInput(tick: number, frames: readonly InputFrame[]): Uint8Array {
  const out = new Uint8Array(INPUT_PACKET_SIZE);
  const view = new DataView(out.buffer);
  view.setUint8(0, PACKET_INPUT);
  view.setUint32(1, tick >>> 0); // 음수가 들어와도 부호 없는 32비트로
  for (let i = 0; i < INPUT_REDUNDANCY; i++) {
    const f = frames[Math.min(i, frames.length - 1)]!;
    const o = 5 + i * FRAME_BYTES; // 이 프레임이 시작하는 위치
    view.setInt8(o, quantize(f.moveX));
    view.setInt8(o + 1, quantize(f.moveY));
    view.setInt8(o + 2, quantize(f.aimX));
    view.setInt8(o + 3, quantize(f.aimY));
    view.setUint8(
      o + 4,
      (f.fire ? BIT_FIRE : 0) | (f.dash ? BIT_DASH : 0) | (f.skill ? BIT_SKILL : 0) | ((f.swapTo & 3) << 3),
    );
  }
  return out;
}

// 입력 패킷을 틱별 입력 목록으로 푼다. 형식이 틀리면 null
export function decodeInput(buf: Uint8Array): TickedInput[] | null {
  if (buf.byteLength < INPUT_PACKET_SIZE || buf[0] !== PACKET_INPUT) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, INPUT_PACKET_SIZE);
  const tick = view.getUint32(1);
  const result: TickedInput[] = [];
  for (let i = 0; i < INPUT_REDUNDANCY; i++) {
    const o = 5 + i * FRAME_BYTES;
    const bits = view.getUint8(o + 4);
    result.push({
      tick: tick - i, // 뒤쪽 프레임일수록 과거 틱
      frame: {
        moveX: view.getInt8(o) / 127,
        moveY: view.getInt8(o + 1) / 127,
        aimX: view.getInt8(o + 2) / 127,
        aimY: view.getInt8(o + 3) / 127,
        fire: (bits & BIT_FIRE) !== 0,
        dash: (bits & BIT_DASH) !== 0,
        skill: (bits & BIT_SKILL) !== 0,
        swapTo: (bits >> 3) & 3,
      },
    });
  }
  return result;
}

export interface CharacterChoice {
  character: CharacterId;
  weapon: WeaponKind; // 기본 무기
}

// 캐릭터 패킷: [종류, 파티마 번호, 무기 번호] 3바이트
export function encodeCharacter(id: CharacterId, weapon: WeaponKind): Uint8Array {
  return Uint8Array.of(PACKET_CHARACTER, characterIndex(id), weapon);
}

export function decodeCharacter(buf: Uint8Array): CharacterChoice | null {
  if (buf.byteLength !== 3 || buf[0] !== PACKET_CHARACTER) return null;
  return { character: characterAt(buf[1]!), weapon: buf[2] as WeaponKind };
}

// 바이트 배열에 앞에서부터 차례로 값을 써 넣는 도우미. 쓸 때마다 위치(o)가 앞으로 간다
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

// Writer의 반대: 앞에서부터 차례로 읽는다. 쓴 순서와 똑같이 읽어야 한다
class Reader {
  private o = 0;
  private readonly view: DataView;
  constructor(buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get remaining(): number {
    return this.view.byteLength - this.o; // 아직 안 읽은 바이트 수 (잘린 패킷 검사용)
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

// snapshot: header, player x2, stats x2, bullet xN, pickup xK, (coop) core/wave, enemy xM
// 각 크기는 아래 encodeSnapshot에서 쓰는 필드 크기의 합이다. 필드를 바꾸면 여기도 같이 바꾼다
const HEADER_BYTES = 1 + 4 + 4 + 4 + 4 + 1 + 1 + 1 + 1; // 종류, 틱, 확인 틱, 다음 탄 id, 경과 틱, 모드, 인원, 탄 수, 픽업 수
const PLAYER_BYTES = 1 + 4 + 4 + 2 + 4 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 2 + 4 + 4;
const STATS_FIELDS: (keyof PlayerStats)[] = ['shots', 'hits', 'damageDealt', 'damageTaken', 'kills', 'dashes', 'downs'];
const STATS_BYTES = STATS_FIELDS.length * 4; // 통계는 모두 u32
const BULLET_BYTES = 4 + 1 + 1 + 4 + 4 + 4 + 4 + 4 + 1 + 1;
const PICKUP_BYTES = 4 + 1 + 4 + 4;
const COOP_BYTES = 2 + 1 + 1 + 2 + 4 + 1; // 코어 HP, 웨이브, 단계, 타이머, 다음 적 id, 적 수
const ENEMY_BYTES = 4 + 1 + 4 + 4 + 2;
const MAX_LIST = 255; // 개수를 1바이트에 담으므로 목록마다 최대 255개

export interface Snapshot {
  state: SimState;
  ackTick: number; // 방을 만든 쪽이 이 시점까지 적용한 참가자 입력의 마지막 틱 (재조정 기준)
}

// 월드 전체를 한 패킷으로. 참가한 쪽은 이것만으로 화면과 판정 기준을 다시 세운다
export function encodeSnapshot(state: SimState, ackTick: number): Uint8Array {
  // 개수 한도를 넘으면 탄은 최신 것을, 나머지는 앞의 것을 남긴다
  const bullets = state.bullets.length > MAX_LIST ? state.bullets.slice(-MAX_LIST) : state.bullets;
  const pickups = state.pickups.slice(0, MAX_LIST);
  const coop = state.coop;
  const enemies = coop ? coop.enemies.slice(0, MAX_LIST) : [];
  // 필요한 크기를 먼저 계산해 한 번에 할당한다
  const size =
    HEADER_BYTES +
    2 * (PLAYER_BYTES + STATS_BYTES) +
    bullets.length * BULLET_BYTES +
    pickups.length * PICKUP_BYTES +
    (coop ? COOP_BYTES + enemies.length * ENEMY_BYTES : 0);
  const w = new Writer(new Uint8Array(size));

  // 헤더
  w.u8(PACKET_SNAPSHOT);
  w.u32(state.tick);
  w.u32(ackTick);
  w.u32(state.nextBulletId);
  w.u32(state.elapsed);
  w.u8(state.mode === 'coop' ? 1 : 0);
  w.u8(state.playerCount);
  w.u8(bullets.length);
  w.u8(pickups.length);

  // 플레이어 두 명 (1인 방어여도 두 칸을 다 보낸다)
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
    w.u8(p.weapon);
    w.u8(p.baseWeapon);
    w.u16(p.weaponTicks);
    w.u16(p.boostTicks);
    w.f32(p.knockX); // 넉백 속도: 참가한 쪽 예측이 같은 궤적을 그리려면 필요하다
    w.f32(p.knockY);
  }
  // 결과 화면 통계. 호스트가 센 것을 그대로 보내 양쪽이 같은 표를 본다
  for (const s of state.stats) for (const field of STATS_FIELDS) w.u32(s[field]);
  // 탄환. lagTicks·hits는 호스트 판정에만 쓰므로 보내지 않는다
  for (const b of bullets) {
    w.u32(b.id);
    w.u8(b.owner);
    w.u8(b.kind);
    w.u32(b.spawnTick);
    w.f32(b.x);
    w.f32(b.y);
    w.f32(b.vx);
    w.f32(b.vy);
    w.u8(b.damage);
    w.u8(b.ttl);
  }
  for (const pk of pickups) {
    w.u32(pk.id);
    w.u8(pk.kind);
    w.f32(pk.x);
    w.f32(pk.y);
  }
  // 협동 전용 부분. 스폰 대기열은 호스트만 알면 되므로 보내지 않는다
  if (coop) {
    w.u16(coop.coreHp);
    w.u8(coop.wave);
    w.u8(coop.phase);
    w.u16(coop.timer);
    w.u32(coop.nextEnemyId);
    w.u8(enemies.length);
    for (const e of enemies) {
      w.u32(e.id);
      w.u8(e.kind);
      w.f32(e.x);
      w.f32(e.y);
      w.u16(e.hp);
    }
  }
  return w.buf;
}

// 스냅샷을 상태로 되돌린다. 길이가 모자라거나 종류가 다르면 null (잘린 패킷을 믿지 않는다)
export function decodeSnapshot(buf: Uint8Array): Snapshot | null {
  if (buf.byteLength < HEADER_BYTES + 2 * (PLAYER_BYTES + STATS_BYTES) || buf[0] !== PACKET_SNAPSHOT) return null;
  const r = new Reader(buf);
  r.u8(); // 종류 바이트는 위에서 확인했으니 건너뛴다
  const tick = r.u32();
  const ackTick = r.u32();
  const nextBulletId = r.u32();
  const elapsed = r.u32();
  const mode = r.u8() === 1 ? 'coop' : 'duel';
  const playerCount = r.u8() === 1 ? 1 : 2;
  const bulletCount = r.u8();
  const pickupCount = r.u8();
  // 헤더가 말하는 개수만큼의 바이트가 실제로 있는지 먼저 확인한다
  if (r.remaining < 2 * (PLAYER_BYTES + STATS_BYTES) + bulletCount * BULLET_BYTES + pickupCount * PICKUP_BYTES) return null;

  const players: PlayerState[] = [];
  for (let id = 0 as 0 | 1; id < 2; id = (id + 1) as 0 | 1) {
    // 객체 리터럴의 필드 순서가 곧 읽는 순서다. encodeSnapshot과 순서를 맞춘다
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
      weapon: r.u8() as WeaponKind,
      baseWeapon: r.u8() as WeaponKind,
      weaponTicks: r.u16(),
      boostTicks: r.u16(),
      knockX: r.f32(),
      knockY: r.f32(),
    });
  }
  const stats: PlayerStats[] = [];
  for (let i = 0; i < 2; i++) {
    const s: PlayerStats = { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, dashes: 0, downs: 0 };
    for (const field of STATS_FIELDS) s[field] = r.u32();
    stats.push(s);
  }
  const bullets: BulletState[] = [];
  for (let i = 0; i < bulletCount; i++) {
    bullets.push({
      id: r.u32(),
      owner: r.u8() as BulletOwner,
      kind: r.u8() as WeaponKind,
      spawnTick: r.u32(),
      lagTicks: 0, // 보내지 않은 필드는 기본값으로
      hits: [],
      x: r.f32(),
      y: r.f32(),
      vx: r.f32(),
      vy: r.f32(),
      damage: r.u8(),
      ttl: r.u8(),
    });
  }
  const pickups: PickupState[] = [];
  for (let i = 0; i < pickupCount; i++) {
    pickups.push({ id: r.u32(), kind: r.u8() as PickupKind, x: r.f32(), y: r.f32() });
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
    if (r.remaining < enemyCount * ENEMY_BYTES) return null;
    const enemies: EnemyState[] = [];
    for (let i = 0; i < enemyCount; i++) {
      enemies.push({
        id: r.u32(),
        kind: r.u8() as EnemyKind,
        x: r.f32(),
        y: r.f32(),
        hp: r.u16(),
        fireCooldown: 0, // 적의 공격은 호스트만 계산하므로 참가한 쪽에는 필요 없다
        contactCooldown: 0,
      });
    }
    coop = { coreHp, wave, phase, timer, spawnQueue: [], enemies, nextEnemyId };
  }

  return {
    state: {
      mode,
      playerCount,
      difficulty: 'normal', // 둘이 하는 경기는 항상 normal (스냅샷에 싣지 않는다)
      tick,
      elapsed,
      rngState: 0, // 난수는 호스트만 쓴다
      players: players as [PlayerState, PlayerState],
      stats: stats as [PlayerStats, PlayerStats],
      bullets,
      nextBulletId,
      pickups,
      pickupTimer: 0,
      nextPickupId: 0,
      coop,
    },
    ackTick,
  };
}
