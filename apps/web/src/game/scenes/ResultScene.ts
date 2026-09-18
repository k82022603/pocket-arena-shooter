import Phaser from 'phaser';
import type { Session } from '../../net/connect';
import { CHARACTERS } from '../../sim/characters';
import type { MatchSummary, Outcome } from '../../sim/core';
import { COOP, SIM, type PlayerStats } from '../../sim/types';
import { sfx } from '../audio/Sfx';
import { applyResult } from '../record';
import { FONT, makeButton, makeLabel } from '../ui';

interface ResultData {
  outcome: Outcome;
  summary: MatchSummary | null;
  localId: 0 | 1;
  session?: Session;
  // 연결 문제로 끝난 경우의 안내 문구
  note?: string;
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
  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const { outcome, summary } = data;
    const online = data.session !== undefined;

    let title: string;
    let subtitle = '';
    if (outcome.mode === 'duel') {
      title = online ? (outcome.winner === data.localId ? '승리!' : '패배') : 'P1 승리';
    } else if (outcome.won) {
      title = '방어 성공!';
      subtitle = `${COOP.waves}웨이브 전부 막아냈습니다`;
    } else {
      title = '코어 함락';
      subtitle = `웨이브 ${outcome.wave}/${COOP.waves}에서 패배`;
    }
    if (summary) {
      const parts = [`경기 시간 ${formatTime(summary.elapsedTicks)}`];
      if (summary.coop) parts.push(`코어 ${summary.coop.coreHp}/${COOP.coreMaxHp}`);
      subtitle = subtitle ? `${subtitle}  ·  ${parts.join('  ·  ')}` : parts.join('  ·  ');
    }
    if (data.note) subtitle = subtitle ? `${data.note}  ·  ${subtitle}` : data.note;
    const canRematch = !data.session || data.session.connected;

    makeLabel(this, cx, height * 0.11, title, 44).setColor(
      outcome.mode === 'duel' ? (online && outcome.winner !== data.localId ? '#ff8a80' : '#ffe066') : outcome.won ? '#69f0ae' : '#ff8a80',
    );
    if (subtitle) makeLabel(this, cx, height * 0.11 + 38, subtitle, 15);

    if (summary) this.renderTable(summary, data.localId, height * 0.3);

    const record = applyResult(outcome, data.localId, online);
    const recordText =
      outcome.mode === 'duel'
        ? `내 전적 · 대전 ${record.duelWins}승 ${record.duelLosses}패`
        : `내 전적 · 방어 성공 ${record.coopClears}회 / 실패 ${record.coopFails}회 · 최고 웨이브 ${record.bestWave}`;
    makeLabel(this, cx, height * 0.8, recordText, 14).setColor('#8fa3c8');

    const btnY = height * 0.9;
    const rematch = makeButton(this, cx - 90, btnY, '다시 하기', () => {
      sfx.ui();
      this.scene.start('Arena', data.session ? { mode: 'versus', session: data.session } : { mode: 'solo' });
    }).setFontSize(20);
    if (!canRematch) rematch.setAlpha(0.4).disableInteractive();
    makeButton(this, cx + 90, btnY, '타이틀로', () => {
      sfx.ui();
      data.session?.close();
      this.scene.start('Title');
    }).setFontSize(20);
  }

  private renderTable(summary: MatchSummary, localId: 0 | 1, top: number): void {
    const { width } = this.scale;
    const cx = width / 2;
    const rows = summary.mode === 'duel' ? DUEL_ROWS : COOP_ROWS;
    const players = summary.players.slice(0, summary.playerCount);
    const cols = players.length;
    const labelX = cx - 150;
    const colX = (i: number) => (cols === 1 ? cx + 60 : cx + 20 + i * 150);
    const rowH = 26;

    for (let i = 0; i < cols; i++) {
      const p = players[i]!;
      const c = CHARACTERS[p.character];
      const mine = i === localId;
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
