// 시그널링 + 웹 서버를 함께 띄우고, 폰에서도 접속 가능한 LAN 주소로 브라우저를 연다.
//   npm run play          (http)
//   npm run play -- https (자체 서명 https, 폰 카메라 QR 스캔용)
import { spawn } from 'node:child_process';
import { lanIPv4 } from './lan-ip.mjs';

const useHttps = process.argv.includes('https');
const scheme = useHttps ? 'https' : 'http';
const ip = lanIPv4();
const host = ip ?? 'localhost';
const url = `${scheme}://${host}:5173/`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npm, ['run', 'dev:signaling'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(npm, ['run', useHttps ? 'dev:https' : 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];

for (const child of children) child.on('exit', () => stop(0));

function stop(code) {
  for (const child of children) if (!child.killed) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop(0));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${scheme}://localhost:5173/`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

// 자체 서명 인증서라도 접속 여부만 확인하면 되므로 검증을 끈다
if (useHttps) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (await waitForServer()) {
  console.log(`\n  게임 주소: ${url}`);
  if (!ip) console.log('  (LAN 주소를 찾지 못했습니다. Wi‑Fi에 연결되어 있는지 확인하세요)');
  else console.log('  폰을 같은 Wi‑Fi에 연결하고 위 주소를 열거나, 방 만들기 QR을 찍으세요.\n');
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
} else {
  console.error('개발 서버가 뜨지 않았습니다.');
}
