/*
 * 내 일정 — 학생이 적는 일정.
 *
 * 지켜야 할 것 셋.
 *   1. 교시를 붙이면 그 교시 칸에 붙는다. 붙이지 않으면 하루 일정으로 아래에 선다.
 *   2. 기기 저장이 원본이다. 캘린더에 못 올렸으면 «이 기기에만 있음»이라고 말한다 —
 *      됐다고 믿게 두고 기기를 바꾸면 그때 사라진 것을 안다.
 *   3. 우리 서버에는 아무것도 가지 않는다. 창구도 정적 파일도 부르지 않는다.
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const data = (n) => { try { return fs.readFileSync(`${ROOT}/data/${n}`,'utf8'); } catch { return null; } };

const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`,'utf8'),
  { url:'https://timetable.hanmin.hs.kr/', runScripts:'dangerously', pretendToBeVisual:true });
const w = dom.window;

let deskCalls = 0, dataCalls = 0, calCalls = 0;
const calStore = new Map();
w.fetch = async (url, init) => {
  const target = String(url);
  if (target.includes('script.google.com')) { deskCalls += 1; return { ok:true, json: async () => ({ ok:true }) }; }
  if (target.includes('googleapis.com')) {
    calCalls += 1;
    const method = (init && init.method) || 'GET';
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const id = `g${calStore.size + 1}`;
      calStore.set(id, body);
      return { ok:true, status:200, json: async () => ({ id, ...body }) };
    }
    if (method === 'DELETE') {
      calStore.delete(decodeURIComponent(target.split('/').pop()));
      return { ok:true, status:204, json: async () => ({}) };
    }
    return { ok:true, status:200, json: async () => ({ items: [...calStore.entries()].map(([id, body]) => ({ id, ...body })) }) };
  }
  dataCalls += 1;
  const body = data(target.replace('data/',''));
  return body == null ? { ok:false } : { ok:true, json: async () => JSON.parse(body) };
};
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
const store = new Map();
Object.defineProperty(w, 'localStorage', { value:{
  getItem:(k)=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)),
  removeItem:(k)=>store.delete(k) } });
store.set('hanmin.timetable.me.v1', JSON.stringify({ classId:'3-8', sections:{} }));

// 구글 권한은 이미 준 기기로 흉내 낸다.
w.google = { accounts: {
  id: { initialize(){}, renderButton(){}, prompt(){}, disableAutoSelect(){} },
  oauth2: { initTokenClient: (opts) => ({
    requestAccessToken: () => opts.callback({ access_token:'test-token', expires_in:3600 }),
  }) },
} };

const tag = w.document.createElement('script');
tag.textContent = fs.readFileSync(`${ROOT}/app.js`,'utf8');
w.document.body.appendChild(tag);
await new Promise((r) => setTimeout(r, 300));

const app = w.document.getElementById('app');
const byText = (sel, text) => [...app.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('  ✓ ' + msg);
const today = w.eval('iso(state.cursor)');
const settle = () => new Promise((r) => setTimeout(r, 60));

const beforeDesk = deskCalls, beforeData = dataCalls;

console.log('\n[1] 교시를 붙이면 그 교시 칸에 붙는다');
w.eval(`saveEvents([{ id:'a', date:'${today}', period:3, title:'수행평가', gcalId:'g0' }]); render();`);
const slot = [...app.querySelectorAll('.slot')].find((n) => n.textContent.includes('3교시'));
if (!slot || !slot.textContent.includes('수행평가')) fail('3교시 칸에 안 붙었다');
else ok('3교시 칸 안에 «수행평가» 가 붙는다');
const list = app.querySelector('.evs');
if (list && list.textContent.includes('수행평가')) fail('아래 목록에도 또 세운다 — 같은 것을 두 번 보여 준다');
else ok('아래 목록에는 다시 세우지 않는다');

console.log('\n[2] 교시 없이 적으면 하루 일정으로 아래에 선다');
w.eval(`saveEvents([{ id:'b', date:'${today}', period:null, title:'동아리 모임', gcalId:'g0' }]); render();`);
if (!app.querySelector('.evs').textContent.includes('동아리 모임')) fail('하루 일정이 안 보인다');
else ok('아래 목록에 선다');

console.log('\n[3] 캘린더에 못 올린 것은 그렇게 말한다');
w.eval(`saveEvents([{ id:'c', date:'${today}', period:null, title:'과제 제출', gcalId:null }]); render();`);
if (!app.querySelector('.ev-sync')) fail('«이 기기에만 있음» 안내가 없다');
else ok('«이 기기에만 있음» 이라고 말한다');

console.log('\n[4] 올리면 캘린더에 생기고 안내가 사라진다');
app.querySelector('.ev-sync').click();
await settle();
if (calStore.size !== 1) fail(`캘린더에 안 올라갔다 — ${calStore.size}건`);
else ok('캘린더에 1건 올라갔다');
const saved = [...calStore.values()][0];
if (saved.extendedProperties.private.hanmin !== 'hanmin-timetable') fail('우리 것이라는 표가 없다');
else ok('우리가 적은 것이라는 표가 붙는다');
if (app.querySelector('.ev-sync')) fail('안내가 그대로 남아 있다');
else ok('안내가 사라졌다');

console.log('\n[5] 교시가 붙은 일정은 그 시각으로 간다');
w.eval(`state.eventEdit = null; saveEvents([{ id:'d', date:'${today}', period:2, title:'발표', gcalId:null }]); render();`);
app.querySelector('.ev-sync').click();
await settle();
const timed = [...calStore.values()].find((b) => String(b.summary).includes('발표'));
if (!timed || !timed.start.dateTime) fail('하루 종일로 올라갔다');
else ok(`2교시 시각으로 올라간다 — ${timed.start.dateTime}`);

console.log('\n[6] 기기를 바꿔도 캘린더에서 되받아 온다');
store.delete('hanmin.timetable.events.v1');
w.eval('state.events = []; render();');
await w.eval('pullEventsFromCalendar()');
await settle();
if (w.eval('state.events.length') !== calStore.size) fail(`되받은 수가 다르다 — ${w.eval('state.events.length')} vs ${calStore.size}`);
else ok(`캘린더에서 ${calStore.size}건을 되받았다`);
if (!w.eval("state.events.some((e) => e.period === 2 && e.title === '발표')")) fail('교시가 안 따라왔다');
else ok('교시와 제목이 그대로 따라온다');

console.log('\n[7] 우리 서버에는 아무것도 가지 않는다');
if (deskCalls !== beforeDesk) fail(`창구를 ${deskCalls - beforeDesk}번 불렀다`);
else ok('창구 호출이 늘지 않았다');
if (dataCalls !== beforeData) fail(`정적 파일을 ${dataCalls - beforeData}번 더 받았다`);
else ok('정적 파일 요청이 늘지 않았다');
console.log(`     (구글 캘린더 호출 ${calCalls}건 — 학생 계정과 구글 사이의 일이다)`);

console.log(process.exitCode ? '\n실패' : '\n전부 통과');
