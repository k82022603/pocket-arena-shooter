// 화면 없이(헤드리스) 시뮬레이션 코어만 돌려 규칙을 확인한다: npm run check:sim
import { createInitialState, outcomeOf, setPlayerLoadout, step, summarize } from '../apps/web/src/sim/core';
import { botInput, createBotMemory } from '../apps/web/src/sim/bot';
import { COOP, EMPTY_INPUT, ENEMY_OWNER, type InputFrame } from '../apps/web/src/sim/types';
import { decodeCharacter, decodeInput, decodeSnapshot, encodeCharacter, encodeInput, encodeSnapshot } from '../apps/web/src/sim/serialize';
import { PositionHistory } from '../apps/web/src/sim/history';
import { CHARACTERS } from '../apps/web/src/sim/characters';
import { coopResultText } from '../apps/web/src/game/outcomeText';
import { SessionLink } from '../apps/web/src/net/session';
import type { Channel, MessageHandler, Transport, Unsubscribe } from '../apps/web/src/net/transport';
import { waveComposition } from '../apps/web/src/sim/coop';
import { PICKUP } from '../apps/web/src/sim/weapons';
import { GuestSync } from '../apps/web/src/game/sync/GuestSync';
import type { SyncLink } from '../apps/web/src/game/sync/GameSync';

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
check('스캐터 캐논 픽업 적용', s.players[0].weapon === 1 && s.players[0].weaponTicks === 600 && s.pickups.length === 0);
step(s, [fire, EMPTY_INPUT]);
check('스캐터 캐논 5발 발사', s.bullets.length === 5 && s.bullets.every((b) => b.kind === 1), `damage ${s.bullets[0]?.damage}`);

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
check('레이저 랜스 관통 (맞힌 뒤에도 계속 날아감)', aliveAfterHit && l.players[1].hp === 106, `est hp ${l.players[1].hp}`);

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
check('니들 스트림 연사 간격 5틱', smgCooldown === 5, `cooldown ${smgCooldown}`);
check('픽업 종료 후 기본 무기 복귀', laserNow && lo.players[0].weapon === 3, `weapon ${lo.players[0].weapon}`);
const chr = decodeCharacter(encodeCharacter('est', 5));
check('캐릭터 패킷에 무기 포함', chr?.character === 'est' && chr.weapon === 5);

// 게임 중 무기 교체: 1~3번 선택이 기본 무기를 바꾸고, 픽업 중에는 끝난 뒤부터 적용된다
const sw = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 9 });
step(sw, [{ ...EMPTY_INPUT, swapTo: 3 }, EMPTY_INPUT]);
check('교체 3번 → 버스터 런처', sw.players[0].weapon === 4 && sw.players[0].baseWeapon === 4, `weapon ${sw.players[0].weapon}`);
step(sw, [{ ...EMPTY_INPUT, swapTo: 2 }, EMPTY_INPUT]);
check('교체 2번 → 니들 스트림', sw.players[0].weapon === 3, `weapon ${sw.players[0].weapon}`);
sw.pickups.push({ id: 7, kind: 2, x: sw.players[0].x, y: sw.players[0].y });
step(sw, [EMPTY_INPUT, EMPTY_INPUT]);
step(sw, [{ ...EMPTY_INPUT, swapTo: 1 }, EMPTY_INPUT]);
const pickupKept = sw.players[0].weapon === 2 && sw.players[0].baseWeapon === 0;
for (let i = 0; i < 600; i++) step(sw, [EMPTY_INPUT, EMPTY_INPUT]);
check('픽업 중 교체는 픽업이 끝난 뒤 적용', pickupKept && sw.players[0].weapon === 0, `weapon ${sw.players[0].weapon}`);

// 입력 패킷 왕복에 교체 번호가 실린다
const enc = encodeInput(42, [{ ...EMPTY_INPUT, fire: true, swapTo: 3 }]);
const dec = decodeInput(enc);
check('입력 패킷에 교체 번호 포함', dec?.[0]?.frame.swapTo === 3 && dec[0].frame.fire === true, `swapTo ${dec?.[0]?.frame.swapTo}`);

