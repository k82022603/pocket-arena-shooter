// 화면 없이(헤드리스) 시뮬레이션 코어만 돌려 규칙을 확인한다: npm run check:sim
import { createInitialState, setPlayerLoadout, step } from '../apps/web/src/sim/core';
import { botInput, createBotMemory } from '../apps/web/src/sim/bot';
import { EMPTY_INPUT, type InputFrame } from '../apps/web/src/sim/types';
import { decodeCharacter, decodeSnapshot, encodeCharacter, encodeSnapshot } from '../apps/web/src/sim/serialize';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const fire: InputFrame = { ...EMPTY_INPUT, aimX: 1, aimY: 0, fire: true };

// 산탄총 픽업 → 5발 부채꼴
const s = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 7 });
s.pickups.push({ id: 99, kind: 1, x: s.players[0].x, y: s.players[0].y });
step(s, [EMPTY_INPUT, EMPTY_INPUT]);
check('산탄총 픽업 적용', s.players[0].weapon === 1 && s.players[0].weaponTicks === 600 && s.pickups.length === 0);
step(s, [fire, EMPTY_INPUT]);
check('산탄총 5발 발사', s.bullets.length === 5 && s.bullets.every((b) => b.kind === 1), `damage ${s.bullets[0]?.damage}`);

// 레이저 관통
const l = createInitialState(['atropos', 'est'], { mode: 'duel', playerCount: 2, seed: 7 });
l.players[1].x = l.players[0].x + 200;
l.players[1].y = l.players[0].y;
l.pickups.push({ id: 5, kind: 2, x: l.players[0].x, y: l.players[0].y });
step(l, [EMPTY_INPUT, EMPTY_INPUT]);
step(l, [fire, EMPTY_INPUT]);
let aliveAfterHit = false;
for (let i = 0; i < 40; i++) {
  step(l, [EMPTY_INPUT, EMPTY_INPUT]);
  if (l.players[1].hp < 130 && l.bullets.length > 0) aliveAfterHit = true;
}
check('레이저 관통 (맞힌 뒤에도 계속 날아감)', aliveAfterHit && l.players[1].hp === 106, `est hp ${l.players[1].hp}`);

// 속도 부스트
const bst = createInitialState(['clotho', 'est'], { mode: 'duel', playerCount: 2, seed: 7 });
bst.pickups.push({ id: 6, kind: 3, x: bst.players[0].x, y: bst.players[0].y });
step(bst, [EMPTY_INPUT, EMPTY_INPUT]);
const x0 = bst.players[0].x;
step(bst, [{ ...EMPTY_INPUT, moveX: 1 }, EMPTY_INPUT]);
check('부스트 1.5배 속도', Math.abs(bst.players[0].x - x0 - 8.125) < 0.05, `dx ${(bst.players[0].x - x0).toFixed(2)}`);

// 15초 후 첫 픽업 스폰, 스냅샷 왕복
const sp = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 3 });
for (let i = 0; i < 900; i++) step(sp, [EMPTY_INPUT, EMPTY_INPUT]);
check('15초 후 픽업 스폰', sp.pickups.length === 1);
const snap = decodeSnapshot(encodeSnapshot(sp, 42));
check('스냅샷 왕복', !!snap && snap.state.pickups.length === 1 && snap.ackTick === 42);

// 기본 무기: 기관총은 연사가 빠르고, 픽업이 끝나면 기본 무기로 돌아온다
const lo = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 5 });
setPlayerLoadout(lo, 0, 3);
step(lo, [fire, EMPTY_INPUT]);
const smgCooldown = lo.players[0].fireCooldown;
lo.pickups.push({ id: 1, kind: 2, x: lo.players[0].x, y: lo.players[0].y });
step(lo, [EMPTY_INPUT, EMPTY_INPUT]);
const laserNow = lo.players[0].weapon === 2;
for (let i = 0; i < 600; i++) step(lo, [EMPTY_INPUT, EMPTY_INPUT]);
check('기관총 연사 간격 5틱', smgCooldown === 5, `cooldown ${smgCooldown}`);
check('픽업 종료 후 기본 무기 복귀', laserNow && lo.players[0].weapon === 3, `weapon ${lo.players[0].weapon}`);
const chr = decodeCharacter(encodeCharacter('est', 5));
check('캐릭터 패킷에 무기 포함', chr?.character === 'est' && chr.weapon === 5);

// 봇: 가만히 선 사람을 30초 안에 이기되 3초보다는 오래 걸려야 한다
const b = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 11 });
const mem = createBotMemory();
while (b.elapsed < 1800 && b.players[0].hp > 0) step(b, [EMPTY_INPUT, botInput(b, 1, mem)]);
check('봇이 가만히 선 상대를 이김', b.players[0].hp === 0 && b.elapsed > 180, `${(b.elapsed / 60).toFixed(1)}s, bot hp ${b.players[1].hp}`);

console.log(failures === 0 ? '\n모든 검사 통과' : `\n${failures}개 실패`);
process.exit(failures === 0 ? 0 : 1);
