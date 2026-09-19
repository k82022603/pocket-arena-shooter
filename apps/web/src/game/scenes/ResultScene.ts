import Phaser from 'phaser';
import type { Session } from '../../net/connect';
import { CHARACTERS } from '../../sim/characters';
import type { MatchSummary, Outcome } from '../../sim/core';
import { COOP, SIM, type PlayerStats } from '../../sim/types';
import { encodeRematch, isRematch } from '../../sim/serialize';
import { sfx } from '../audio/Sfx';
import { addPortraitCard } from '../fx/Portraits';
import { applyResult } from '../record';
import { FONT, makeButton, makeLabel } from '../ui';
import { coopResultText } from '../outcomeText';
import { downloadRecord, type MatchRecorder } from '../recorder';

interface ResultData {
  outcome: Outcome;
  summary: MatchSummary | null;
  localId: 0 | 1;
  session?: Session;
  // 연결 문제로 끝난 경우의 안내 문구
  note?: string;
  // 이 경기의 진단 기록. 파일로 내보내 원인을 따질 때 쓴다.
  recorder?: MatchRecorder;
}

interface StatRow {
  label: string;
  value: (s: PlayerStats) => string;
}

const DUEL_ROWS: StatRow[] = [
  { label: '명중률', value: (s) => accuracy(s) },
  { label: '발사 / 명중', value: (s) => `${s.shots} / ${s.hits}` },
  { label: '가한 피해', value: (s) => `${s.damageDealt}` },
  { label: '받은 피해', value: (s) => `${s.damageTaken}` },
  { label: '대시', value: (s) => `${s.dashes}` },
];

const COOP_ROWS: StatRow[] = [
  { label: '처치', value: (s) => `${s.kills}` },
  { label: '명중률', value: (s) => accuracy(s) },
  { label: '발사 / 명중', value: (s) => `${s.shots} / ${s.hits}` },
  { label: '가한 피해', value: (s) => `${s.damageDealt}` },
  { label: '받은 피해', value: (s) => `${s.damageTaken}` },
  { label: '다운', value: (s) => `${s.downs}` },
];

function accuracy(s: PlayerStats): string {
  return s.shots === 0 ? '-' : `${Math.round((s.hits / s.shots) * 100)}%`;
}

