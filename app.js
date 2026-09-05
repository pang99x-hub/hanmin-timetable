/*
 * 한민고 학생 시간표.
 *
 * 자료는 전부 이 사이트의 정적 파일에서 온다 — 서버에 묻지 않는다.
 *   school.json    교시 시각·식사 시각 (교사웹 일과표에서 옴)
 *   classes.json   반별 시간표
 *   sections.json  강좌별 시간표 (명단 없이 시간만)
 *   changes.json   수업 변경 — 아직 없다(3단계)
 *   meals.json     급식     — 아직 없다(3단계)
 *   calendar.json  학사일정 — 아직 없다(3단계)
 *
 * 없는 파일은 없는 대로 그린다. 「아직 안 올라온 것」과 「오늘은 없는 것」을 화면이
 * 구분해 말한다 — 빈칸만 두면 학생은 고장으로 읽는다.
 *
 * 내 반과 내 강좌는 **이 기기에만** 저장한다. 서버로 보내지 않는다.
 */
'use strict';

const DAYS = ['월', '화', '수', '목', '금'];
const KEY = 'hanmin.timetable.me.v1';
const DATA = 'data/';

const state = {
  school: null, classes: [], sections: [],
  changes: null, meals: null, calendar: null,
  me: null,          // { classId, sections: {bandKey: sectionKey} }
  view: 'day',       // day | week | month
  cursor: new Date(),
  loadedAt: null,
};

/* ── 날짜 도구 ── 시간대에 흔들리지 않게 로컬 기준으로만 다룬다. */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayIndex = (d) => d.getDay() - 1;              // 0=월 … 4=금, 주말은 음수/5
const isWeekday = (d) => dayIndex(d) >= 0 && dayIndex(d) <= 4;
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const sameDay = (a, b) => iso(a) === iso(b);
const fmtDate = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}`;

async function load(name) {
  try {
    const res = await fetch(`${DATA}${name}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function boot() {
  const [school, classes, sections, changes, meals, calendar] = await Promise.all(
    ['school.json', 'classes.json', 'sections.json', 'changes.json', 'meals.json', 'calendar.json']
      .map(load),
  );
  if (!school || !classes) {
    document.getElementById('app').innerHTML =
      '<div class="notice">시간표를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</div>';
    return;
  }
  state.school = school;
  state.classes = classes.classes || [];
  state.sections = (sections && sections.sections) || [];
  state.changes = changes;
  state.meals = meals;
  state.calendar = calendar;
  state.loadedAt = classes.generatedAt || null;

  try { state.me = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state.me = null; }
  // 주말에 열면 다음 수업일부터 보여 준다 — 빈 주말을 띄워 놓을 이유가 없다.
  let cur = new Date();
  while (!isWeekday(cur)) cur = addDays(cur, 1);
  state.cursor = cur;

  render();
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft') { move(-1); event.preventDefault(); }
    if (event.key === 'ArrowRight') { move(1); event.preventDefault(); }
  });
}

const save = () => localStorage.setItem(KEY, JSON.stringify(state.me));

/* ── 내 시간표 만들기 ────────────────────────────────────────────────
 * 반 시간표 + 내가 고른 강좌. 강좌를 아직 안 고른 밴드는 «고르기»로 남긴다 —
 * 비워 두면 그 시간에 수업이 없는 것으로 오해한다.
 */
function bandsOfMyClass() {
  const map = new Map();
  for (const sec of state.sections) {
    if (!sec.classIds.includes(state.me.classId)) continue;
    const band = sec.bandKey || sec.subject;
    if (!map.has(band)) map.set(band, []);
    map.get(band).push(sec);
  }
  return map;
}
const sectionKey = (sec) => `${sec.sectionId ?? ''}|${sec.subject}|${sec.teacher ?? ''}`;

