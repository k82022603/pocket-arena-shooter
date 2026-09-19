import { ROOM_CODE_LENGTH } from '@shooter/protocol';

export const JOIN_PARAM = 'join';

// QR/링크로 들어왔을 때 타이틀에서 캐릭터를 고를 때까지 방 코드를 담아두는 레지스트리 키
export const REGISTRY_PENDING_JOIN = 'pendingJoin';

const CODE_RE = new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`);

export function isRoomCode(text: string): boolean {
  return CODE_RE.test(text);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalOnlyHost(): boolean {
  return LOCAL_HOSTS.has(location.hostname);
}

// 노트북에서 localhost로 열었다면 폰이 닿을 수 없으므로, 개발 서버가 알려준 LAN 주소로 바꿔 QR에 넣는다.
export function joinUrlFor(code: string): string {
  const url = new URL(location.href);
  if (isLocalOnlyHost() && __LAN_ORIGIN__) {
    const lan = new URL(__LAN_ORIGIN__);
    url.protocol = lan.protocol;
    url.hostname = lan.hostname;
    url.port = lan.port;
  }
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
