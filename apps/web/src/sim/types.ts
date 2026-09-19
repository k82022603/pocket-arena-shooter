import type { Difficulty } from './difficulty';
import type { CharacterId } from './characters';
import type { PickupKind, WeaponKind } from './weapons';

// 시뮬레이션 전체가 쓰는 상태 타입과 상수. 이 파일은 Phaser·DOM·네트워크를 모른다.

export type GameMode = 'duel' | 'coop'; // 1:1 대전 | 협동 방어전

// 한 틱 동안 한 플레이어가 낸 입력. 네트워크로 오가는 것도 이것뿐이다.
export interface InputFrame {
  moveX: number; // 이동 방향 x (-1..1, 스틱 기울기만큼 아날로그)
  moveY: number; // 이동 방향 y (-1..1)
  aimX: number; // 조준 방향 x (단위 벡터, 0이면 조준 유지)
  aimY: number; // 조준 방향 y
  fire: boolean; // 이번 틱에 방아쇠를 당기고 있는가
  dash: boolean; // 대시 요청 (한 틱짜리 펄스)
  skill: boolean; // 고유 스킬 자리. 아직 아무것도 소비하지 않는다
  // 0이면 그대로, 1~3이면 그 번호의 기본 무기로 교체 (한 틱짜리 펄스)
  swapTo: number;
}

// 입력이 없을 때 쓰는 기본값. 얼려 두어 실수로 고쳐 쓰지 못하게 한다
export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  dash: false,
  skill: false,
  swapTo: 0,
});

export interface PlayerState {
  id: 0 | 1; // 0은 방을 만든 쪽(또는 혼자 하는 사람), 1은 참가한 쪽(또는 봇)
  character: CharacterId; // 조종하는 파티마
  x: number; // 경기장 좌표 (px, 0..1280)
  y: number; // 경기장 좌표 (px, 0..720)
  hp: number; // 남은 체력. 0 이하면 다운
  aimAngle: number; // 마지막 조준 각도 (라디안). 조준 입력이 0이면 유지된다
  fireCooldown: number; // 다음 발사까지 남은 틱
  dashTicks: number; // 대시 남은 틱. 0보다 크면 빠르게 이동하고 무적
  dashCooldown: number; // 다음 대시까지 남은 틱
  // 협동 모드에서 다운된 뒤 아군이 곁에 머문 틱 수.
  reviveProgress: number;
  weapon: WeaponKind; // 지금 쏘는 무기 (픽업 무기일 수 있다)
  // 타이틀에서 고른 기본 무기. 픽업 무기가 끝나면 이것으로 돌아간다.
  baseWeapon: WeaponKind;
  // 픽업 무기 남은 틱.
  weaponTicks: number;
  boostTicks: number; // 이동 부스트 남은 틱
  // 적에게 닿았을 때 밀려나는 속도(px/s). 틱마다 줄어들어 짧게 미끄러진다
  knockX: number;
  knockY: number;
}

export const ENEMY_OWNER = 2; // 탄환 소유자 번호: 0·1은 플레이어, 2는 협동의 적
export type BulletOwner = 0 | 1 | typeof ENEMY_OWNER;

export interface BulletState {
  id: number; // 탄환 고유 번호 (연출이 새 탄·사라진 탄을 알아보는 키)
  owner: BulletOwner; // 누가 쐈는가
  kind: WeaponKind; // 어떤 무기의 탄인가 (색·관통 여부)
  // 발사를 일으킨 소유자의 입력 틱. 게스트가 예측 탄환과 권위 탄환을 대조하는 키.
  spawnTick: number;
  // 판정 시 상대 위치를 이만큼 과거로 되감는다 (호스트 전용, 전송하지 않음).
  lagTicks: number;
  // 관통탄이 이미 맞힌 대상 id (호스트 전용, 전송하지 않음).
  hits: number[];
  x: number; // 현재 위치
  y: number;
  vx: number; // 속도 (px/s)
  vy: number;
  damage: number; // 맞았을 때 주는 피해
  ttl: number; // 남은 수명 (틱). 0이 되면 사라진다
}

export type EnemyKind = 0 | 1 | 2; // 0 척후병, 1 포수, 2 강습병

export interface EnemyState {
  id: number; // 적 고유 번호 (웨이브마다 새로 발급, 되감기 버퍼의 키)
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  fireCooldown: number; // 다음 사격까지 남은 틱 (포수만 쓴다)
  contactCooldown: number; // 다음 접촉 피해까지 남은 틱
}

export interface PickupState {
  id: number;
  kind: PickupKind; // 리페어 팩·스캐터 캐논·레이저 랜스·이레이저 부스트
  x: number;
  y: number;
}

// 0 대기(카운트다운), 1 스폰 중, 2 잔여 적 소탕
export type WavePhase = 0 | 1 | 2;

export interface CoopState {
  coreHp: number; // 코어 체력. 0이 되면 패배
  wave: number; // 지금 웨이브 (0이면 첫 웨이브 전 대기)
  phase: WavePhase;
  timer: number; // 단계별 타이머: 대기 중에는 남은 휴식, 스폰 중에는 다음 적까지 남은 틱
  // 호스트 전용, 스냅샷에 싣지 않음
  spawnQueue: EnemyKind[];
  enemies: EnemyState[]; // 살아 있는 적
  nextEnemyId: number; // 다음에 스폰할 적의 id
}