function lessonsOn(date) {
  const day = dayIndex(date);
  const out = [];
  for (const cell of state.classes) {
    if (cell.classId === state.me.classId && cell.day === day) {
      out.push({
        period: cell.period, subject: cell.subject,
        teacher: cell.teacher, room: cell.room, kind: 'class',
      });
    }
  }
  const bands = bandsOfMyClass();
  for (const [band, list] of bands) {
    const chosen = state.me.sections[band];
    for (const sec of list) {
      if (sec.day !== day) continue;
      if (chosen && sectionKey(sec) !== chosen) continue;
      out.push(chosen
        ? {
            period: sec.period, subject: sec.subject,
            teacher: sec.teacher, room: sec.room, kind: 'section',
          }
        : { period: sec.period, subject: '이동수업', teacher: null, kind: 'unpicked', band });
    }
  }
  // 같은 교시에 «안 고른 밴드»가 여러 개면 한 줄로 접는다.
  const byPeriod = new Map();
  for (const item of out) {
    const found = byPeriod.get(item.period);
    if (!found) { byPeriod.set(item.period, item); continue; }
    if (found.kind === 'unpicked' && item.kind !== 'unpicked') byPeriod.set(item.period, item);
  }
  return byPeriod;
}

/* 그 날 그 반에 걸린 변경. changes.json 이 없으면 빈 목록이다. */
function changesOn(date) {
  if (!state.changes || !state.changes.changes) return [];
  const key = iso(date);
  return state.changes.changes.filter(
    (chg) => chg.opDate === key && (chg.classId === state.me.classId || !chg.classId),
  );
}

/* ── 그리기 ── */
function render() {
  const app = document.getElementById('app');
  if (!state.me || !state.me.classId) { app.innerHTML = ''; app.appendChild(setupClass()); return; }
  app.innerHTML = '';
  app.appendChild(header());
  const cols = document.createElement('div');
  cols.className = state.view === 'day' ? 'cols both' : 'cols';
  if (state.view === 'day') { cols.appendChild(todayPanel()); cols.appendChild(weekPanel()); }
  else if (state.view === 'week') cols.appendChild(weekPanel());
  else cols.appendChild(monthPanel());
  app.appendChild(cols);
  app.appendChild(footer());
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function header() {
  const box = el('div');
  const top = el('div', 'top');
  const left = el('div');
  const title = el('h1', 'title');
  title.append(state.view === 'month'
    ? `${state.cursor.getFullYear()}년 ${state.cursor.getMonth() + 1}월`
    : fmtDate(state.cursor));
  if (state.view !== 'month' && sameDay(state.cursor, new Date())) {
    const tag = el('em', null, '오늘'); title.appendChild(tag);
  }
  left.appendChild(title);

  const asof = el('p', 'asof');
  if (state.loadedAt) {
    const when = new Date(state.loadedAt);
    const days = Math.floor((Date.now() - when.getTime()) / 86400000);
    asof.append(`${when.getMonth() + 1}/${when.getDate()} 기준 · `);
    const mark = el('b', days <= 7 ? 'fresh' : 'stale', days <= 7 ? '최신' : `${days}일 지남`);
    asof.appendChild(mark);
  }
  left.appendChild(asof);
  top.appendChild(left);

  const right = el('div', 'right');
  const me = el('button', 'me', state.me.classId);
  me.title = '반 다시 고르기';
  me.onclick = () => { state.me = null; render(); };
  right.appendChild(me);
  top.appendChild(right);
  box.appendChild(top);

  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [key, label] of [['day', '오늘'], ['week', '주'], ['month', '월']]) {
    const btn = el('button', null, label);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(state.view === key));
    btn.onclick = () => { state.view = key; render(); };
    tabs.appendChild(btn);
  }
  box.appendChild(tabs);

  const nav = el('div', 'nav');
  const prev = el('button', null, '‹'); prev.setAttribute('aria-label', '이전');
  prev.onclick = () => move(-1);
  const next = el('button', null, '›'); next.setAttribute('aria-label', '다음');
  next.onclick = () => move(1);
  const mid = el('span', 'mid');
  if (state.view === 'week') {
    const mon = mondayOf(state.cursor);
    mid.textContent = `${mon.getMonth() + 1}/${mon.getDate()} – ${addDays(mon, 4).getMonth() + 1}/${addDays(mon, 4).getDate()}`;
  } else if (state.view === 'month') {
    mid.textContent = `${state.cursor.getFullYear()}년 ${state.cursor.getMonth() + 1}월`;
  } else mid.textContent = fmtDate(state.cursor);
  nav.append(prev, mid, next);
  box.appendChild(nav);

  const rot = changesOn(state.cursor).find((chg) => chg.kind === 'dayswap');
  if (rot) {
    const note = el('div', 'rotate');
    const asDay = rot.toDate ? `${DAYS[dayIndex(parse(rot.toDate))] ?? ''}요일` : '다른 날';
    note.innerHTML = `오늘은 <b>${asDay} 시간표</b>로 운영합니다`;
    box.appendChild(note);
  }
  return box;
}

