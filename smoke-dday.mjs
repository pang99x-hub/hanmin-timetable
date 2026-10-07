/*
 * 디데이 — 학생이 정한 날까지 며칠.
 *
 * 이 기능이 지켜야 할 것은 둘이다. **자료를 주고받지 않는다**(창구 호출이 늘지 않는다),
 * 그리고 **이 기기에만 남는다**. 시험 기간에 900명이 한꺼번에 열어도 서버에서 늘어나는
 * 것이 없어야 한다.
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

let deskCalls = 0;
let dataCalls = 0;
w.fetch = async (url, init) => {
  if (String(url).includes('script.google.com')) {
    deskCalls += 1;
    return { ok:true, json: async () => ({ ok:true, found:true, classId:'3-8', sections:['132','141'] }) };
  }
  dataCalls += 1;
  const body = data(String(url).replace('data/',''));
  return body == null ? { ok:false } : { ok:true, json: async () => JSON.parse(body) };
};
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
const store = new Map();
Object.defineProperty(w, 'localStorage', { value:{
  getItem:(k)=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)),
  removeItem:(k)=>store.delete(k) } });

// 이미 로그인해 둔 기기로 시작한다 — 여기서 보려는 것은 로그인이 아니다.
store.set('hanmin.timetable.me.v1', JSON.stringify({
  classId: '3-8', sections: { b19000: '132|고급 물리학|채원식' },
}));

const tag = w.document.createElement('script');
tag.textContent = fs.readFileSync(`${ROOT}/app.js`,'utf8');
w.document.body.appendChild(tag);
await new Promise((r) => setTimeout(r, 300));

const app = w.document.getElementById('app');
const find = (sel) => app.querySelector(sel);
const byText = (sel, text) => [...app.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('  ✓ ' + msg);

const beforeDesk = deskCalls;
const beforeData = dataCalls;

const sheet = () => w.document.getElementById('sheet-root');
const sheetBtn = (text) => [...sheet().querySelectorAll('button')].find((n) => n.textContent.trim() === text);

console.log('\n[1] 정해 두기 전에는 «디데이 정하기» 빈 카드');
/* 자리 — 오늘 화면 맨 위(2026-10 개편: 오늘·일정 맨 위에 크게, 내 정보에는 두지 않는다). */
const first = app.querySelector('.page > .card');
if (!first || !first.classList.contains('dday')) fail('오늘 화면 맨 위 카드가 디데이가 아니다');
else ok('오늘 화면 맨 위에 있다');
if (!app.querySelector('.dday.is-empty') || !app.querySelector('.dday.is-empty').textContent.includes('디데이 정하기')) fail('«디데이 정하기» 카드가 없다');
else ok('«디데이 정하기» 카드가 있다');
if (find('.dday-num')) fail('정하지도 않았는데 큰 숫자가 떠 있다');
else ok('큰 숫자는 아직 없다');

console.log('\n[2] 이름과 날짜를 넣으면 남은 날이 크게 뜬다');
app.querySelector('.dday.is-empty').click();
const name = sheet().querySelector('input[type="text"]');
const when = sheet().querySelector('input[type="date"]');
if (!name || !when) fail('입력칸이 없다');
name.value = '수능';
const target = new Date();
target.setDate(target.getDate() + 73);
const pad = (n) => String(n).padStart(2, '0');
when.value = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
sheetBtn('저장').click();

const bar = find('.dday');
if (!bar || !bar.querySelector('.dday-num')) fail('디데이 숫자가 뜨지 않는다');
else if (bar.querySelector('.dday-num').textContent !== 'D-73') fail('남은 날이 틀리다 — ' + bar.querySelector('.dday-num').textContent);
else ok('D-73 이 크게 뜬다');
if (!bar || !bar.textContent.includes('수능')) fail('이름이 안 보인다');
else ok('이름 «수능» 이 함께 보인다');
if (sheet().querySelector('.sheet')) fail('저장했는데 판이 안 닫혔다');
else ok('저장하면 판이 닫힌다');
w.eval("go('calendar')");
if (!find('.dday .dday-num') || find('.dday .dday-num').textContent !== 'D-73') fail('일정 탭 맨 위에 안 뜬다');
else ok('일정 탭 맨 위에도 뜬다');
w.eval("go('me')");
if (find('.dday')) fail('내 정보에 디데이가 있다 — 두지 않기로 했다');
else ok('내 정보에는 없다');
w.eval("go('today')");

console.log('\n[3] 그날과 지난 날');
const set = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  store.set('hanmin.timetable.dday.v1', JSON.stringify({
    label: '시험', date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  }));
  w.eval('state.dday = loadDday(); render();');
  return find('.dday .dday-num').textContent;
};
if (set(0) !== 'D-DAY') fail('오늘인데 D-DAY 가 아니다');
else ok('오늘이면 D-DAY');
if (set(-5) !== 'D+5') fail('지난 날이 D+5 가 아니다');
else ok('지난 날은 D+5');

console.log('\n[4] 끄면 다시 빈 카드로');
find('.dday').click();
sheetBtn('디데이 끄기').click();
if (find('.dday-num')) fail('껐는데 남아 있다');
else ok('큰 숫자가 사라졌다');
if (!find('.dday.is-empty')) fail('빈 카드로 안 돌아왔다');
else ok('«디데이 정하기» 카드로 돌아왔다');
if (store.has('hanmin.timetable.dday.v1')) fail('저장소에 남아 있다');
else ok('저장소에서도 지워졌다');

console.log('\n[4-1] 학사일정에서 «디데이로 정하기»');
{
  const upcoming = w.eval("JSON.stringify(upcomingSchool(iso(today()), 1))");
  const day = JSON.parse(upcoming)[0];
  if (!day) console.log('  (다가오는 학사일정이 없어 건너뜀)');
  else {
    w.eval(`openSheet({ type: 'school', date: '${day.date}' })`);
    sheetBtn('디데이로 정하기').click();
    const saved = JSON.parse(store.get('hanmin.timetable.dday.v1') || 'null');
    if (!saved || saved.date !== day.date || saved.label !== day.labels[0]) fail('학사일정이 디데이로 안 들어갔다');
    else ok(`«${day.labels[0]}» 이 디데이가 됐다`);
    store.delete('hanmin.timetable.dday.v1');
    w.eval('state.dday = loadDday(); render();');
  }
}

console.log('\n[5] 자료를 주고받지 않는다');
if (deskCalls !== beforeDesk) fail(`창구를 ${deskCalls - beforeDesk}번 더 불렀다`);
else ok('창구 호출이 늘지 않았다');
if (dataCalls !== beforeData) fail(`정적 파일을 ${dataCalls - beforeData}번 더 받았다`);
else ok('정적 파일 요청이 늘지 않았다');

console.log(process.exitCode ? '\n실패' : '\n전부 통과');
process.exit(process.exitCode ?? 0);
