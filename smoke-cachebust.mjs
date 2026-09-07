/*
 * 고친 것이 사람에게 닿는가.
 *
 * 깃허브 페이지스는 app.js 를 10분 동안 브라우저가 붙잡게 한다(max-age=600). 주소가
 * 그대로면 고쳐 올려도 그동안은 옛 파일이 돌고, 사람은 «안 고쳐졌다»고 본다.
 * 실제로 한 번 헛돌았다(2026-09-07). 그래서 주소 뒤 v 를 검사한다 — 빼먹으면 다음
 * 배포가 조용히 안 닿는다.
 */
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const html = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
const fail = [];
const check = (name, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? ` — ${extra}` : ''));
  if (!cond) fail.push(name);
};

const js = /src="app\.js\?v=([^"]+)"/.exec(html);
const css = /href="app\.css\?v=([^"]+)"/.exec(html);
check('app.js 에 v 가 붙어 있다', Boolean(js), js && js[1]);
check('app.css 에 v 가 붙어 있다', Boolean(css), css && css[1]);
check('둘의 v 가 같다', Boolean(js && css) && js[1] === css[1]);

/*
 * v 를 올렸는지까지는 기계가 알 수 없다 — 다만 «app.js 를 고쳤는데 index.html 은
 * 그대로»인 커밋을 잡아 준다. 마지막 커밋에서 둘을 비교한다.
 */
import { execSync } from 'node:child_process';
const run = (cmd) => execSync(cmd, { cwd: ROOT }).toString().split('\n').filter(Boolean);
// 아직 커밋 전이면 지금 손에 든 변경을, 이미 커밋했으면 마지막 커밋을 본다.
const pending = run('git status --porcelain').map((line) => line.slice(3));
const changed = pending.length ? pending : run('git diff --name-only HEAD~1 HEAD');
if (changed.includes('app.js') || changed.includes('app.css')) {
  check('app.js/app.css 를 고친 커밋은 index.html 의 v 도 함께 올린다',
    changed.includes('index.html'),
    changed.filter(Boolean).join(', '));
} else {
  console.log('  · 이번 커밋은 app.js/app.css 를 건드리지 않았다');
}

console.log(fail.length ? `\n실패 ${fail.length}건` : '\n전부 통과');
process.exit(fail.length ? 1 : 0);