function move(step) {
  if (state.view === 'week') state.cursor = addDays(mondayOf(state.cursor), step * 7);
  else if (state.view === 'month') {
    const next = new Date(state.cursor);
    next.setDate(1); next.setMonth(next.getMonth() + step);
    state.cursor = next;
  } else {
    let next = addDays(state.cursor, step);
    while (!isWeekday(next)) next = addDays(next, step); // 주말은 건너뛴다
    state.cursor = next;
  }
  render();
}

/* ── 오늘 ── */
function todayPanel() {
  const panel = el('div', 'panel');
  panel.appendChild(el('h2', null, '오늘'));
  const day = el('div', 'day');
  const periods = state.school.periods || [];
  const meals = state.school.mealTimes || {};
  const lessons = lessonsOn(state.cursor);
  const chgs = changesOn(state.cursor);
  const now = new Date();
  const isToday = sameDay(state.cursor, now);

  const addMeal = (label, time, kind) => {
    if (!time) return;
    const slot = el('div', 'slot meal');
    const gut = el('span', 'gut');
    gut.append(el('span', 'p', label), el('span', 't', time));
    const cell = el('div', 'cell');
    cell.appendChild(el('div', 'name', label));
    const menu = state.meals && state.meals.days && state.meals.days[iso(state.cursor)];
    const text = menu && menu[kind];
    cell.appendChild(el('p', text ? 'menu' : 'menu none',
      text || (state.meals ? '등록된 식단이 없습니다' : '급식은 아직 준비 중입니다')));
    slot.append(gut, el('span', 'dot'), cell);
    day.appendChild(slot);
  };

  addMeal('조식', meals.breakfast, 'breakfast');

  for (const period of periods) {
    if (period.startTime >= (meals.lunch || '99:99') && !day.dataset.lunch) {
      addMeal('중식', meals.lunch, 'lunch');
      day.dataset.lunch = '1';
    }
    const lesson = lessons.get(period.period);
    const chg = chgs.find((item) => item.period === period.period && item.kind !== 'dayswap');
    const slot = el('div', 'slot');
    const gut = el('span', 'gut');
    gut.append(el('span', 'p', `${period.period}교시`), el('span', 't', period.startTime));
    const cell = el('div', 'cell');

    if (!lesson) {
      slot.classList.add('free');
      cell.appendChild(el('div', 'name', '공강'));
    } else if (lesson.kind === 'unpicked') {
      cell.appendChild(el('div', 'name', '이동수업'));
      cell.appendChild(el('div', 'by', '어떤 강좌를 듣는지 골라 주세요'));
      const wrap = el('div', 'pick');
      const btn = el('button', null, '고르기');
      btn.onclick = () => openPicker(lesson.band);
      wrap.appendChild(btn);
      cell.appendChild(wrap);
    } else {
      cell.appendChild(el('div', 'name',
        chg ? (chg.newSubject || chg.origSubject || lesson.subject) : lesson.subject));
      const who = chg
        ? `${chg.newTeacher ?? ''} ${chg.kind === 'substitute' ? '보강' : '교체'}`.trim()
        : (lesson.teacher || '');
      if (who) cell.appendChild(el('div', 'by', who));
      if (chg && chg.origTeacher) cell.appendChild(el('span', 'was', chg.origTeacher));
    }
    if (chg) slot.classList.add('chg');
    if (isToday && !chg && lesson && now.toTimeString().slice(0, 5) >= period.startTime
        && now.toTimeString().slice(0, 5) < period.endTime) {
      slot.classList.add('now');
    }
    slot.append(gut, el('span', 'dot'), cell);
    day.appendChild(slot);
  }
  if (!day.dataset.lunch) addMeal('중식', meals.lunch, 'lunch');
  addMeal('석식', meals.dinner, 'dinner');
  panel.appendChild(day);
  return panel;
}

