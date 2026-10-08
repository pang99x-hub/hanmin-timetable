/*
 * 우리 반 일정 점검 — 2026-10-08.
 *
 *   1. 반 친구가 올린 일정이 오늘(사흘 안)·달력 점·고른 날 카드·다가오는 일정에 뜬다. 쓴 사람은 번호·이름
 *   2. 새 일정 판에서 «우리 반»을 고르면 메모 칸이 열리고 «올리기» — 학생용 층에 올리고 돌아온 목록을 기기에 둔다
 *   3. 못 올리면(하루 한도 등) 판을 닫지 않고 까닭을 보인다
 *   4. 내가 올린 것은 고치는 판(삭제 포함), 남이 올린 것은 읽는 판(«디데이로 정하기»만)
 *   5. 선생님이 학생 화면으로 볼 때 — 그 반 일정이 보이고, 두 번 눌러 지운다. «누구와»는 보이되 우리 반으로 올리지는 않는다
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

const FRIEND = { id: 'ce-friend-01', date: plus(1), period: 3, title: '체육복 챙기기', note: '운동장 수업이라\n운동화도', by: { no: 6, name: '나학생' }, mine: false };
const MINE = { id: 'ce-mine-0001', date: plus(2), period: null, title: '반 회의', note: '', by: { no: 7, name: '가학생' }, mine: true };
const ME = { student: { classId: '2-1', no: 7, name: '가학생' }, sections: [sample.sectionId], events: [], classEvents: [FRIEND, MINE], seats: [], lessonSeats: [] };

async function open({ hub, url = 'https://timetable.hanmin.hs.kr/', opener }) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`, 'utf8'), { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const store = new Map();
  const calls = [];
  w.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.startsWith('https://students.hiax.cloud')) {
      calls.push({ at: `${init.method || 'GET'} ${new URL(u).pathname}`, body: init.body ? JSON.parse(init.body) : null });
      const r = hub(u, init);
      return { ok: r.status < 300, status: r.status, json: async () => r.body };
    }
    try { return { ok: true, json: async () => JSON.parse(read(u.replace('data/', ''))) }; } catch { return { ok: false }; }
  };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  w.structuredClone = structuredClone;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
  if (opener) Object.defineProperty(w, 'opener', { value: opener(w) });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 300));
  return { w, store, calls, app: w.document.getElementById('app'), sheet: () => w.document.getElementById('sheet-root') };
}
const settle = () => new Promise((r) => setTimeout(r, 120));
const buttons = (root) => [...root.querySelectorAll('button')];
const byText = (root, text) => buttons(root).find((b) => b.textContent.trim() === text);

let reply = null;
let posted = [];
const s = await open({
  hub: (u, init) => {
    const path = new URL(u).pathname;
    if (path === '/login') return { status: 200, body: { token: 't'.repeat(43), expiresAt: Date.now() + 1e9, me: ME } };
    if (path === '/me') return { status: 200, body: ME };
    if (path === '/class-events' && init.method === 'POST') {
      if (reply) return reply;
      const body = JSON.parse(init.body);
      posted = [...posted, { id: 'ce-new-00001', ...body, by: { no: 7, name: '가학생' }, mine: true }];
      return { status: 200, body: { ok: true, classEvents: [FRIEND, MINE, ...posted] } };
    }
    if (path.startsWith('/class-events/') && init.method === 'PUT') {
      const body = JSON.parse(init.body);
      return { status: 200, body: { ok: true, classEvents: [FRIEND, { ...MINE, ...body }, ...posted] } };
    }
    if (path.startsWith('/class-events/') && init.method === 'DELETE') return { status: 200, body: { ok: true, classEvents: [FRIEND, ...posted] } };
    return { status: 200, body: { ok: true } };
  },
});
await s.w.onCredential({ credential: '학생토큰' });
await settle();

console.log('\n[1] 반 친구가 올린 일정이 보인다');
s.w.eval(`state.tab='today'; render();`);
const soon = [...s.app.querySelectorAll('.card')].find((n) => n.querySelector('.card-title')?.textContent.trim() === '우리 반 일정');
check('오늘 — 사흘 안 «우리 반 일정» 카드', !!soon && soon.textContent.includes('체육복 챙기기') && soon.textContent.includes('반 회의'));
check('오늘 — 쓴 사람은 번호·이름', !!soon && soon.textContent.includes('3교시 · 6번 나학생'));
s.w.eval(`state.tab='calendar'; state.month=new Date(parse('${plus(1)}').getFullYear(), parse('${plus(1)}').getMonth(), 1); state.selDate=parse('${plus(1)}'); render();`);
const cell = [...s.app.querySelectorAll('.mo .day')].find((n) => (n.getAttribute('aria-label') || '').includes('우리 반 1'));
check('달력 — 그 날 칸에 우리 반 점', !!cell && !!cell.querySelector('.dot.is-class'));
check('달력 — 범례에 «우리 반»', [...s.app.querySelectorAll('.legend span')].some((n) => n.textContent === '우리 반'));
const friendRow = [...s.app.querySelectorAll('.row.is-class')].find((n) => n.textContent.includes('체육복 챙기기'));
check('달력 — 고른 날 카드에 «우리 반» 줄', !!friendRow && friendRow.textContent.startsWith('우리 반'));
const upcoming = [...s.app.querySelectorAll('.card')].find((n) => n.querySelector('.card-title')?.textContent.trim() === '다가오는 일정');
check('다가오는 일정에도', !!upcoming && upcoming.textContent.includes('체육복 챙기기'));

console.log('\n[2] 남이 올린 것은 읽기만');
friendRow.click();
await settle();
let sheet = s.sheet();
check('내용 전체와 쓴 사람', sheet.textContent.includes('운동화도') && sheet.textContent.includes('6번 나학생'));
check('«디데이로 정하기»만 — 삭제·저장 없음', !!byText(sheet, '디데이로 정하기') && !byText(sheet, '삭제') && !byText(sheet, '저장'));
s.w.eval('closeSheet()');

console.log('\n[3] 우리 반으로 올리기');
byText(s.app, '이날 일정 추가')?.click() ?? buttons(s.app).find((b) => b.textContent.includes('이날 일정 추가')).click();
await settle();
sheet = s.sheet();
const scope = sheet.querySelector('[aria-label="누구와"]');
check('«누구와: 나만 / 우리 반»을 고른다', !!scope && buttons(scope).map((b) => b.textContent).join('/') === '나만/우리 반');
const note = sheet.querySelector('textarea');
check('처음엔 «나만» — 메모 칸이 닫혀 있다', !!note && note.closest('.field').hidden === true);
byText(scope, '우리 반').click();
check('«우리 반»을 고르면 메모 칸이 열리고 «올리기»', note.closest('.field').hidden === false && !!byText(sheet, '올리기'));
sheet.querySelector('input[type="text"]').value = '  수학 수행평가 ';
note.value = '교과서 지참';
byText(sheet, '올리기').click();
await settle();
const post = s.calls.find((c) => c.at === 'POST /class-events');
check('학생용 층에 올린다', !!post && post.body.title === '수학 수행평가' && post.body.note === '교과서 지참' && post.body.date === plus(1), JSON.stringify(post?.body));
check('판이 닫힌다', !s.sheet().querySelector('.sheet'));
check('돌아온 목록을 기기에 둔다', JSON.parse(s.store.get('hanmin.timetable.hub.v1')).me.classEvents.some((e) => e.title === '수학 수행평가'));
check('내 기기 일정(나만)에는 넣지 않는다', !(s.store.get('hanmin.timetable.events.v1') || '').includes('수학 수행평가'));

console.log('\n[4] 못 올리면 까닭을 보인다');
reply = { status: 429, body: { error: '오늘은 더 올릴 수 없습니다. 내일 다시 올려 주세요.' } };
s.w.eval(`openSheet({ type: 'event', draft: { date: '${plus(1)}', period: null, title: '' } })`);
await settle();
sheet = s.sheet();
byText(sheet.querySelector('[aria-label="누구와"]'), '우리 반').click();
sheet.querySelector('input[type="text"]').value = '하나 더';
byText(sheet, '올리기').click();
await settle();
const alert = sheet.querySelector('[role="alert"]');
check('판이 그대로 있고 까닭이 보인다', !!s.sheet().querySelector('.sheet') && !!alert && !alert.hidden && alert.textContent.includes('오늘은 더 올릴 수 없습니다'));
check('단추가 다시 눌린다', byText(sheet, '올리기')?.disabled === false);
reply = null;
s.w.eval('closeSheet()');

console.log('\n[5] 내가 올린 것은 고치고 지운다');
s.w.eval(`state.selDate=parse('${plus(2)}'); render();`);
[...s.app.querySelectorAll('.row.is-class')].find((n) => n.textContent.includes('반 회의')).click();
await settle();
sheet = s.sheet();
check('«우리 반 일정 고치기» 판', sheet.textContent.includes('우리 반 일정 고치기'));
check('고칠 때는 «누구와»를 다시 묻지 않는다', !sheet.querySelector('[aria-label="누구와"]'));
sheet.querySelector('input[type="text"]').value = '반 회의 (자리 정하기)';
byText(sheet, '저장').click();
await settle();
const put = s.calls.find((c) => c.at === 'PUT /class-events/ce-mine-0001');
check('고치기는 PUT', !!put && put.body.title === '반 회의 (자리 정하기)');
s.w.eval(`openClassEvent(classEventsAll().find((e) => e.id === 'ce-mine-0001'))`);
await settle();
byText(s.sheet(), '삭제').click();
await settle();
check('지우기는 DELETE', s.calls.some((c) => c.at === 'DELETE /class-events/ce-mine-0001'));
check('지운 것은 목록에서 빠진다', !JSON.parse(s.store.get('hanmin.timetable.hub.v1')).me.classEvents.some((e) => e.id === 'ce-mine-0001'));

console.log('\n[6] 선생님이 학생 화면으로 볼 때');
const tcalls = [];
const t = await open({
  url: 'https://timetable.hanmin.hs.kr/?axExternal=1',
  opener: (w) => {
    const host = {
      closed: false,
      postMessage(message, origin) {
        if (message.type !== 'ax-student-app:ready' || origin !== 'https://ax.hanmin.hs.kr') return;
        setTimeout(() => {
          const event = new w.Event('message');
          Object.defineProperties(event, {
            data: { value: { type: 'ax-student-app:ticket', nonce: message.nonce, ticket: 'a'.repeat(64), theme: 'light' } },
            origin: { value: 'https://ax.hanmin.hs.kr' }, source: { value: host },
          });
          w.dispatchEvent(event);
        }, 0);
      },
    };
    return host;
  },
  hub: (u, init) => {
    const url = new URL(u);
    tcalls.push(`${init.method || 'GET'} ${url.pathname}`);
    if (url.pathname === '/ax/login') return { status: 200, body: { ok: true, role: 'teacher', sessionToken: 'x'.repeat(43), profileId: 'p1', expiresIn: 900, roster: [{ classId: '2-1', no: '7', name: '가학생' }] } };
    if (url.pathname === '/ax/student') return { status: 200, body: { ok: true, found: true, classId: '2-1', no: '7', name: '가학생', sections: [String(sample.sectionId)], seats: [], lessonSeats: [], classEvents: [{ ...FRIEND }] } };
    if (url.pathname.startsWith('/ax/class-events/') && init.method === 'DELETE') return { status: 200, body: { ok: true } };
    return { status: 404, body: { error: '없는 주소' } };
  },
});
t.w.eval(`openStudent({ classId: '2-1', no: '7' })`);
await settle();
t.w.eval(`state.tab='calendar'; state.month=new Date(parse('${plus(1)}').getFullYear(), parse('${plus(1)}').getMonth(), 1); state.selDate=parse('${plus(1)}'); render();`);
const trow = [...t.app.querySelectorAll('.row.is-class')].find((n) => n.textContent.includes('체육복 챙기기'));
check('그 반 일정이 보인다', !!trow);
t.w.eval(`openSheet({ type: 'event', draft: { date: '${plus(1)}', period: null, title: '' } })`);
await settle();
const previewScope = t.sheet().querySelector('[aria-label="누구와"]');
check('보는 중에도 «누구와»는 보인다(학생이 보는 판 그대로)', !!previewScope);
byText(previewScope, '우리 반').click();
check('보는 중에는 «우리 반»으로 올릴 수 없다 — 단추가 막히고 까닭을 말한다', byText(t.sheet(), '올리기')?.disabled === true && t.sheet().textContent.includes('학생 화면 보기라 여기서는 올리지 않습니다'));
t.w.eval('closeSheet()');
trow.click();
await settle();
const del = byText(t.sheet(), '지우기');
check('«지우기»가 있고 «디데이로 정하기»는 없다', !!del && !byText(t.sheet(), '디데이로 정하기'));
del.click();
await settle();
check('한 번 눌러서는 지우지 않는다', !tcalls.some((c) => c.startsWith('DELETE')) && del.textContent.includes('한 번 더'));
del.click();
await settle();
check('두 번째에 학생용 층 선생님 길로 지운다', tcalls.includes('DELETE /ax/class-events/ce-friend-01'));
check('화면에서도 빠진다', ![...t.app.querySelectorAll('.row.is-class')].some((n) => n.textContent.includes('체육복 챙기기')));
check('선생님이 본 것은 기기에 남지 않는다', !t.store.has('hanmin.timetable.hub.v1') && !t.store.has('hanmin.timetable.me.v1'));

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
