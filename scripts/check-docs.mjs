// 문서에 손으로 적은 숫자가 코드와 맞는지 검사한다: npm run check:docs
//
// 이 프로젝트에서 같은 종류의 오류가 세 번 났다. 번들 크기, 파일 줄 수, 헤드리스 검사 개수다.
// 사람이 적는 숫자는 반드시 늙으므로 기계가 대조한다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const MANUAL = 'docs/개발자_매뉴얼.md'; // 파일 지도와 검사 목록이 적힌 문서
const ROOTS = ['apps', 'packages', 'scripts']; // 소스를 찾을 폴더
const EXTS = ['.ts', '.mts', '.mjs'];

let failures = 0;
const fail = (msg) => {
  console.log('FAIL  ' + msg);
  failures += 1;
};
const pass = (msg) => console.log('PASS  ' + msg);

// 폴더를 끝까지 내려가며 소스 파일 경로를 모은다
function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.includes(path.extname(entry))) out.push(full.split(path.sep).join('/'));
  }
  return out;
}

const sources = ROOTS.flatMap((r) => walk(r, []));
const manual = readFileSync(MANUAL, 'utf8');
const lineCount = (p) => readFileSync(p, 'utf8').split('\n').length - 1; // 마지막 줄바꿈 뒤 빈 줄은 세지 않는다

// 1. 파일 지도의 "이름 (N)" 표기를 실제 줄 수와 대조
const seen = new Set();
let checked = 0;
let mapFailures = 0;
for (const m of manual.matchAll(/([\w./-]+\.(?:ts|mts|mjs))\s*\(\s*(\d+)\)/g)) {
  const name = m[1];
  if (seen.has(name)) continue;
  const hits = sources.filter((p) => p === name || p.endsWith('/' + name));
  if (hits.length !== 1) continue; // 이름이 겹치는 파일은 어느 것인지 몰라 건너뛴다
  seen.add(name);
  const claimed = Number(m[2]);
  const actual = lineCount(hits[0]);
  checked += 1;
  if (claimed !== actual) {
    fail('파일 지도 ' + name + ' 줄 수: 문서 ' + claimed + ' / 실제 ' + actual);
    mapFailures += 1;
  }
}
if (mapFailures === 0) pass('파일 지도 줄 수 ' + checked + '개 일치');

// 2. 문서에 적어 둔 헤드리스 검사 목록이 실제 실행 결과와 맞는지
const out = execFileSync('npx', ['tsx', 'scripts/sim-check.ts'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
// 'PASS  이름  (참고 값)'에서 이름만 남긴다 (참고 값은 실행마다 달라질 수 있다)
const clean = (l) => l.replace(/^PASS\s+/, '').replace(/\s+\(.*$/, '').replace(/\s+←.*$/, '').trim();
const actualNames = out.split('\n').filter((l) => l.startsWith('PASS')).map(clean);
const docNames = manual.split('\n').filter((l) => l.startsWith('PASS')).map(clean);

if (actualNames.length !== docNames.length) {
  fail('검사 목록 개수: 문서 ' + docNames.length + '개 / 실제 ' + actualNames.length + '개');
} else {
  const missing = actualNames.filter((n) => !docNames.includes(n));
  if (missing.length > 0) fail('문서에 없는 검사: ' + missing.join(', '));
  else pass('검사 목록 ' + actualNames.length + '개 일치');
}

// 3. 각 문서 본문이 말하는 검사 개수
const DOCS = [
  'README.md',
  MANUAL,
  'docs/게임_매뉴얼.md',
  'docs/실기_테스트_가이드.md',
  'docs/모바일_웹_슈팅게임_기획서.md',
  'docs/테스트_방식과_헤드리스.md',
  'docs/회고.md',
  'docs/프로그램_명세서.md',
  'docs/아키텍처_정의서.md',
];
let countFailures = 0;
for (const file of DOCS) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:규칙 검사|검사) (\d+)개|(\d+)개 항목/g)) {
    const n = Number(m[1] ?? m[2]);
    if (n !== actualNames.length) {
      fail(file + ': "' + m[0] + '" 인데 실제는 ' + actualNames.length + '개');
      countFailures += 1;
    }
  }
}
if (countFailures === 0) pass('본문의 검사 개수 표기 일치');

console.log(failures === 0 ? '\n문서 수치 전부 일치' : '\n' + failures + '건 불일치');
process.exit(failures === 0 ? 0 : 1);