/* ── 주 ── */
function weekPanel() {
  const panel = el('div', 'panel');
  const mon = mondayOf(state.cursor);
  panel.appendChild(el('h2', null,
    `이번 주 · ${mon.getMonth() + 1}/${mon.getDate()} – ${addDays(mon, 4).getMonth() + 1}/${addDays(mon, 4).getDate()}`));

  const table = el('table', 'wk');
  const head = el('tr');
  head.appendChild(el('th', 'pn'));
  for (let i = 0; i < 5; i += 1) {
    const date = addDays(mon, i);
    const th = el('th', sameDay(date, new Date()) ? 'today' : null, DAYS[i]);
    th.appendChild(el('small', null, `${date.getMonth() + 1}/${date.getDate()}`));
    head.appendChild(th);
  }
  table.appendChild(head);

  const periods = state.school.periods || [];
  const meals = state.school.mealTimes || {};
  const byDay = [0, 1, 2, 3, 4].map((i) => ({
    lessons: lessonsOn(addDays(mon, i)), changes: changesOn(addDays(mon, i)),
  }));
  let lunchDone = false;

  for (const period of periods) {
    if (!lunchDone && period.startTime >= (meals.lunch || '99:99')) {
      const row = el('tr', 'mealrow');
      row.appendChild(el('td', 'pn', '중식'));
      const td = el('td', null, `${meals.lunch} · 급식은 «오늘»에서 봅니다`);
      td.colSpan = 5; row.appendChild(td); table.appendChild(row);
      lunchDone = true;
    }
    const row = el('tr');
    const pn = el('td', 'pn', String(period.period));
    pn.appendChild(el('em', null, period.startTime));
    row.appendChild(pn);
    for (let i = 0; i < 5; i += 1) {
      const lesson = byDay[i].lessons.get(period.period);
      const chg = byDay[i].changes.find(
        (item) => item.period === period.period && item.kind !== 'dayswap');
      const td = el('td');
      if (!lesson) { td.className = 'e'; row.appendChild(td); continue; }
      if (chg) td.className = 'c';
      td.append(lesson.kind === 'unpicked'
        ? '이동수업'
        : (chg && (chg.newSubject || chg.origSubject)) || lesson.subject);
      const who = chg
        ? `${chg.newTeacher ?? ''} ${chg.kind === 'substitute' ? '보강' : '교체'}`.trim()
        : lesson.teacher;
      if (who) td.appendChild(el('small', null, who));
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  panel.appendChild(table);

  const week = [0, 1, 2, 3, 4].flatMap((i) =>
    changesOn(addDays(mon, i)).filter((c) => c.kind !== 'dayswap')
      .map((c) => ({ ...c, dayIdx: i })));
  const side = el('div', 'side');
  side.appendChild(el('h3', null, '이번 주 바뀐 수업'));
  if (!state.changes) side.appendChild(el('p', 'none', '수업 변경은 아직 준비 중입니다'));
  else if (week.length === 0) side.appendChild(el('p', 'none', '바뀐 수업이 없습니다'));
  else for (const c of week) {
    const row = el('div', 'r');
    row.appendChild(el('b', null, `${DAYS[c.dayIdx]} ${c.period}교시`));
    row.appendChild(el('span', null,
      `${c.origSubject || ''} · ${c.origTeacher ? `${c.origTeacher} → ` : ''}`
      + `${c.newTeacher ?? ''} ${c.kind === 'substitute' ? '보강' : '교체'}`.trim()));
    side.appendChild(row);
  }
  panel.appendChild(side);
  panel.appendChild(calendarSide());
  return panel;
}

/* ── 월 ── */
function monthPanel() {
  const panel = el('div', 'panel');
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  panel.appendChild(el('h2', null, `${first.getFullYear()}년 ${first.getMonth() + 1}월`));
  const table = el('table', 'mo');
  const head = el('tr');
  ['일', '월', '화', '수', '목', '금', '토'].forEach((label, i) => {
    head.appendChild(el('th', i === 0 ? 'sun' : null, label));
  });
  table.appendChild(head);

  const start = addDays(first, -first.getDay());
  const events = (state.calendar && state.calendar.events) || [];
  for (let week = 0; week < 6; week += 1) {
    const row = el('tr');
    let any = false;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, week * 7 + i);
      const td = el('td');
      const outside = date.getMonth() !== first.getMonth();
      if (outside) td.classList.add('out');
      else { any = true; if (!isWeekday(date)) td.classList.add('off'); }
      if (sameDay(date, new Date())) td.classList.add('today');
      td.appendChild(el('span', 'd', String(date.getDate())));
      if (!outside) {
        const ev = events.find((item) => item.date === iso(date));
        if (ev) td.appendChild(el('span', 'tag', ev.title));
        if (changesOn(date).some((c) => c.kind !== 'dayswap')) {
          const dots = el('span', 'dots'); dots.appendChild(el('i')); td.appendChild(dots);
        }
        td.onclick = () => { state.cursor = date; state.view = 'day'; render(); };
      }
      row.appendChild(td);
    }
    if (any) table.appendChild(row);
  }
  panel.appendChild(table);
  panel.appendChild(calendarSide());
  return panel;
}