// 봇: 가만히 선 사람을 30초 안에 이기되 3초보다는 오래 걸려야 한다
const b = createInitialState(['lachesis', 'clotho'], { mode: 'duel', playerCount: 2, seed: 11 });
const mem = createBotMemory();
while (b.elapsed < 1800 && b.players[0].hp > 0) step(b, [EMPTY_INPUT, botInput(b, 1, mem)]);
check('봇이 가만히 선 상대를 이김', b.players[0].hp === 0 && b.elapsed > 180, `${(b.elapsed / 60).toFixed(1)}s, bot hp ${b.players[1].hp}`);

// 협동 모드 규칙
{
  const mk = (playerCount: 1 | 2 = 2) =>
    createInitialState(['lachesis', 'clotho'], { mode: 'coop', playerCount, seed: 3 });

  // 적 유탄이 코어를 깎는다 (플레이어를 비켜간 포수 탄이 코어에 들어간다)
  const core = mk();
  core.players[0].x = 60;
  core.players[0].y = 60;
  core.players[1].x = 60;
  core.players[1].y = 660;
  const coreBefore = core.coop!.coreHp;
  core.bullets.push({
    id: 1, owner: ENEMY_OWNER, kind: 0, spawnTick: 0, lagTicks: 0,
    x: COOP.coreX, y: COOP.coreY, vx: 0, vy: 0,
    damage: COOP.enemyBulletDamage, ttl: 60, hits: [],
  });
  step(core, [EMPTY_INPUT, EMPTY_INPUT]);
  check(
    '적 유탄이 코어를 깎는다',
    core.coop!.coreHp === coreBefore - COOP.enemyBulletDamage,
    '코어 ' + coreBefore + ' to ' + core.coop!.coreHp,
  );

  // 웨이브는 적을 전부 잡아야 넘어간다
  const gate = mk();
  gate.players[0].hp = 500;
  gate.players[1].hp = 500;
  gate.coop!.wave = 1;
  gate.coop!.phase = 2;
  gate.coop!.enemies.push({ id: 1, kind: 0, x: 200, y: 200, hp: 30, fireCooldown: 0, contactCooldown: 0 });
  for (let i = 0; i < 300; i++) step(gate, [EMPTY_INPUT, EMPTY_INPUT]);
  check(
    '적이 남으면 다음 웨이브로 넘어가지 않는다',
    gate.coop!.wave === 1 && gate.coop!.phase === 2,
    'wave ' + gate.coop!.wave + ' phase ' + gate.coop!.phase,
  );

  // 10웨이브를 전부 소탕하면 승리 (적을 즉시 처치하며 진행)
  const win = mk();
  win.players[0].hp = 9999;
  win.players[1].hp = 9999;
  let won: ReturnType<typeof outcomeOf> = null;
  let ticks = 0;
  while (won === null && ticks < 60_000) {
    step(win, [EMPTY_INPUT, EMPTY_INPUT]);
    for (const e of win.coop!.enemies) e.hp = 0;
    won = outcomeOf(win);
    ticks += 1;
  }
  check(
    '10웨이브 전부 소탕하면 승리',
    won !== null && won.mode === 'coop' && won.won === true && won.wave === 10,
    (ticks / 60).toFixed(0) + '초, 코어 ' + win.coop!.coreHp,
  );

  // 패배 조건 두 가지
  const dead = mk();
  dead.coop!.coreHp = 0;
  const byCore = outcomeOf(dead);
  const wiped = mk();
  wiped.players[0].hp = 0;
  wiped.players[1].hp = 0;
  const byWipe = outcomeOf(wiped);
  check(
    '코어 파괴 또는 전원 다운이면 패배',
    byCore?.mode === 'coop' && byCore.won === false && byWipe?.mode === 'coop' && byWipe.won === false,
  );

  // 혼자 하기에서는 부활이 없어 다운이 곧 패배
  const solo = mk(1);
  solo.players[0].hp = 0;
  const soloOut = outcomeOf(solo);
  check('혼자 하기는 다운이 곧 패배', soloOut?.mode === 'coop' && soloOut.won === false);

  // 다운된 아군 곁에서 2초 머물면 최대 HP 절반으로 부활
  const rev = mk();
  rev.players[0].hp = 0;
  rev.players[1].x = rev.players[0].x + 30;
  rev.players[1].y = rev.players[0].y;
  for (let i = 0; i < COOP.reviveTicks + 2; i++) step(rev, [EMPTY_INPUT, EMPTY_INPUT]);
  const half = Math.floor(CHARACTERS.lachesis.stats.maxHp * COOP.reviveHpRatio);
  check('다운된 아군 곁 2초면 절반 HP로 부활', rev.players[0].hp === half, 'hp ' + rev.players[0].hp);

  // 곁을 떠나면 진행도가 두 배로 줄어든다
  const decay = mk();
  decay.players[0].hp = 0;
  decay.players[1].x = decay.players[0].x + 30;
  decay.players[1].y = decay.players[0].y;
  for (let i = 0; i < 60; i++) step(decay, [EMPTY_INPUT, EMPTY_INPUT]);
  const near = decay.players[0].reviveProgress;
  decay.players[1].x = decay.players[0].x + 400;
  for (let i = 0; i < 10; i++) step(decay, [EMPTY_INPUT, EMPTY_INPUT]);
  const far = decay.players[0].reviveProgress;
  check('부활 진행도는 이탈하면 2배로 감소', near === 60 && far === 40, near + ' to ' + far);
  // 아군 사격은 피해를 주지 않는다 (무기 6종 전부, 바로 옆에서 10초)
  {
    let worst = 0;
    let dealt = 0;
    let coreLoss = 0;
    for (const weapon of [0, 1, 2, 3, 4, 5] as const) {
      const ff = createInitialState(['lachesis', 'atropos'], { mode: 'coop', playerCount: 2, seed: 9 });
      ff.coop!.timer = 100_000;
      ff.coop!.enemies = [];
      ff.players[0].x = 400;
      ff.players[0].y = 360;
      ff.players[1].x = 460;
      ff.players[1].y = 360;
      setPlayerLoadout(ff, 0, weapon);
      const fire = { ...EMPTY_INPUT, aimX: 1, aimY: 0, fire: true };
      for (let i = 0; i < 600; i++) step(ff, [fire, EMPTY_INPUT]);
      worst = Math.max(worst, CHARACTERS.atropos.stats.maxHp - ff.players[1].hp);
      dealt = Math.max(dealt, ff.stats[0].damageDealt);
      coreLoss = Math.max(coreLoss, COOP.coreMaxHp - ff.coop!.coreHp);
    }
    check(
      '아군과 코어는 내 탄에 맞지 않는다',
      worst === 0 && dealt === 0 && coreLoss === 0,
      '무기 6종 각 10초 근접 사격, 아군 피해 ' + worst + ' 코어 피해 ' + coreLoss,
    );
  }


  // 1인 방어는 2인보다 적 편성이 적고 픽업이 더 자주 나온다 (밸런스 조정)
  const totalFor = (pc: 1 | 2) => {
    let n = 0;
    for (let w = 1; w <= 10; w++) n += waveComposition(w, pc).length;
    return n;
  };
  const solo10 = totalFor(1);
  const duo10 = totalFor(2);
  check(
    '1인 편성은 2인보다 적다',
    solo10 === 77 && duo10 === 175 && waveComposition(1, 1).length === 2 && waveComposition(1, 2).length === 4,
    '10웨이브 합계 1인 ' + solo10 + '기 / 2인 ' + duo10 + '기',
  );

  const pkSolo = createInitialState(['lachesis', 'lachesis'], { mode: 'coop', playerCount: 1, seed: 5 });
  pkSolo.coop!.timer = 100_000;
  for (let i = 0; i < PICKUP.soloIntervalTicks; i++) step(pkSolo, [EMPTY_INPUT, EMPTY_INPUT]);
  const pkDuo = createInitialState(['lachesis', 'clotho'], { mode: 'coop', playerCount: 2, seed: 5 });
  pkDuo.coop!.timer = 100_000;
  for (let i = 0; i < PICKUP.soloIntervalTicks; i++) step(pkDuo, [EMPTY_INPUT, EMPTY_INPUT]);
  check(
    '1인 방어는 픽업이 9초마다 나온다',
    pkSolo.pickups.length === 1 && pkDuo.pickups.length === 0,
    '1인 ' + pkSolo.pickups.length + '개 / 2인 ' + pkDuo.pickups.length + '개 (' + PICKUP.soloIntervalTicks + '틱 시점)',
  );


}


