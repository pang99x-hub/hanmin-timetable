/*
 * 합반·분반·동명·교차수업 — 교사웹에서 사고가 났던 자리들.
 *
 * 공통 원인은 하나다: **이동수업 칸은 (반·교시)로 특정되지 않는다.** 여기서는 실제
 * 발행 자료와 실제 변경 기록으로 확인한다. 지어낸 자료로는 이 함정이 드러나지 않는다.
 */
const jsdomPath = process.env.JSDOM_PATH
  ?? process.env.HOME + '/Documents/AX 시스템 구축/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/lib/api.js';
const { JSDOM } = await import('file://' + jsdomPath);
import fs from 'node:fs';
const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
const read = (n) => fs.readFileSync(`${ROOT}/data/${n}`, 'utf8');
const sections = JSON.parse(read('sections.json')).sections;
const classes = JSON.parse(read('classes.json')).classes;
const changes = JSON.parse(read('changes.json')).changes;

async function open(classId, chosen) {
  const dom = new JSDOM(fs.readFileSync(`${ROOT}/index.html`, 'utf8'),
    { url: 'https://x/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = async (u) => {
    const n = String(u).replace('data/', '');
    try { return { ok: true, json: async () => JSON.parse(read(n)) }; } catch { return { ok: false }; }
  };
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  const store = new Map([['hanmin.timetable.me.v1',
    JSON.stringify({ classId, sections: chosen })]]);
  Object.defineProperty(w, 'localStorage', { value: {
    getItem: (k) => store.get(k) ?? null, setItem() {}, removeItem() {} } });
  const tag = w.document.createElement('script');
  tag.textContent = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  w.document.body.appendChild(tag);
  await new Promise((r) => setTimeout(r, 250));
  return w;
}
const key = (s) => `${s.sectionId}|${s.subject}|${s.teacher ?? ''}`;
/** 그 학생이 그 강좌를 듣게 하고, 나머지 밴드는 아무거나 채운다. */
const enrol = (classId, take) => {
  const out = {};
  for (const s of sections) if (s.classIds.includes(classId)) out[s.bandKey] ??= key(s);
  if (take) out[take.bandKey] = key(take);
  return out;
};
const fail = [];
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail.push(name);
};
const cellAt = async (classId, take, date, period) => {
  const w = await open(classId, enrol(classId, take));
  return w.eval(
    `JSON.stringify(changeForCell(changesOn(parse('${date}')), ${period}, ` +
    `lessonsOn(parse('${date}')).get(${period})))`);
};

/* ── 1. 합반 — 변경은 한 반에만 적히지만 함께 듣는 반 전부가 받아야 한다 ── */
console.log('[1] 합반 — 변경이 적히지 않은 반의 학생도 받는가');
{
  const merged = changes.filter((c) => c.origSubject).map((c) => {
    const s = sections.find((x) => x.subject === c.origSubject
      && x.classIds.includes(c.classId) && x.classIds.length > 1
      && x.period === c.period);
    return s ? { c, s } : null;
  }).filter(Boolean);
  console.log(`   합반 강좌에 걸린 변경 ${merged.length}건`);
  for (const { c, s } of merged.slice(0, 3)) {
    const other = s.classIds.find((x) => x !== c.classId);
    const mine = await cellAt(c.classId, s, c.date, c.period);
    const theirs = await cellAt(other, s, c.date, c.period);
    check(`${c.date} ${c.period}교시 «${c.origSubject}» ${c.classId}(기록된 반)`,
      mine !== 'null');
    check(`${c.date} ${c.period}교시 «${c.origSubject}» ${other}(안 적힌 반)`,
      theirs !== 'null');
  }
}

/* ── 2. 동명 강좌 — 같은 시간 같은 이름 둘. 담당이 다른 쪽은 받으면 안 된다 ── */
console.log('\n[2] 동명 강좌 — 옆 분반 학생이 남의 보강을 받는가');
{
  let tried = 0;
  for (const c of changes) {
    if (!c.origSubject || !c.origTeacher) continue;
    const twins = sections.filter((x) => x.subject === c.origSubject
      && x.period === c.period && x.classIds.includes(c.classId));
    if (twins.length < 2) continue;
    const mine = twins.find((x) => x.teacher === c.origTeacher);
    const other = twins.find((x) => x.teacher !== c.origTeacher);
    if (!mine || !other) continue;
    tried += 1;
    check(`${c.date} ${c.period}교시 «${c.origSubject}» ${mine.teacher} 반 학생은 받음`,
      (await cellAt(c.classId, mine, c.date, c.period)) !== 'null');
    check(`${c.date} ${c.period}교시 «${c.origSubject}» ${other.teacher} 반 학생은 안 받음`,
      (await cellAt(c.classId, other, c.date, c.period)) === 'null');
    if (tried >= 2) break;
  }
  if (!tried) console.log('   (표본 없음)');
}

/* ── 3. 겹친 변경 — 하나만 집으면 나머지가 조용히 사라진다 ── */
console.log('\n[3] 겹친 변경 — 한 칸에 둘이 쌓였을 때');
{
  const bySlot = new Map();
  for (const c of changes) {
    if (!c.classId) continue;
    const k = `${c.date}|${c.classId}|${c.period}`;
    bySlot.set(k, [...(bySlot.get(k) ?? []), c]);
  }
  const stacked = [...bySlot.entries()].filter(([, v]) => v.length > 1);
  console.log(`   한 칸에 둘 이상 쌓인 자리 ${stacked.length}곳`);
  for (const [k, list] of stacked.slice(0, 2)) {
    const [date, classId, period] = k.split('|');
    const got = await cellAt(classId, null, date, Number(period));
    const parsed = got === 'null' ? null : JSON.parse(got);
    check(`${date} ${classId} ${period}교시 — ${list.length}건을 다 들고 있음`,
      Boolean(parsed) && parsed.stack.length === list.length,
      parsed ? `집은 것 ${parsed.stack.length}건 · ${parsed.note}` : '못 집음');
  }
}

/* ── 4. 교차수업 — 두 교시 묶음(음악·미술)이 시간표에 있는가 ── */
console.log('\n[4] 교차수업 — 학급 전체가 듣는 묶음 수업');
{
  const block = classes.filter((c) => ['음악', '미술', '음악과 융합', '미술 창작'].includes(c.subject));
  console.log(`   묶음 수업 칸 ${block.length}개`);
  check('공개 시간표에 실려 있음', block.length > 0);
  const one = block[0];
  if (one) {
    const w = await open(one.classId, enrol(one.classId, null));
    const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    const shown = w.eval(
      `JSON.stringify(lessonsOn(parse('${days[one.day]}')).get(${one.period}))`);
    check(`${one.classId} ${'월화수목금'[one.day]} ${one.period}교시 «${one.subject}» 가 화면에 뜸`,
      shown.includes(one.subject), shown);
  }
}

console.log(fail.length ? `\n실패 ${fail.length}건` : '\n전부 통과');
process.exit(fail.length ? 1 : 0);