function calendarSide() {
  const side = el('div', 'side');
  side.appendChild(el('h3', null, '다가오는 일정'));
  const events = (state.calendar && state.calendar.events) || [];
  const soon = events.filter((ev) => ev.date >= iso(new Date())).slice(0, 4);
  if (!state.calendar) side.appendChild(el('p', 'none', '학사일정은 아직 준비 중입니다'));
  else if (soon.length === 0) side.appendChild(el('p', 'none', '등록된 일정이 없습니다'));
  else for (const ev of soon) {
    const date = parse(ev.date);
    const row = el('div', 'r cal');
    row.appendChild(el('b', null, `${date.getMonth() + 1}/${date.getDate()}`));
    row.appendChild(el('span', null, ev.title));
    side.appendChild(row);
  }
  return side;
}

/* ── 처음 설정: 내 반 ── */
function setupClass() {
  const box = el('div', 'setup');
  box.appendChild(el('h1', null, '어느 반인가요?'));
  box.appendChild(el('p', null, '한 번만 고르면 됩니다. 이 기기에만 저장되고 어디로도 보내지 않습니다.'));
  const ids = [...new Set(state.classes.map((cell) => cell.classId))].sort((a, b) => {
    const [ga, ca] = a.split('-').map(Number); const [gb, cb] = b.split('-').map(Number);
    return ga - gb || ca - cb;
  });
  const grid = el('div', 'grid-pick');
  for (const id of ids) {
    const btn = el('button', null, id);
    btn.onclick = () => { state.me = { classId: id, sections: {} }; save(); render(); };
    grid.appendChild(btn);
  }
  box.appendChild(grid);
  return box;
}

/* ── 강좌 고르기 ── */
function openPicker(band) {
  const list = bandsOfMyClass().get(band) || [];
  const uniq = new Map();
  for (const sec of list) if (!uniq.has(sectionKey(sec))) uniq.set(sectionKey(sec), sec);

  const app = document.getElementById('app');
  app.innerHTML = '';
  const box = el('div', 'setup');
  box.appendChild(el('h1', null, '어떤 강좌를 듣나요?'));
  box.appendChild(el('p', null, '이동수업은 학생마다 다릅니다. 한 번 고르면 계속 기억합니다.'));
  const opts = el('div', 'opts');
  for (const [key, sec] of uniq) {
    const btn = el('button', state.me.sections[band] === key ? 'on' : null);
    btn.append(sec.subject);
    btn.appendChild(el('small', null,
      `${sec.teacher || '담당 미정'}${sec.room ? ` · ${sec.room}` : ''}`
      + ` · ${DAYS[sec.day]}${sec.period}교시`));
    btn.onclick = () => { state.me.sections[band] = key; save(); render(); };
    opts.appendChild(btn);
  }
  box.appendChild(opts);
  const back = el('button', 'back', '나중에 고르기');
  back.onclick = () => render();
  box.appendChild(back);
  app.appendChild(box);
}

function footer() {
  const foot = el('div', 'foot');
  foot.appendChild(el('span', null, `${state.school.name || '학교'} · ${state.classes.length}칸`));
  const reset = el('button', null, '내 반·강좌 다시 고르기');
  reset.onclick = () => { localStorage.removeItem(KEY); state.me = null; render(); };
  foot.appendChild(reset);
  return foot;
}

boot();
