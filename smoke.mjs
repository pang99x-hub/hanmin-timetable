import { JSDOM } from 'jsdom';   // node --experimental-... 없이: NODE_PATH 로 잡거나 pnpm add -D jsdom
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const data = (n) => { try { return fs.readFileSync(`${ROOT}/data/${n}`,'utf8'); } catch { return null; } };

const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`,'utf8'),
  { url:'https://pang99x-hub.github.io/hanmin-timetable/', runScripts:'dangerously', pretendToBeVisual:true });
const w = dom.window;

// 정적 파일은 디스크에서, 창구 응답은 실제 학생 하나로 흉내 낸다.
let deskCalls = 0;
w.fetch = async (url, init) => {
  if (String(url).includes('script.google.com')) {
    deskCalls += 1;
    const sent = JSON.parse(init.body);
    if (sent.action !== 'mySections') throw new Error('엉뚱한 요청: ' + sent.action);
    if (init.headers['Content-Type'] !== 'text/plain;charset=utf-8') throw new Error('preflight 유발 헤더');
    return { ok:true, json: async () => ({ ok:true, found:true, classId:'3-8', sections:['132','141'] }) };
  }
  const body = data(String(url).replace('data/',''));
  return body == null ? { ok:false } : { ok:true, json: async () => JSON.parse(body) };
};
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
const store = new Map();
Object.defineProperty(w, 'localStorage', { value:{
  getItem:(k)=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)),
  removeItem:(k)=>store.delete(k) } });

const tag = w.document.createElement('script');
tag.textContent = fs.readFileSync(`${ROOT}/app.js`,'utf8');
w.document.body.appendChild(tag);
await new Promise((r) => setTimeout(r, 300));

const app = w.document.getElementById('app');
const text = () => app.textContent.replace(/\s+/g,' ').trim();
console.log('1) 로그인 화면 :', text().slice(0,90));
if (!text().includes('로그인')) throw new Error('로그인 화면이 안 나옴');

// 구글이 토큰을 돌려준 척한다
await w.onCredential({ credential: '가짜토큰' });
await new Promise((r) => setTimeout(r, 200));
console.log('2) 창구 호출 수 :', deskCalls);
const me = JSON.parse(store.get('hanmin.timetable.me.v1'));
console.log('3) 저장된 나   :', JSON.stringify(me));
console.log('4) 시간표 화면 :', text().slice(0,120));
if (me.classId !== '3-8') throw new Error('학급이 안 들어옴');
if (Object.keys(me.sections).length !== 2) throw new Error('강좌 ' + Object.keys(me.sections).length + '개만 들어옴');
const unpicked = [...app.querySelectorAll('.pick button')].length;
console.log('5) 안 채워진 이동수업 칸:', unpicked);
if (unpicked) throw new Error('로그인했는데 «고르기» 가 ' + unpicked + '칸 남음');
console.log('\n통과');