// 씬 전환 중 도착한 event 메시지는 버려지면 안 된다 (두 사람이 같은 파티마가 되던 원인)
{
  let emit: (c: Channel, d: Uint8Array) => void = () => {};
  const transport = {
    kind: 'webrtc' as const,
    rtt: 0,
    send: () => {},
    onMessage: (h: MessageHandler): Unsubscribe => {
      emit = h;
      return () => {};
    },
    onClose: (): Unsubscribe => () => {},
    close: () => {},
  } as unknown as Transport;
  const link = new SessionLink('host', '123456', 'tok', { onMessage: () => () => {}, onClose: () => () => {} } as never, transport);

  // 로비에서 아레나로 넘어가는 사이: 아직 아무도 구독하지 않았다
  emit('event', encodeCharacter('est', 3));
  emit('input', Uint8Array.of(0x01, 0, 0, 0, 0));

  const seen: { channel: Channel; character: string | null }[] = [];
  link.onMessage((channel, data) => {
    seen.push({ channel, character: decodeCharacter(data)?.character ?? null });
  });
  check(
    '씬 전환 중 도착한 캐릭터 선택이 보존된다',
    seen.length === 1 && seen[0]!.channel === 'event' && seen[0]!.character === 'est',
    '받은 ' + seen.length + '건, 캐릭터 ' + (seen[0]?.character ?? '없음'),
  );
}


