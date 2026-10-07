/*
 * 학생용 층(students.hiax.cloud) 점검 — 2026-10-07.
 *
 *   1. 학생은 학생용 층으로 로그인한다. 반·강좌가 채워지고 토큰이 기기에 남는다(원문 하나만)
 *   2. 선생님 일정이 오늘(사흘 안)·달력 점·고른 날 카드에 뜬다
 *   3. 우리 반 자리 — 시간표 탭 «자리»에서 열면 내 자리가 칠해져 있다. 반 친구 학번은 오지 않는다
 *   4. 명단에 없는 계정(교사)은 앱스 스크립트로 넘어간다. 학생용 층이 닿지 않아도 넘어간다
 *   5. 로그아웃하면 학생용 층 세션도 지운다
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const read = (n) => fs.readFileSync(`${ROOT}/data/${n}`, 'utf8');
const sections = JSON.parse(read('sections.json')).sections;
const sample = sections.find((s) => s.classIds.includes('2-1'));
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed += 1; };

const ME = {
  student: { classId: '2-1', no: 7, name: '가학생' },
  sections: [sample.sectionId],
  events: [
    { id: 'ev1', date: plus(1), title: '수행평가 준비물', content: '각도기와 계산기\n둘 다', teacher: '김교사',
      attachments: [{ id: '11111111-2222-4333-8444-555555555555', name: '준비물 안내.pdf', size: 204800 }] },
    { id: 'ev2', date: plus(9), title: '먼 일정', content: '', teacher: '이교사' },
  ],
  seats: [{
    effectiveFrom: plus(-1),
    room: { width: 800, depth: 760, desks: [{ id: 'd1a', x: 300, y: 250, rot: 0, kind: 'pair' }], fixtures: [{ id: 'board', kind: 'board', x: 400, y: 6, w: 400, h: 12 }] },
    seats: { 'd1a:0': { no: 6, name: '나학생' }, 'd1a:1': { no: 7, name: '가학생' } },
    locked: [], mine: 'd1a:1',
  }],
  // 이동수업 자리 — 교과 선생님이 짠 것. 여러 반이 모이므로 반을 함께 싣는다
  lessonSeats: [{
    lessonId: `sec:${sample.sectionId}`, effectiveFrom: plus(-1),
    room: { width: 800, depth: 760, desks: [{ id: 'd1a', x: 300, y: 250, rot: 0, kind: 'pair' }], fixtures: [] },
    seats: { 'd1a:0': { no: 3, name: '옆반학생', classId: '2-2' }, 'd1a:1': { no: 7, name: '가학생', classId: '2-1' } },
    locked: [], mine: 'd1a:1',
  }],
};

async function open({ hub, desk }) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`, 'utf8'), { url: 'https://timetable.hanmin.hs.kr/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const store = new Map();
  const calls = { hub: [], desk: 0 };
  w.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://students.hiax.cloud')) { calls.hub.push(`${init.method || 'GET'} ${new URL(u).pathname}`); return hub(u, init); }
    if (u.includes('script.google.com')) { calls.desk += 1; return { ok: true, json: async () => desk(JSON.parse(init.body)) }; }
    try { return { ok: true, json: async () => JSON.parse(read(u.replace('data/', ''))) }; } catch { return { ok: false }; }
  };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.structuredClone = structuredClone;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 300));
  return { w, store, calls, app: w.document.getElementById('app'), sheet: () => w.document.getElementById('sheet-root') };
}
const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
const settle = () => new Promise((r) => setTimeout(r, 120));

console.log('\n[1] 학생은 학생용 층으로 로그인');
const student = await open({
  hub: (u, init) => u.endsWith('/login') ? json(200, { token: 't'.repeat(43), expiresAt: Date.now() + 1e9, me: ME }) : u.endsWith('/me') ? json(200, ME)
    : /\/files\/[0-9a-f-]{36}\/link$/.test(u) ? json(200, { url: 'https://students.hiax.cloud/files/x?s=hanmin&t=1.sig' }) : json(200, { ok: true }),
  desk: () => ({ ok: false }),
});
await student.w.onCredential({ credential: '학생토큰' });
await settle();
const saved = JSON.parse(student.store.get('hanmin.timetable.me.v1'));
check('반이 채워진다', saved.classId === '2-1')
check('강좌가 채워진다', Object.values(saved.sections).length === 1, JSON.stringify(saved.sections))
check('앱스 스크립트를 부르지 않는다', student.calls.desk === 0)
check('학생용 층 토큰이 기기에 남는다', JSON.parse(student.store.get('hanmin.timetable.hub.v1')).token === 't'.repeat(43))

console.log('\n[2] 선생님 일정');
student.w.eval(`state.tab='today'; render();`)
const todayText = student.app.textContent
check('오늘 — 사흘 안 선생님 일정이 뜬다', todayText.includes('선생님 일정') && todayText.includes('수행평가 준비물'))
check('오늘 — 첨부가 있으면 줄에 «첨부 1»', todayText.includes('김교사 · 첨부 1'))
check('오늘 — 열흘 뒤 일정은 오늘에 띄우지 않는다', !todayText.includes('먼 일정'))
check('오늘 — 어제 바뀐 자리를 알린다', todayText.includes('자리가 바뀌었습니다'))
student.w.eval(`state.tab='calendar'; state.month=new Date(parse('${plus(1)}').getFullYear(), parse('${plus(1)}').getMonth(), 1); state.selDate=parse('${plus(1)}'); render();`)
const cell = [...student.app.querySelectorAll('.mo .day')].find((n) => (n.getAttribute('aria-label') || '').includes('선생님 일정 1'))
check('달력 — 그 날 칸에 선생님 일정 점', !!cell && !!cell.querySelector('.dot.is-teacher'))
const row = [...student.app.querySelectorAll('.row.is-teacher')].find((n) => n.textContent.includes('수행평가 준비물'))
check('달력 — 고른 날 카드에 선생님 일정 줄', !!row)
row.click()
await settle()
check('누르면 내용 전체와 선생님 이름', student.sheet().textContent.includes('각도기와 계산기') && student.sheet().textContent.includes('김교사 선생님'))
check('«디데이로 정하기»', [...student.sheet().querySelectorAll('button')].some((b) => b.textContent.includes('디데이로 정하기')))
const fileRow = [...student.sheet().querySelectorAll('.files .row')].find((b) => b.textContent.includes('준비물 안내.pdf'))
check('첨부 — 이름과 크기', !!fileRow && fileRow.textContent.includes('200KB'))
const opened = { href: null, closed: false }
student.w.open = () => ({ location: { set href(v) { opened.href = v } }, close() { opened.closed = true } })
fileRow.click()
await settle()
check('첨부 — 누르면 층에서 받은 5분 주소를 새 창에', opened.href === 'https://students.hiax.cloud/files/x?s=hanmin&t=1.sig' && student.calls.hub.some((c) => c === 'POST /files/11111111-2222-4333-8444-555555555555/link'))
student.w.eval('closeSheet()')

console.log('\n[3] 우리 반 자리');
student.w.eval(`state.tab='me'; render();`)
check('내 정보에는 자리가 없다 — 시간표 탭으로 옮겼다', ![...student.app.querySelectorAll('.row')].some((n) => n.textContent.includes('우리 반 자리')))
student.w.eval(`state.tab='timetable'; render();`)
const seatsCard = [...student.app.querySelectorAll('.card')].find((n) => n.querySelector('.card-title')?.textContent.trim() === '자리')
const seatsRow = seatsCard && [...seatsCard.querySelectorAll('.row')].find((n) => n.textContent.includes('우리 반 자리'))
check('시간표 탭 «자리»에 «우리 반 자리»', !!seatsRow)
check('«자리»에 이동수업 자리도', !!seatsCard && [...seatsCard.querySelectorAll('.row')].some((n) => /자리/.test(n.textContent) && !n.textContent.includes('우리 반')))
seatsRow.click()
await settle()
const mine = student.sheet().querySelector('.seatmap-seat.is-mine')
check('내 자리가 칠해져 있다', !!mine && mine.textContent.includes('가학생'))
check('반 친구는 번호·이름', student.sheet().textContent.includes('나학생'))
student.w.eval('closeSheet()')

console.log('\n[3-1] 이동수업 자리 — 그 수업 창에서');
// 이번 주 안에서 표본 강좌 수업이 실제로 걸린 날·교시(같은 강좌도 요일마다 교사가 다를 수 있다)
const [lessonDay, lessonPeriod] = JSON.parse(student.w.eval(`JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((n) => iso(new Date(today().getTime() + n * 86400000)))
  .flatMap((d) => [...lessonsOn(parse(d)).values()].filter((l) => l.kind === 'section' && l.sectionId === ${sample.sectionId}).map((l) => [d, l.period]))[0] || [])`))
student.w.eval(`openSheet({ type: 'lesson', date: '${lessonDay}', period: ${lessonPeriod} })`)
await settle()
const seatButton = [...student.sheet().querySelectorAll('button')].find((b) => b.textContent.includes('이 수업 내 자리'))
check('수업 창에 «이 수업 내 자리»', !!seatButton, lessonDay)
seatButton?.click()
await settle()
check('이동수업 자리에 내 자리가 칠해져 있다', !!student.sheet().querySelector('.seatmap-seat.is-mine'))
check('다른 반 학생은 반과 번호를 함께', student.sheet().textContent.includes('2-2 3') && student.sheet().textContent.includes('옆반학생'))
student.w.eval('closeSheet()')

console.log('\n[4] 로그아웃 — 학생용 층 세션도');
student.w.eval('logout()')
await settle()
check('학생용 층에 로그아웃을 알린다', student.calls.hub.includes('POST /logout'))
check('기기의 토큰을 지운다', !student.store.has('hanmin.timetable.hub.v1'))

console.log('\n[5] 교사 계정 — 앱스 스크립트로 넘어간다');
const teacher = await open({
  hub: () => json(404, { error: '학생 명단에 없는 계정입니다.', notStudent: true }),
  desk: (body) => body.action === 'mySections' ? { ok: true, role: 'teacher', roster: [] } : { ok: false },
});
await teacher.w.onCredential({ credential: '교사토큰' });
await settle();
check('교사 화면(학생 고르기)으로 간다', teacher.calls.desk === 1 && teacher.w.eval('!!state.teacher'))
check('학생용 층 토큰이 없다', !teacher.store.has('hanmin.timetable.hub.v1'))

console.log('\n[6] 학생용 층이 닿지 않으면 종전 창구로');
const offline = await open({
  hub: () => { throw new TypeError('Failed to fetch') },
  desk: () => ({ ok: true, found: true, classId: '2-1', sections: [String(sample.sectionId)] }),
});
await offline.w.onCredential({ credential: '학생토큰' });
await settle();
check('그래도 반이 채워진다', JSON.parse(offline.store.get('hanmin.timetable.me.v1')).classId === '2-1')
check('앱스 스크립트로 넘어갔다', offline.calls.desk === 1)
offline.w.eval(`state.tab='me'; render();`)
check('내 정보에 «학교 계정 연결»이 남는다', offline.app.textContent.includes('학교 계정 연결'))

console.log('\n[7] 자리배치 맡김 — 함께 고치고 담임에게 낸다');
const DRAFT = {
  me: { no: 7, name: '가학생' }, roomLocked: false,
  base: { room: ME.seats[0].room, seats: { 'd1a:0': 6 }, locked: ['d1a:0'] },
  draft: null, roster: [{ no: 6, name: '나학생' }, { no: 7, name: '가학생' }, { no: 8, name: '다학생' }], submission: null,
};
const puts = [];
let submittedCount = 0;
const delegate = await open({
  hub: (u, init) => {
    const path = new URL(u).pathname;
    if (path === '/login') return json(200, { token: 't'.repeat(43), me: { ...ME, delegation: { roomLocked: false, submission: null } } });
    if (path === '/me') return json(200, { ...ME, delegation: { roomLocked: false, submission: null } });
    if (path === '/seat-draft' && (init.method || 'GET') === 'GET') return json(200, DRAFT);
    if (path === '/seat-draft' && init.method === 'PUT') { const b = JSON.parse(init.body); puts.push(b); return json(200, { revision: puts.length, room: b.room, seats: b.seats }); }
    if (path === '/seat-draft/submit') { submittedCount += 1; return json(200, { ok: true, submission: { status: 'submitted', note: null, createdAt: 'x', decidedAt: null } }); }
    return json(200, { ok: true });
  },
  desk: () => ({ ok: false }),
});
await delegate.w.onCredential({ credential: '학생토큰' });
await settle();
delegate.w.eval(`state.tab='today'; render();`)
check('오늘에 «자리배치를 맡았습니다»', delegate.app.textContent.includes('자리배치를 맡았습니다'))
delegate.w.eval(`state.tab='me'; render();`)
;[...delegate.app.querySelectorAll('.row')].find((n) => n.textContent.includes('자리배치 맡김')).click()
await settle()
check('편집기가 열린다', delegate.app.textContent.includes('자리배치 맡김') && !!delegate.app.querySelector('.seatmap.is-edit'))
const lockedBtn = delegate.app.querySelector('button.seatmap-seat.is-locked')
check('고정석은 누를 수 없다', !!lockedBtn && lockedBtn.disabled)
// 자리 없는 친구 «7 가학생» → 빈자리
;[...delegate.app.querySelectorAll('.editor-waiting .chip')].find((n) => n.textContent.includes('가학생')).click()
;[...delegate.app.querySelectorAll('button.seatmap-seat.is-empty')][0].click()
await new Promise((r) => setTimeout(r, 900))
check('놓으면 초안을 저장한다(번호로)', puts.length === 1 && puts[0].seats['d1a:1'] === 7, JSON.stringify(puts[0] && puts[0].seats))
;[...delegate.app.querySelectorAll('button')].find((b) => b.textContent === '무작위').click()
await new Promise((r) => setTimeout(r, 900))
const last = puts[puts.length - 1]
check('무작위도 고정석은 그대로', last.seats['d1a:0'] === 6 && Object.keys(last.seats).length === 2, JSON.stringify(last.seats))
;[...delegate.app.querySelectorAll('button')].find((b) => b.textContent === '담임 선생님께 내기').click()
await settle()
check('담임에게 낸다', submittedCount === 1 && delegate.app.textContent.includes('담임 선생님께 냈습니다'))

console.log('\n[8] 살아 있는 자료 — 층에서 받아 기기에 두고, 다음엔 지문만 묻는다');
const LIVE = {
  etag: 'aaaaaaaaaaaaaaaaaaaaaaaa', today: plus(0),
  school: { schema: 1, name: '한민고등학교', periods: [{ period: 1, startTime: '08:10', endTime: '09:00' }, { period: 2, startTime: '09:10', endTime: '10:00' }], mealTimes: {} },
  changes: { schema: 1, from: plus(-7), to: plus(35), changes: [{ date: plus(1), classId: '2-1', period: 2, kind: 'substitute', origSubject: '실시간 확인 과목', origTeacher: '갑', newTeacher: '을' }] },
  meals: { schema: 1, days: {} }, calendar: { schema: 1, days: [] },
};
const asked = [];
const fresh = await open({ hub: (u) => { if (u.includes('/live')) { asked.push(new URL(u).search); return json(200, u.includes('known=') ? { etag: LIVE.etag, unchanged: true } : LIVE); } return json(200, { ok: true }); }, desk: () => ({ ok: false }) });
check('처음엔 층에서 받는다', asked.length >= 1 && asked[0] === '')
check('수업 변경이 층의 것', fresh.w.eval('state.changes.changes[0].origSubject') === '실시간 확인 과목')
check('일과표도 층의 것', fresh.w.eval('state.school.periods.length') === 2)
check('기기에 둔다', JSON.parse(fresh.store.get('hanmin.timetable.live.v1')).etag === LIVE.etag)
fresh.w.eval('refreshLive()')
await settle()
check('다음엔 지문만 묻는다(같으면 받지 않는다)', asked[asked.length - 1] === `?known=${LIVE.etag}`)

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과')
process.exit(failed ? 1 : 0)
