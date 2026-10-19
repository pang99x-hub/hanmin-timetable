/*
 * 이동수업 묶음째 교체 — 11/4(수) 1-3·1-10·1-11 의 2·3교시 교환(2026-10-19 교무기획부 문의).
 *
 * 1-10·1-11 의 2교시는 제2외국어 묶음(일본어 김병숙·중국어 김성자)이다. 교체 기록에는
 * 분반 하나(일본어)만 적히므로, 학생 화면은 기록 대신 «내 시간표의 상대 자리 수업»을
 * 가져와야 한다. 중국어 학생에게 일본어 교실이 뜨면 학생이 엉뚱한 곳으로 간다.
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const read = (n) => { try { return fs.readFileSync(`${ROOT}/data/${n}`, 'utf8'); } catch { return null; } };

const D = '2026-11-04';
const 일본어 = '일본 언어와 역사의 이해2';
const 중국어 = '중국 언어와 역사의 이해2';
const 교체 = (classId, period, fromPeriod, orig, origTeacher, next, nextTeacher, newRoom = null) => ({
  date: D, classId, period, kind: 'swap', origSubject: orig, origTeacher,
  newSubject: next, newTeacher: nextTeacher, newRoom, fromDate: D, fromPeriod,
});
const CHANGES = { schema: 1, changes: [
  교체('1-10', 2, 3, 일본어, '김병숙', '공통국어2', '김지수'),
  교체('1-10', 3, 2, '공통국어2', '김지수', 일본어, '김병숙', '링컨실'),
  교체('1-11', 2, 3, 일본어, '김병숙', '한문', '안기종'),
  교체('1-11', 3, 2, '한문', '안기종', 일본어, '김병숙', '링컨실'),
  교체('1-3', 2, 3, '공통영어2', '공대현', 일본어, '김병숙', '링컨실'),
  교체('1-3', 3, 2, 일본어, '김병숙', '공통영어2', '공대현'),
] };

async function open(me) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`, 'utf8'),
    { url: 'https://x/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = async (url) => {
    const n = String(url).replace('data/', '');
    const body = n === 'changes.json' ? JSON.stringify(CHANGES) : read(n);
    return body == null ? { ok: false } : { ok: true, json: async () => JSON.parse(body) };
  };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  const store = new Map([['hanmin.timetable.me.v1', JSON.stringify(me)]]);
  Object.defineProperty(w, 'localStorage', { value: {
    getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k) } });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 250));
  return w;
}

const fail = [];
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail.push(name);
};
const sections = JSON.parse(read('sections.json')).sections;
const pick = (subject) => {
  const found = sections.find((s) => s.classIds.includes('1-10') && s.subject === subject);
  return { [found.bandKey]: `${found.sectionId}|${found.subject}|${found.teacher ?? ''}` };
};
const 칸 = (w, period) => JSON.parse(w.eval(
  `JSON.stringify((() => { const d = parse('${D}'); const c = cellOf(d, ${period}, lessonsOn(d), changesOn(d)); return { subject: c.subject, teacher: c.teacher, room: c.room }; })())`,
));
const 줄 = (c) => `${c.subject}/${c.teacher}/${c.room || '-'}`;

for (const [who, me, expect2, expect3] of [
  ['1-10 중국어 학생', { classId: '1-10', sections: pick(중국어) },
    '공통국어2/김지수/-', `${중국어}/김성자/집현전`],
  ['1-10 일본어 학생', { classId: '1-10', sections: pick(일본어) },
    '공통국어2/김지수/-', `${일본어}/김병숙/링컨실`],
  ['1-11 중국어 학생', { classId: '1-11', sections: pick(중국어) },
    '한문/안기종/-', `${중국어}/김성자/집현전`],
  ['1-3 학생', { classId: '1-3', sections: {} },
    `${일본어}/김병숙/-`, '공통영어2/공대현/-'],
]) {
  console.log(`\n[${who}]`);
  const w = await open(me);
  const two = 줄(칸(w, 2)); const three = 줄(칸(w, 3));
  check('2교시', two === expect2, two);
  check('3교시', three === expect3, three);
  // 다른 교시는 그대로다 — 1교시 묶음은 옮기지 않았다.
  const one = 칸(w, 1);
  check('1교시는 그대로', me.classId === '1-3' ? one.subject === '통합과학2' : one.subject !== '공통국어2', 줄(one));
  w.close();
}

console.log(fail.length ? `\n실패 ${fail.length}건: ${fail.join(', ')}` : '\n모두 통과');
process.exit(fail.length ? 1 : 0);
