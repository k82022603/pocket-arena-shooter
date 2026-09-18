import { characterAt, characterIndex, type CharacterId } from './characters';
import type { InputFrame } from './types';

export const PACKET_INPUT = 0x01;
export const PACKET_CHARACTER = 0x02;
export const INPUT_PACKET_SIZE = 8;

export function encodeCharacter(id: CharacterId): Uint8Array {
  return Uint8Array.of(PACKET_CHARACTER, characterIndex(id));
}

export function decodeCharacter(buf: Uint8Array): CharacterId | null {
  if (buf.byteLength !== 2 || buf[0] !== PACKET_CHARACTER) return null;
  return characterAt(buf[1]!);
}

const BIT_FIRE = 1 << 0;
const BIT_DASH = 1 << 1;
const BIT_SKILL = 1 << 2;

function quantize(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 127);
}

export function encodeInput(tick: number, f: InputFrame, out = new Uint8Array(INPUT_PACKET_SIZE)): Uint8Array {
  const view = new DataView(out.buffer, out.byteOffset, INPUT_PACKET_SIZE);
  view.setUint8(0, PACKET_INPUT);
  view.setUint16(1, tick & 0xffff);
  view.setInt8(3, quantize(f.moveX));
  view.setInt8(4, quantize(f.moveY));
  view.setInt8(5, quantize(f.aimX));
  view.setInt8(6, quantize(f.aimY));
  view.setUint8(7, (f.fire ? BIT_FIRE : 0) | (f.dash ? BIT_DASH : 0) | (f.skill ? BIT_SKILL : 0));
  return out;
}

export function decodeInput(buf: Uint8Array): { tick: number; frame: InputFrame } | null {
  if (buf.byteLength < INPUT_PACKET_SIZE || buf[0] !== PACKET_INPUT) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, INPUT_PACKET_SIZE);
  const bits = view.getUint8(7);
  return {
    tick: view.getUint16(1),
    frame: {
      moveX: view.getInt8(3) / 127,
      moveY: view.getInt8(4) / 127,
      aimX: view.getInt8(5) / 127,
      aimY: view.getInt8(6) / 127,
      fire: (bits & BIT_FIRE) !== 0,
      dash: (bits & BIT_DASH) !== 0,
      skill: (bits & BIT_SKILL) !== 0,
    },
  };
}
