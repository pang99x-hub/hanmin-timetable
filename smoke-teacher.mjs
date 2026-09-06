/*
 * 교사 로그인 → 학생 골라 보기.
 *
 * 확인하는 것:
 *   ① 교사로 들어오면 자기 시간표가 아니라 «누구를 볼지» 화면이 뜬다
 *   ② 학급을 고르면 그 반 학생만 번호순으로 나온다
 *   ③ 학생을 고르면 그 학생 화면이 그대로 뜨고, «보는 중»이 늘 보인다
 *   ④ 교사가 본 것은 기기에 저장되지 않는다 — 이 기기의 «내 시간표»가 아니다
 *   ⑤ 학생 계정은 종전대로 자기 것만 본다
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const read = (n) => fs.readFileSync(`${ROOT}/data/${n}`, 'utf8');
const sections = JSON.parse(read('sections.json')).sections;

const ROSTER = [
  { classId: '2-1', no: '1', name: '가학생' },
  { classId: '2-1', no: '2', name: '나학생' },
  { classId: '3-1', no: '1', name: '다학생' },
];
// 2-1 이 실제로 듣는 강좌 몇 개
const forClass = (cid) => [...new Set(sections.filter((s) => s.classIds.includes(cid))
  .map((s) => String(s.sectionId)))].slice(0, 3);

const fail = [];
const check = (name, cond, extra='') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail.push(name);
};

async function open(deskReply) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`, 'utf8'),
    { url: 'https://x/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const store = new Map();
  w.fetch = async (url, init) => {
    if (String(url).includes('script.google.com')) {
      return { ok: true, json: async () => deskReply(JSON.parse(init.body)) };
    }
    try { return { ok: true, json: async () => JSON.parse(read(String(url).replace('data/',''))) }; }
    catch { return { ok: false }; }
  };
  w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
  Object.defineProperty(w, 'localStorage', { value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k) } });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 250));
  return { w, store };
}

const desk = (body) => {
  if (body.action === 'mySections') return { ok:true, role:'teacher', found:false, roster: ROSTER };
  if (body.action === 'studentView') {
    const hit = ROSTER.find((r) => r.classId === body.classId && r.no === body.no);
    // 2번 학생은 이동수업이 아직 안 정해진 상태 — 그래야 «반 고르기» 화면이 뜬다.
    return hit
      ? { ok:true, found:true, classId: hit.classId, no: hit.no, name: hit.name,
          sections: hit.no === '2' ? [] : forClass(hit.classId) }
      : { ok:true, found:false };
  }
  return { ok:false, error:'알 수 없는 요청' };
};

console.log('[1] 교사로 로그인');
const { w, store } = await open(desk);
await w.onCredential({ credential: '교사토큰' });
let text = w.document.getElementById('app').textContent;
check('학생 고르는 화면이 뜬다', text.includes('학생 시간표 보기'));
check('내 시간표가 바로 뜨지 않는다', !text.includes('교시'));

console.log('\n[2] 학급 고르기');
const classBtn = [...w.document.querySelectorAll('.pick-grid button')].find((b) => b.textContent === '2-1');
check('학급 단추가 있다', Boolean(classBtn));
classBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
const names = [...w.document.querySelectorAll('.pick-grid.names button')].map((b) => b.textContent);
check('그 반 학생만 번호순으로 나온다', JSON.stringify(names) === JSON.stringify(['1. 가학생', '2. 나학생']),
  names.join(' / '));

console.log('\n[3] 학생 고르기');
[...w.document.querySelectorAll('.pick-grid.names button')][0]
  .dispatchEvent(new w.Event('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
text = w.document.getElementById('app').textContent;
check('그 학생 화면이 뜬다', text.includes('교시'));
check('«보는 중» 이 늘 보인다', text.includes('2-1 1번 가학생 화면'));
check('«다른 학생» 으로 돌아갈 수 있다',
  Boolean([...w.document.querySelectorAll('button')].find((b) => b.textContent === '다른 학생')));

console.log('\n[4] 교사가 본 것은 기기에 남지 않는다');
check('localStorage 에 저장 안 됨', !store.has('hanmin.timetable.me.v1'),
  store.has('hanmin.timetable.me.v1') ? '저장돼 버렸다' : '');

/*
 * 보기만 할 때가 아니라 **만질 때**도 남지 않아야 한다.
 *
 * 실제로 새던 자리다: 교사가 학생 화면을 보는 중에 이동수업 반 단추를 누르면
 * 저장 함수까지 내려가 그 학생의 반·이름·수강 강좌가 교사 기기에 남았다.
 * 화면에 잠깐 보여 주는 것과 기기에 남기는 것은 다른 일이다.
 */
console.log('\n[4-2] 보는 중에는 무엇을 눌러도 남지 않는다');
{
  /*
   * 특정 단추 하나가 아니라 **화면의 모든 단추**를 눌러 본다.
   *
   * 실제로 새던 자리는 이동수업 «반 고르기» 단추였다 — 보는 중에 누르면 저장까지
   * 내려가 그 학생의 반·이름·수강 강좌가 교사 기기에 남았다. 그런데 새는 자리가
   * 그 하나뿐이라고 믿을 근거가 없다. 저장 금지는 «보는 중» 전체에 걸리는 성질이므로
   * 그렇게 확인한다. 나가는 단추만 빼고 전부 누른다.
   */
  const 나가기 = ['다른 학생', '로그아웃'];
  const 단추들 = [...w.document.querySelectorAll('#app button')]
    .filter((b) => !나가기.includes(b.textContent.trim()));
  check('누를 단추가 있다', 단추들.length > 0, `${단추들.length}개`);
  for (const b of 단추들) {
    try { b.dispatchEvent(new w.Event('click', { bubbles: true })); } catch { /* 렌더 중 사라진 단추 */ }
  }
  await new Promise((r) => setTimeout(r, 150));
  check('전부 눌러도 localStorage 에 안 남는다', !store.has('hanmin.timetable.me.v1'),
    store.has('hanmin.timetable.me.v1') ? '눌렀더니 저장됐다' : `${단추들.length}개 눌러 봄`);
}

console.log('\n[5] 학생 계정은 종전대로');
{
  const studentDesk = (body) => body.action === 'mySections'
    ? { ok:true, role:'student', found:true, classId:'2-1', sections: forClass('2-1') }
    : { ok:false };
  const { w: w2, store: s2 } = await open(studentDesk);
  await w2.onCredential({ credential: '학생토큰' });
  const t2 = w2.document.getElementById('app').textContent;
  check('자기 시간표가 바로 뜬다', t2.includes('교시'));
  check('«보는 중» 띠가 없다', !t2.includes('화면'));
  check('기기에 저장된다', s2.has('hanmin.timetable.me.v1'));
}

console.log(fail.length ? `\n실패 ${fail.length}건: ${fail.join(', ')}` : '\n전부 통과');
process.exit(fail.length ? 1 : 0);
