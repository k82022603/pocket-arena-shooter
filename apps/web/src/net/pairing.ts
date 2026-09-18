import { ROOM_CODE_LENGTH } from '@shooter/protocol';

export const JOIN_PARAM = 'join';

const CODE_RE = new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`);

export function isRoomCode(text: string): boolean {
  return CODE_RE.test(text);
}

export function joinUrlFor(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(JOIN_PARAM, code);
  return url.toString();
}

// QR 내용이 참가 링크든 숫자 코드든 방 코드를 뽑아낸다.
export function parseJoinCode(text: string): string | null {
  const trimmed = text.trim();
  if (isRoomCode(trimmed)) return trimmed;
  try {
    const code = new URL(trimmed).searchParams.get(JOIN_PARAM);
    return code && isRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

// 페이지가 참가 링크로 열렸으면 코드를 돌려주고 주소창에서 지운다 (새로고침 시 재참가 방지).
export function consumeJoinCodeFromUrl(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get(JOIN_PARAM);
  if (!code) return null;
  url.searchParams.delete(JOIN_PARAM);
  history.replaceState(null, '', url.toString());
  return isRoomCode(code) ? code : null;
}
