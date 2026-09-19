import Phaser from 'phaser';
import type { Session } from '../../net/connect';
import { CHARACTERS } from '../../sim/characters';
import type { MatchSummary, Outcome } from '../../sim/core';
import { COOP, SIM, type PlayerStats } from '../../sim/types';
import { encodeRematch, isRematch } from '../../sim/serialize';
import { sfx } from '../audio/Sfx';
import { addPortraitCard } from '../fx/Portraits';
import { applyResult } from '../record';
import { FONT, fontPx, makeButton, makeLabel, padButton, px, uiScale } from '../ui';
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
    const u = (n: number) => px(this, n);
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
    if (subtitle) makeLabel(this, cx, height * 0.08 + u(34), subtitle, 14);

    // 폰 가로(높이 390 안팎)에서는 아래 버튼 줄과 겹치지 않도록 표를 조금 올리고 줄 간격을 줄인다.
    const compact = height / uiScale(this) < 480;
    if (summary) this.renderTable(summary, data.localId, height * (compact ? 0.34 : 0.37), u(compact ? 21 : 24));

    const record = applyResult(outcome, data.localId, online);
    const recordText =
      outcome.mode === 'duel'
        ? `내 전적 · 대전 ${record.duelWins}승 ${record.duelLosses}패`
        : `내 전적 · 방어 성공 ${record.coopClears}회 / 실패 ${record.coopFails}회 · 최고 웨이브 ${record.bestWave}`;
    // 아래쪽은 화면 비율이 아니라 바닥에서 잰 거리로 쌓는다. 비율로 두면 낮은 화면에서 서로 겹친다.
    const btnY = height - u(34);
    makeLabel(this, cx, height - u(96), recordText, 14).setColor('#8fa3c8');

    // 이상한 일이 있었을 때 화면을 캡처해 설명하는 대신 이 파일 하나를 넘기면 된다.
    if (data.recorder) {
      const rec = data.recorder;
      makeLabel(this, cx, height - u(80), rec.summaryLine(), 11).setColor('#5c6b8a');
      const save = makeButton(this, cx + u(180), btnY, '경기 기록 저장', () => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        downloadRecord(rec.toRecord(), 'arena-' + rec.toRecord().header.role + '-' + stamp + '.json');
        save.setText('저장됨');
        sfx.ui();
      }, 15);
      padButton(save, 18, 12);
    }

    const status = makeLabel(this, cx, height - u(64), '', 13).setColor('#8fa3c8');
    const rematch = makeButton(this, cx - u(160), btnY, '다시 하기', () => this.requestRematch(data, rematch, status), 20);
    if (!canRematch) rematch.setAlpha(0.4).disableInteractive();
    makeButton(this, cx, btnY, '타이틀로', () => {
      sfx.ui();
      data.session?.close();
      this.scene.start('Title');
    }, 20);

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

  private renderTable(summary: MatchSummary, localId: 0 | 1, top: number, rowH: number): void {
    const { width } = this.scale;
    const cx = width / 2;
    const rows = summary.mode === 'duel' ? DUEL_ROWS : COOP_ROWS;
    const players = summary.players.slice(0, summary.playerCount);
    const cols = players.length;
    const u = (n: number) => px(this, n);
    const labelX = cx - u(150);
    const colX = (i: number) => (cols === 1 ? cx + u(60) : cx + u(20) + i * u(150));

    // 초상은 표 양옆에 크게 세운다. 폰 가로 화면은 위아래 여유가 없어 이름 위에 두면 작아질 수밖에 없다.
    // 첫 열의 파티마는 왼쪽(항목 이름 바깥), 마지막 열은 오른쪽. 혼자면 오른쪽 하나만.
    const tableTop = top - u(14);
    const tableBottom = top + u(34) + (rows.length - 1) * rowH + u(12);
    const midY = (tableTop + tableBottom) / 2;
    const leftRoom = labelX - u(16) - u(12);
    const rightEdge = colX(cols - 1) + u(72);
    const rightRoom = width - rightEdge - u(12);
    const wantH = Math.max(tableBottom - tableTop, Math.min(this.scale.height * 0.4, u(260)));
    const cardW = Math.max(u(48), Math.min(wantH * 0.75, rightRoom, cols === 2 ? leftRoom : rightRoom));
    const cardH = cardW / 0.75;

    for (let i = 0; i < cols; i++) {
      const p = players[i]!;
      const c = CHARACTERS[p.character];
      const mine = i === localId;
      const onLeft = cols === 2 && i === 0;
      const cardX = onLeft ? labelX - u(16) - cardW / 2 : rightEdge + cardW / 2;
      addPortraitCard(this, p.character, cardX, midY, cardW, cardH, c.color, 4);
      this.add
        .text(colX(i), top, `${c.name}${mine ? ' (나)' : ''}`, { fontFamily: FONT, fontSize: fontPx(this, 17), color: mine ? '#ffffff' : '#c9d1e3' })
        .setOrigin(0.5);
      this.add.rectangle(colX(i), top + u(16), u(120), 2, c.color, 0.9);
    }

    rows.forEach((row, r) => {
      const y = top + u(34) + r * rowH;
      this.add.text(labelX, y, row.label, { fontFamily: FONT, fontSize: fontPx(this, 15), color: '#8fa3c8' }).setOrigin(0, 0.5);
      for (let i = 0; i < cols; i++) {
        this.add
          .text(colX(i), y, row.value(players[i]!.stats), { fontFamily: FONT, fontSize: fontPx(this, 16), color: '#e6ecff' })
          .setOrigin(0.5);
      }
    });
  }
}