// 결과 화면 통계. 호스트가 집계해 스냅샷에 실으므로 양쪽이 같은 표를 본다
export interface PlayerStats {
  shots: number; // 쏜 탄알 수 (산탄은 알마다 센다)
  hits: number; // 맞힌 탄알 수
  damageDealt: number; // 가한 피해
  damageTaken: number; // 받은 피해
  kills: number; // 협동에서 처치한 적
  dashes: number; // 대시 횟수
  downs: number; // 협동에서 다운된 횟수
}

export function emptyStats(): PlayerStats {
  return { shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, kills: 0, dashes: 0, downs: 0 };
}

// 한 경기의 전체 상태. 이것 하나와 입력만 있으면 다음 틱을 똑같이 계산할 수 있다(결정적)
export interface SimState {
  mode: GameMode;
  playerCount: 1 | 2; // 협동의 1인 방어면 1. 대전은 봇 상대여도 2
  // 혼자 하기 난이도. 둘이 하는 경기는 항상 normal이고 스냅샷에도 싣지 않는다
  difficulty: Difficulty;
  tick: number; // 절대 틱 번호 (재경기에도 계속 증가해 입력 대조가 섞이지 않는다)
  // 라운드 시작 후 진행한 틱 수 (tick은 단조 기준값에서 시작하므로 따로 센다)
  elapsed: number;
  rngState: number; // 시드 난수 상태. 같은 시드면 같은 경기가 나온다
  players: [PlayerState, PlayerState]; // 1인 방어에서도 두 칸이다(두 번째는 쓰지 않음)
  stats: [PlayerStats, PlayerStats];
  bullets: BulletState[];
  nextBulletId: number;
  pickups: PickupState[];
  pickupTimer: number; // 다음 픽업 스폰까지 남은 틱
  nextPickupId: number;
  coop: CoopState | null; // 대전이면 null
}

export const SIM = {
  tickRate: 60, // 초당 틱 수 (고정)
  dt: 1 / 60, // 한 틱의 길이 (초)
  arenaW: 1280, // 경기장 크기 (px). 화면 크기와 무관한 논리 좌표
  arenaH: 720,
  playerRadius: 18, // 플레이어 충돌 반지름
  playerSpeed: 260, // 기준 이동 속도 (px/s). 파티마별 배율을 곱한다
  bulletSpeed: 900, // 기준 탄속 (px/s)
  bulletRadius: 4, // 탄환 충돌 반지름
  bulletTtl: 90, // 기준 탄환 수명 (틱, 1.5초)
  dashSpeedMul: 3, // 대시 중 이동 속도 배율
  // 넉백 감쇠(틱당 곱). 0.8이면 처음 속도의 약 5틱 분량만큼 밀려난다
  knockDecay: 0.8,
} as const;

export const COOP = {
  coreX: 640, // 코어 위치 (경기장 중앙)
  coreY: 360,
  coreRadius: 40, // 코어 판정 반지름 (이동은 막지 않는다)
  coreMaxHp: 500,
  waves: 10, // 이만큼 막으면 승리
  breakTicks: 180, // 웨이브 사이 휴식 (3초)
  spawnIntervalTicks: 40, // 적이 한 기씩 나오는 간격 (0.67초)
  reviveRadius: 70, // 쓰러진 짝에게 이만큼 붙어 있어야 부활이 진행된다
  reviveTicks: 120, // 부활에 걸리는 시간 (2초)
  reviveHpRatio: 0.5, // 부활하면 최대 체력의 절반으로 일어난다
  enemyBulletSpeed: 500, // 포수 탄속 (px/s)
  enemyBulletDamage: 8, // 포수 탄 피해 (코어도 이만큼 깎인다)
  enemyBulletTtl: 120, // 포수 탄 수명 (틱)
  enemyEngageRange: 600, // 포수가 이 거리 안에서만 쏜다
} as const;

export interface EnemySpec {
  name: string;
  hp: number;
  speed: number; // 이동 속도 (px/s)
  radius: number; // 충돌 반지름
  contactDamage: number; // 닿았을 때 주는 피해
  contactIntervalTicks: number; // 접촉 피해 간격 (틱)
  /** 닿은 플레이어를 밀어내는 속도(px/s). 붙어서 계속 때리지 못하게 떼어 놓는다 */
  contactKnock: number;
  fireIntervalTicks: number; // 사격 간격 (0이면 쏘지 않는다)
  keepDistance: number; // 목표와 유지하려는 거리 (0이면 곧장 달려든다)
  color: number; // 그리는 색
}

// 척후병: 빠르고 약하며 가장 가까운 플레이어에게 달려든다
// 포수: 거리를 두고 쏜다. 빗나간 탄이 코어를 깎는다
// 강습병: 느리고 단단하며 플레이어를 무시하고 코어로 간다
export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  0: { name: '척후병', hp: 30, speed: 150, radius: 14, contactDamage: 6, contactIntervalTicks: 45, contactKnock: 480, fireIntervalTicks: 0, keepDistance: 0, color: 0xff5252 },
  1: { name: '포수', hp: 50, speed: 120, radius: 16, contactDamage: 5, contactIntervalTicks: 30, contactKnock: 420, fireIntervalTicks: 90, keepDistance: 320, color: 0xb388ff },
  2: { name: '강습병', hp: 200, speed: 70, radius: 26, contactDamage: 20, contactIntervalTicks: 60, contactKnock: 720, fireIntervalTicks: 0, keepDistance: 0, color: 0x8d1f1f },
};
