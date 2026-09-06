/*
 * 덧칠 확인 — 요일 교환·이동수업 칸 보호·급식·학사일정.
 *
 * 사람이 보고 놓치는 것이 여기 다 있다. 이동수업 칸은 반과 교시가 같아도 남의 수업이고,
 * 요일 교환은 하루가 통째로 다른 요일이 된다.
 */
/*
 * jsdom 은 교육과정 모노레포에 있다(이 저장소는 의존성 없이 굴린다). 경로가 다르면
 * JSDOM_PATH 로 알려 준다.
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const read = (n) => { try { return fs.readFileSync(`${ROOT}/data/${n}`,'utf8'); } catch { return null; } };

// 3-1 의 5교시는 「고전과 윤리」와 「세계 문제와 미래 사회」가 함께 걸린 이동수업 칸이다.
const CHANGES = { schema:1, changes:[
  { date:'2026-09-10', classId:'3-1', period:5, kind:'substitute',
    origSubject:'고전과 윤리', origTeacher:'가교사', newTeacher:'나교사' },
  { date:'2026-09-11', kind:'dayswap', otherDate:'2026-09-07' },   // 금요일에 월요일 시간표
]};
const MEALS = { schema:1, days:{ '2026-09-10': { lunch:['보리밥','미역국','제육볶음'] } } };
const CAL = { schema:1, days:[
  { date:'2026-09-10', kind:'exam', labels:['1학기 2차 정기시험'], grades:[3] },
  { date:'2026-09-14', kind:'holiday', labels:['재량휴업일'], grades:[] },
  { date:'2026-09-15', kind:'event', labels:['1학년 현장체험'], grades:[1] },
]};

async function open(me) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`,'utf8'),
    { url:'https://x/', runScripts:'dangerously', pretendToBeVisual:true });
  const w = dom.window;
  w.fetch = async (url) => {
    const n = String(url).replace('data/','');
    const body = n === 'changes.json' ? JSON.stringify(CHANGES)
      : n === 'meals.json' ? JSON.stringify(MEALS)
      : n === 'calendar.json' ? JSON.stringify(CAL) : read(n);
    return body == null ? { ok:false } : { ok:true, json: async () => JSON.parse(body) };
  };
  w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
  const store = new Map([['hanmin.timetable.me.v1', JSON.stringify(me)]]);
  Object.defineProperty(w, 'localStorage', { value:{
    getItem:(k)=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)),
    removeItem:(k)=>store.delete(k) } });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`,'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 250));
  return w;
}

const fail = [];
const check = (name, cond, extra='') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail.push(name);
};

// 3-1 의 5교시 두 강좌를 찾는다
const sections = JSON.parse(read('sections.json')).sections;
const cell = sections.filter((s) => s.classIds.includes('3-1') && s.day === 3 && s.period === 5);
console.log('3-1 목요일 5교시 강좌:', cell.map((s) => `${s.subject}/${s.sectionId}`).join(', ') || '(없음)');

const pick = (subject) => {
  const found = sections.find((s) => s.classIds.includes('3-1') && s.subject === subject);
  return found ? { [found.bandKey]: `${found.sectionId}|${found.subject}|${found.teacher ?? ''}` } : {};
};

console.log('\n[1] 이동수업 칸 보호 — 9/10(목)');
for (const [subject, expect] of [['고전과 윤리', true], ['세계 문제와 미래 사회', false]]) {
  const w = await open({ classId:'3-1', sections: pick(subject) });
  w.eval("state.cursor = parse('2026-09-10'); state.view='day'; render();");
  const text = w.document.getElementById('app').textContent;
  check(`「${subject}」 듣는 학생에게 보강 표시 ${expect ? '나옴' : '안 나옴'}`,
    text.includes('나교사') === expect);
}

console.log('\n[2] 요일 교환 — 9/7(월) ↔ 9/11(금)');
{
  const w = await open({ classId:'3-1', sections:{} });
  const shown = (d) => JSON.parse(w.eval(
    `JSON.stringify([...lessonsOn(parse('${d}')).entries()]` +
    `.filter(([,l]) => l.kind === 'class').map(([p,l]) => p + ':' + l.subject).sort())`));
  const raw = (day) => JSON.parse(read('classes.json')).classes
    .filter((c) => c.classId === '3-1' && c.day === day)
    .map((c) => `${c.period}:${c.subject}`).sort();
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // 교환은 양방향이다 — 두 날이 서로의 시간표를 가져간다.
  check('금(9/11)이 월요일 시간표를 받음', eq(shown('2026-09-11'), raw(0)));
  check('월(9/7)이 금요일 시간표를 받음', eq(shown('2026-09-07'), raw(4)));
  check('교환 없는 금(9/4)은 그대로', eq(shown('2026-09-04'), raw(4)));
  check('교환 없는 월(9/14)은 그대로', eq(shown('2026-09-14'), raw(0)));
}

console.log('\n[3] 급식·학사일정');
{
  const w = await open({ classId:'3-1', sections:{} });
  w.eval("state.cursor = parse('2026-09-10'); state.view='day'; render();");
  const text = w.document.getElementById('app').textContent;
  // 식사는 접혀 있다 — 시간표를 보러 온 화면이라 메뉴가 자리를 다 먹으면 안 된다.
  check('접힌 상태: 메뉴가 다 펼쳐지지 않음', !text.includes('제육볶음'));
  check('접힌 상태: 무엇이 나오는지 한 줄은 보임', text.includes('보리밥'));
  const lunchHead = [...w.document.querySelectorAll('.slot.meal .mealhead')]
    .find((b) => b.textContent.includes('중식'));
  check('중식 줄을 누를 수 있음', Boolean(lunchHead));
  if (lunchHead) {
    lunchHead.dispatchEvent(new w.Event('click', { bubbles: true }));
    const opened = w.document.getElementById('app').textContent;
    check('펼치면 메뉴가 줄마다 나옴',
      ['보리밥','미역국','제육볶음'].every((x) => opened.includes(x)));
  }
  w.eval("state.view='month'; render();");
  const month = w.document.getElementById('app').textContent;
  check('3학년에게 3학년 시험이 보임', month.includes('1학기 2차 정기시험'));
  check('3학년에게 1학년 행사는 안 보임', !month.includes('1학년 현장체험'));
  check('전교 휴업일은 보임', month.includes('재량휴업일'));
}

console.log('\n[4] 주간표에는 급식 줄이 없다');
{
  const w = await open({ classId:'3-1', sections:{} });
  w.eval("state.cursor = parse('2026-09-10'); state.view='week'; render();");
  check('주간표에 급식 줄 없음', w.document.querySelectorAll('.wk tr.mealrow').length === 0);
  check('주간표에 «급식은 «오늘»에서» 문구 없음',
    !w.document.querySelector('.wk').textContent.includes('급식'));
}

console.log(fail.length ? `\n실패 ${fail.length}건: ${fail.join(', ')}` : '\n전부 통과');
process.exit(fail.length ? 1 : 0);
