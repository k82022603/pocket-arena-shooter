import type { CharacterId } from '../sim/characters';
import type { GameMode } from '../sim/types';

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
  private samples: RecordSample[] = [];
  private droppedSamples = 0;

  constructor(private readonly header: MatchRecord['header']) {
    this.event(0, 'start', header.role + ' / ' + header.mode + ' / ' + header.chose.character);
  }

  event(tick: number, kind: string, detail?: string): void {
    if (this.events.length < 200) this.events.push({ t: tick, kind, detail });
  }

  sample(s: RecordSample): void {
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