// 협동 결과 화면은 패배 원인을 구분해야 한다 (코어 만피인데 "코어 함락"이 뜨던 문제)
{
  const base = createInitialState(['lachesis', 'clotho'], { mode: 'coop', playerCount: 2, seed: 1 });
  const sum = (coreHp: number, playerCount: 1 | 2) => {
    const s2 = createInitialState(['lachesis', 'clotho'], { mode: 'coop', playerCount, seed: 1 });
    s2.coop!.coreHp = coreHp;
    s2.coop!.wave = 2;
    return summarize(s2);
  };
  const lost = { mode: 'coop', won: false, wave: 2 } as const;
  const won = { mode: 'coop', won: true, wave: 10 } as const;

  const wipe = coopResultText(lost, sum(500, 2), false);
  const fallen = coopResultText(lost, sum(0, 2), false);
  const soloWipe = coopResultText(lost, sum(500, 1), false);
  const cut = coopResultText(lost, sum(500, 2), true);
  const cleared = coopResultText(won, sum(320, 2), false);
  void base;

  check('코어가 남아 있으면 전멸로 표시', wipe.title === '전멸' && wipe.subtitle.includes('전원 다운'), wipe.title + ' / ' + wipe.subtitle);
  check('코어가 0이면 코어 함락으로 표시', fallen.title === '코어 함락' && fallen.subtitle.includes('코어 파괴'), fallen.title);
  check('1인 방어는 전투 불능으로 표시', soloWipe.title === '전투 불능', soloWipe.title + ' / ' + soloWipe.subtitle);
  check('연결이 끊겨 끝나면 방어 중단으로 표시', cut.title === '방어 중단', cut.title);
  check('클리어는 방어 성공으로 표시', cleared.title === '방어 성공!', cleared.title);
}


// 적 대상 되감기 판정: 게스트가 본 시점의 적 위치로 판정한다
{
  // 척후병 한 기만 두고 웨이브 스폰을 붙잡아 둔 뒤, 적이 지나간 자리에 정지탄을 놓는다.
  // aimBack: 몇 틱 전의 자리에 탄을 놓을지, lagTicks: 판정을 몇 틱 되감을지 (둘을 따로 준다)
  const shoot = (aimBack: number, lagTicks: number): { hit: boolean; moved: number } => {
    const c = createInitialState(['lachesis', 'clotho'], { mode: 'coop', playerCount: 2, seed: 7 });
    const hist = new PositionHistory();
    const coop = c.coop!;
    coop.phase = 0;
    coop.timer = 100_000;
    c.players[0].x = 900;
    c.players[0].y = 360;
    c.players[1].x = 900;
    c.players[1].y = 360;
    coop.enemies.push({ id: 7, kind: 0, x: 300, y: 360, hp: 30, fireCooldown: 0, contactCooldown: 0 });

    // step 직후의 위치가 "다음 틱의 판정이 보는 위치"다
    const seen = new Map<number, { x: number; y: number }>();
    for (let i = 0; i < 20; i++) {
      step(c, [EMPTY_INPUT, EMPTY_INPUT], { history: hist });
      const e = coop.enemies[0];
      if (e) seen.set(c.tick, { x: e.x, y: e.y });
    }

    const judgeTick = c.tick + 1;
    const past = seen.get(judgeTick - aimBack - 1)!;
    const e = coop.enemies[0]!;
    const moved = Math.hypot(e.x - past.x, e.y - past.y);
    const hpBefore = e.hp;
    c.bullets.push({
      id: 1, owner: 1, kind: 0, spawnTick: c.tick, lagTicks,
      x: past.x, y: past.y, vx: 0, vy: 0, damage: 10, ttl: 60, hits: [],
    });
    step(c, [EMPTY_INPUT, EMPTY_INPUT], { history: hist });
    return { hit: (coop.enemies[0]?.hp ?? 0) === hpBefore - 10, moved };
  };

  const rewound = shoot(10, 10);
  const live = shoot(10, 0);
  check(
    '적 대상 되감기: 지나간 자리에 쏜 탄이 명중',
    rewound.hit,
    '적이 ' + rewound.moved.toFixed(1) + 'px 이동 (판정 반경 18px)',
  );
  check('되감기 없이는 같은 탄이 빗나감', !live.hit, '같은 자리, 이동 ' + live.moved.toFixed(1) + 'px');
}