function formatTime(ticks: number): string {
  const total = Math.round(ticks / SIM.tickRate);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export class ResultScene extends Phaser.Scene {
  private myReady = false;
  private peerReady = false;
  private rematchTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    this.myReady = false;
    this.peerReady = false;
    this.rematchTimer = null;
    const { width, height } = this.scale;
    const cx = width / 2;
    const { outcome, summary } = data;
    const online = data.session !== undefined;

    let title: string;
    let subtitle = '';
    if (outcome.mode === 'duel') {
      title = outcome.winner === data.localId ? '승리!' : '패배';
    } else {
      const text = coopResultText(outcome, summary, data.note !== undefined);
      title = text.title;
      subtitle = text.subtitle;
    }
    if (summary) {
      const parts = [`경기 시간 ${formatTime(summary.elapsedTicks)}`];
      if (summary.coop) parts.push(`코어 ${summary.coop.coreHp}/${COOP.coreMaxHp}`);
      subtitle = subtitle ? `${subtitle}  ·  ${parts.join('  ·  ')}` : parts.join('  ·  ');
    }
    if (data.note) subtitle = subtitle ? `${data.note}  ·  ${subtitle}` : data.note;
    const canRematch = !data.session || data.session.connected;

    makeLabel(this, cx, height * 0.08, title, 40).setColor(
      outcome.mode === 'duel' ? (outcome.winner !== data.localId ? '#ff8a80' : '#ffe066') : outcome.won ? '#69f0ae' : '#ff8a80',
    );
    if (subtitle) makeLabel(this, cx, height * 0.08 + 34, subtitle, 14);

    if (summary) this.renderTable(summary, data.localId, height * 0.37);

    const record = applyResult(outcome, data.localId, online);
    const recordText =
      outcome.mode === 'duel'
        ? `내 전적 · 대전 ${record.duelWins}승 ${record.duelLosses}패`
        : `내 전적 · 방어 성공 ${record.coopClears}회 / 실패 ${record.coopFails}회 · 최고 웨이브 ${record.bestWave}`;
    makeLabel(this, cx, height * 0.8, recordText, 14).setColor('#8fa3c8');

    // 이상한 일이 있었을 때 화면을 캡처해 설명하는 대신 이 파일 하나를 넘기면 된다.
    if (data.recorder) {
      const rec = data.recorder;
      makeLabel(this, cx, height * 0.835, rec.summaryLine(), 11).setColor('#5c6b8a');
      const save = makeButton(this, cx, height * 0.965, '경기 기록 저장', () => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadRecord(rec.toRecord(), 'arena-' + rec.toRecord().header.role + '-' + stamp + '.json');
        save.setText('저장됨');
        sfx.ui();
      }).setFontSize(13);
    }

    const btnY = height * 0.9;
    const status = makeLabel(this, cx, btnY - 28, '', 13).setColor('#8fa3c8');
    const rematch = makeButton(this, cx - 90, btnY, '다시 하기', () => this.requestRematch(data, rematch, status)).setFontSize(20);
    if (!canRematch) rematch.setAlpha(0.4).disableInteractive();
    makeButton(this, cx + 90, btnY, '타이틀로', () => {
      sfx.ui();
      data.session?.close();
      this.scene.start('Title');
    }).setFontSize(20);

    const session = data.session;
    if (!session) return;
    // 혼자 눌러 빈 아레나에서 기다리지 않도록, 양쪽이 모두 누르면 함께 시작한다.
    const offMessage = session.onMessage((_channel, bytes) => {
      if (!isRematch(bytes)) return;
      this.peerReady = true;
      if (this.myReady) this.startRematch(data);
      else status.setText('상대가 재경기를 원합니다 — "다시 하기"를 누르세요').setColor('#ffe066');
    });
    const offFailed = session.on('failed', () => {
      rematch.setAlpha(0.4).disableInteractive();
      this.rematchTimer?.remove();
      status.setText('상대와 연결이 끊겼습니다').setColor('#ff8a80');
    });
    this.events.once('shutdown', () => {
      offMessage();
      offFailed();
      this.rematchTimer?.remove();
      this.rematchTimer = null;
    });
  }

  private requestRematch(data: ResultData, button: Phaser.GameObjects.Text, status: Phaser.GameObjects.Text): void {
    sfx.ui();
    if (!data.session) {
      this.scene.start('Arena', { mode: 'solo' });
      return;
    }
    if (this.myReady) return;
    this.myReady = true;
    button.setAlpha(0.6).disableInteractive();
    status.setText('상대를 기다리는 중…').setColor('#8fa3c8');
    // 상대가 아직 결과 화면에 오지 않았을 수 있으므로 준비 신호를 반복해서 보낸다
    const send = () => data.session?.send('event', encodeRematch());
    send();
    this.rematchTimer = this.time.addEvent({ delay: 400, loop: true, callback: send });
    if (this.peerReady) this.startRematch(data);
  }

  private startRematch(data: ResultData): void {
    this.rematchTimer?.remove();
    this.rematchTimer = null;
    this.scene.start('Arena', { mode: 'versus', session: data.session });
  }

  private renderTable(summary: MatchSummary, localId: 0 | 1, top: number): void {
    const { width } = this.scale;
    const cx = width / 2;
    const rows = summary.mode === 'duel' ? DUEL_ROWS : COOP_ROWS;
    const players = summary.players.slice(0, summary.playerCount);
    const cols = players.length;
    const labelX = cx - 150;
    const colX = (i: number) => (cols === 1 ? cx + 60 : cx + 20 + i * 150);
    const rowH = 24;

    for (let i = 0; i < cols; i++) {
      const p = players[i]!;
      const c = CHARACTERS[p.character];
      const mine = i === localId;
      addPortraitCard(this, p.character, colX(i), top - 44, 48, 56, c.color, 2);
      this.add
        .text(colX(i), top, `${c.name}${mine ? ' (나)' : ''}`, { fontFamily: FONT, fontSize: '17px', color: mine ? '#ffffff' : '#c9d1e3' })
        .setOrigin(0.5);
      this.add.rectangle(colX(i), top + 16, 120, 2, c.color, 0.9);
    }

    rows.forEach((row, r) => {
      const y = top + 34 + r * rowH;
      this.add.text(labelX, y, row.label, { fontFamily: FONT, fontSize: '15px', color: '#8fa3c8' }).setOrigin(0, 0.5);
      for (let i = 0; i < cols; i++) {
        this.add
          .text(colX(i), y, row.value(players[i]!.stats), { fontFamily: FONT, fontSize: '16px', color: '#e6ecff' })
          .setOrigin(0.5);
      }
    });
  }
}
