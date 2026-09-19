import type { CharacterId } from '../sim/characters';
import type { EnemyKind, GameMode } from '../sim/types';
import type { DamageSource, SimEvent } from '../sim/events';

// 경기 중 무엇이 일어났는지 기록한다. 화면을 캡처해 주고받는 대신 파일 하나로 상황을 넘기기 위한 것이다.
//
// 두 가지를 담는다.
//  - header: 이 기기가 무엇을 골랐고 어떤 역할이었는지. 양쪽 기록을 나란히 놓으면 서로 다르게
//    보고 있는 것(캐릭터 불일치 같은)이 바로 드러난다.
//  - samples: 0.5초마다의 진단값. 호스트 진행 속도, 버려진 입력, 보정량 같은 것들.
//
// 메모리를 묶어 두려고 표본 수를 제한한다. 넘치면 오래된 것부터 버리되 맨 앞 일부는 남긴다.
// 경기 초반(연결 직후)이 대개 가장 중요하기 때문이다.

export const SAMPLE_INTERVAL_TICKS = 30;
const MAX_SAMPLES = 600;
const KEEP_HEAD = 60;

export interface RecordSample {
  t: number;
  rtt: number;
  /** 호스트 시뮬레이션의 실제 진행 속도(틱/초). 참가한 쪽에서만 잰다. 60에 가까워야 정상 */
  hostRate?: number;
  /** 참가한 쪽: 아직 확인되지 않은 내 입력 수 */
  pend?: number;
  /** 방을 만든 쪽: 대기 중인 상대 입력 수와 넘쳐서 버린 누적 수 */
  q?: number;
  drop?: number;
  /** 화면 보정량(px)과 즉시 보정 횟수 */
  smooth?: number;
  snapped?: number;
  hp: [number, number];
  /** 이 기기가 보고 있는 두 사람의 파티마. 양쪽 기록이 다르면 동기화 버그다 */
  ch: [CharacterId, CharacterId];
  wave?: number;
  core?: number;
  enemies?: number;
  /** 이 구간에 각 플레이어가 무엇에 얼마나 맞았는지. 표본만으로는 체력이 준 것만 보여서 붙였다 */
  hurt0?: Partial<Record<DamageSource, number>>;
  hurt1?: Partial<Record<DamageSource, number>>;
  /** 이 구간에 코어가 무엇에 얼마나 깎였는지 */
  coreHurt?: Partial<Record<DamageSource, number>>;
  /** 이 구간의 격파 수 (적 종류별) */
  kills?: Partial<Record<EnemyKind, number>>;
}

export interface RecordEvent {
  t: number;
  kind: string;
  detail?: string;
}

export interface MatchRecord {
  version: 1;
  savedAt: string;
  header: {
    role: 'solo' | 'host' | 'guest';
    mode: GameMode;
    localId: 0 | 1;
    /** 이 기기가 타이틀에서 고른 값 */
    chose: { character: CharacterId; weapon: number };
    transport: string;
    userAgent: string;
    viewport: string;
  };
  events: RecordEvent[];
  samples: RecordSample[];
  dropped: number;
}

export class MatchRecorder {
  private readonly events: RecordEvent[] = [];
  // 다음 표본까지 모을 피해 내역. 매 사건을 다 적으면 파일이 커지므로 0.5초 단위로 합친다.
  private bucket = MatchRecorder.emptyBucket();
  private samples: RecordSample[] = [];
  private droppedSamples = 0;

  constructor(private readonly header: MatchRecord['header']) {
    this.event(0, 'start', header.role + ' / ' + header.mode + ' / ' + header.chose.character);
  }

  event(tick: number, kind: string, detail?: string): void {
    if (this.events.length < 200) this.events.push({ t: tick, kind, detail });
  }

  /** 시뮬레이션 사건을 받는다. step에 넣을 싱크로 그대로 쓴다. */
  readonly onSimEvent = (e: SimEvent): void => {
    const add = (m: Record<string, number>, key: string, n: number): void => {
      m[key] = (m[key] ?? 0) + n;
    };
    if (e.kind === 'hurt') add(e.target === 0 ? this.bucket.hurt0 : this.bucket.hurt1, e.by, e.amount);
    else if (e.kind === 'core') add(this.bucket.core, e.by, e.amount);
    else if (e.kind === 'kill') add(this.bucket.kills, String(e.enemy), 1);
    else if (e.kind === 'down') this.event(this.lastTick, 'down', 'P' + e.target);
    else if (e.kind === 'revive') this.event(this.lastTick, 'revive', 'P' + e.target);
  };

  private lastTick = 0;

  private static emptyBucket() {
    return {
      hurt0: {} as Record<string, number>,
      hurt1: {} as Record<string, number>,
      core: {} as Record<string, number>,
      kills: {} as Record<string, number>,
    };
  }

  private static pick(m: Record<string, number>): Record<string, number> | undefined {
    return Object.keys(m).length > 0 ? m : undefined;
  }

  sample(s: RecordSample): void {
    this.lastTick = s.t;
    const b = this.bucket;
    this.bucket = MatchRecorder.emptyBucket();
    s.hurt0 = MatchRecorder.pick(b.hurt0) as RecordSample['hurt0'];
    s.hurt1 = MatchRecorder.pick(b.hurt1) as RecordSample['hurt1'];
    s.coreHurt = MatchRecorder.pick(b.core) as RecordSample['coreHurt'];
    s.kills = MatchRecorder.pick(b.kills) as RecordSample['kills'];
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) {
      // 초반 구간은 남기고 중간을 버린다
      this.samples.splice(KEEP_HEAD, 1);
      this.droppedSamples += 1;
    }
  }

  toRecord(): MatchRecord {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      header: this.header,
      events: this.events,
      samples: this.samples,
      dropped: this.droppedSamples,
    };
  }

  toJSON(): string {
    return JSON.stringify(this.toRecord(), null, 1);
  }

  /** 사람이 먼저 훑어볼 수 있게 한 줄 요약을 만든다 */
  summaryLine(): string {
    const last = this.samples[this.samples.length - 1];
    if (!last) return this.header.role + ' · 표본 없음';
    const parts = [this.header.role, 'RTT ' + last.rtt.toFixed(0) + 'ms'];
    if (last.hostRate !== undefined) parts.push('호스트 ' + last.hostRate.toFixed(0) + 't/s');
    if (last.drop !== undefined) parts.push('버린 입력 ' + last.drop);
    parts.push('표본 ' + this.samples.length);
    return parts.join(' · ');
  }
}

/** 기록을 파일로 내려받는다. 브라우저에서만 쓴다. */
export function downloadRecord(record: MatchRecord, name: string): void {
  const blob = new Blob([JSON.stringify(record, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