// 보정 스무딩: 권위 위치가 예측과 어긋나도 화면은 이어지고, 지수 감쇠로 권위에 수렴한다
{
  const link: SyncLink = { rtt: 0, send: () => {} };
  const guest = new GuestSync(link, 'lachesis', 0);
  const right: InputFrame = { ...EMPTY_INPUT, moveX: 1 };
  for (let i = 0; i < 30; i++) guest.step(right);

  const before = guest.renderState(0).players[1];
  const auth = createInitialState(['lachesis', 'lachesis'], { mode: 'duel', playerCount: 2, seed: 7 });
  auth.tick = 1_000_000;
  auth.players[1].x = before.x + 20;
  auth.players[1].y = before.y;
  // ackTick을 크게 주면 대기 입력이 모두 확인 처리되어 재조정 결과가 권위 위치와 정확히 같아진다
  guest.handleMessage('input', encodeSnapshot(auth, 10_000_000));

  const t0 = guest.renderState(0).players[1];
  const t70 = guest.renderState(70).players[1];
  const settled = guest.renderState(600).players[1];
  const smooth =
    Math.abs(t0.x - before.x) < 0.01 &&
    Math.abs(t70.x - (auth.players[1].x - 10)) < 0.3 &&
    Math.abs(settled.x - auth.players[1].x) < 0.01;
  check(
    '보정 스무딩: 화면이 이어지고 권위로 수렴',
    smooth,
    before.x.toFixed(1) + ' to ' + t0.x.toFixed(1) + ' to ' + t70.x.toFixed(1) + ' to ' + settled.x.toFixed(1) + ' (권위 ' + auth.players[1].x.toFixed(1) + ')',
  );

  // 큰 어긋남(부활·재접속)은 미끄러뜨리지 않고 즉시 붙인다
  const jump = createInitialState(['lachesis', 'lachesis'], { mode: 'duel', playerCount: 2, seed: 7 });
  jump.tick = 1_000_100;
  jump.players[1].x = auth.players[1].x + 300;
  jump.players[1].y = auth.players[1].y;
  guest.handleMessage('input', encodeSnapshot(jump, 10_000_001));
  const snapped = guest.renderState(620).players[1];
  check('큰 어긋남은 스무딩 없이 즉시 보정', Math.abs(snapped.x - jump.players[1].x) < 0.01, 'x ' + snapped.x.toFixed(1));

  // 스무딩 중에도 판정에 쓰는 상태는 권위와 같고, 화면만 잠시 어긋나 있다
  const drift = createInitialState(['lachesis', 'lachesis'], { mode: 'duel', playerCount: 2, seed: 7 });
  drift.tick = 1_000_200;
  drift.players[1].x = jump.players[1].x - 15;
  drift.players[1].y = jump.players[1].y;
  guest.handleMessage('input', encodeSnapshot(drift, 10_000_002));
  const shown = guest.renderState(640).players[1];
  const offset = Math.abs(shown.x - drift.players[1].x);
  check('스무딩 중에는 화면만 어긋난다', offset > 1 && offset < 20, '화면 오프셋 ' + offset.toFixed(1) + 'px');
}

console.log(failures === 0 ? '\n모든 검사 통과' : `\n${failures}개 실패`);
process.exit(failures === 0 ? 0 : 1);
