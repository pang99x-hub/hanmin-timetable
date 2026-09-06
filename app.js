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
 *
 * 딱 한 번, 처음 열 때만 바깥에 묻는다 — 구글 로그인으로 «나는 누구»를 확인하고
 * 내 반과 내 강좌 번호를 받아 온다(앱스스크립트 창구). 정적 파일에는 누가 무엇을
 * 듣는지가 없다. 없어야 한다 — 주소만 알면 누구나 받는 파일이기 때문이다.
 * 받은 뒤에는 기기에 저장하고 다시 묻지 않는다. 아침에 900명이 몰려도 창구는 조용하다.
 */
'use strict';

const DAYS = ['월', '화', '수', '목', '금'];
const KEY = 'hanmin.timetable.me.v1';
const DATA = 'data/';

/* 창구와 구글 로그인. 학교가 바뀌면 이 두 줄만 고친다. */
const DESK = 'https://script.google.com/macros/s/AKfycbxrSNLXhSMh7MvzV860ebOhVCJY1Pe0mSUSfnvFpXFZL4CE9SFCqFu9myJS19u9FWHr/exec';
const CLIENT_ID = '817402337132-buq4v80hslbv80d2ajteaj8h5664hod2.apps.googleusercontent.com';

const state = {
  school: null, classes: [], sections: [],
  changes: null, meals: null, calendar: null,
  me: null,          // { classId, sections: {bandKey: sectionKey} }
  openMeals: new Set(),   // 펼쳐 둔 식사(breakfast·lunch·dinner). 기기에만 남는다.
  /*
   * 교사로 로그인했을 때만 채워진다 — 학생 화면이 어떻게 보이는지 확인해야 하는
   * 일이 있는데(문의 대응·점검), 학생 계정을 빌릴 수는 없다.
   * 이 세 가지는 기기에 저장하지 않는다. 창을 닫으면 사라진다.
   */
  teacher: null,          // { credential, roster: [{classId, no, name}] }
  viewing: null,          // 지금 보고 있는 학생 { classId, no, name }
  pickClass: null,        // 교사 화면에서 고른 학급
  busy: false,       // 창구에 묻는 중
  gateError: null,
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

/**
 * 이 기기의 «내 시간표»를 저장한다.
 *
 * 교사가 학생 화면을 보는 중에는 저장하지 않는다. 그때 state.me 는 남의 것이라,
 * 저장하면 학생 이름·반·수강 강좌가 교사 기기에 남는다. 화면에 잠깐 보여 주는 것과
 * 기기에 남기는 것은 다른 일이다 — 보는 것은 업무지만 남기는 것은 유출이다.
 * 실제로 새는 자리가 있었다: 보는 중에 이동수업 반 단추를 누르면 여기까지 왔다.
 */
const save = () => {
  if (state.viewing) return;
  localStorage.setItem(KEY, JSON.stringify(state.me));
};

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

/*
 * 그날 실제로 도는 요일.
 *
 * 요일 교환(dayswap)이 걸리면 «화요일에 목요일 시간표»가 돈다. 학교 전체가 함께 겪으므로
 * 반을 가리지 않는다. 이것을 안 보면 그날 시간표가 통째로 틀린 채로 그려진다 — 한 칸이
 * 틀린 것보다 나쁘다.
 */
function effectiveDay(date) {
  const key = iso(date);
  const list = (state.changes && state.changes.changes) || [];
  for (const chg of list) {
    if (chg.kind !== 'dayswap' && chg.kind !== 'daycopy') continue;
    if (chg.date === key && chg.otherDate) return dayIndex(parse(chg.otherDate));
    // 교환은 양방향이다. 복사(daycopy)는 원본 날짜를 건드리지 않는다.
    if (chg.kind === 'dayswap' && chg.otherDate === key && chg.date) return dayIndex(parse(chg.date));
  }
  return dayIndex(date);
}

/** 그 슬롯에 같은 이름의 강좌가 몇 개나 열리나(내 학급이 속한 밴드들 안에서). */
function twinCount(bands, day, period, subject) {
  let count = 0;
  for (const list of bands.values()) {
    for (const sec of list) {
      if (sec.day === day && sec.period === period && sec.subject === subject) count += 1;
    }
  }
  return count;
}

function lessonsOn(date) {
  const day = effectiveDay(date);
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
            // 합반이면 여러 반이 함께 듣는다. 변경이 어느 반에 기록됐든 내 수업이다.
            classIds: sec.classIds || [],
            /*
             * 같은 시간 내 밴드들에 같은 이름의 강좌가 몇인가. 둘 이상이면(분담 운영)
             * 과목명으로 안 갈려 교사를 봐야 한다. 하나뿐이면 교사를 보지 않는다 —
             * 원장과 변경 기록이 교사명을 다르게 적었을 때 멀쩡한 보강을 떨어뜨린다.
             */
            twins: twinCount(bands, day, sec.period, sec.subject),
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

/*
 * 「이 변경이 내 칸의 것인가」.
 *
 * 반과 교시만으로는 칸이 하나로 좁혀지지 않는다. 교사웹에서 같은 자리로 사고가 여러 번
 * 났고(밴드 칸은 반·교시로 특정되지 않는다), 학생 화면에서는 셋으로 나타난다.
 *
 *   합반  — 3-1 과 3-3 이 함께 듣는 「고전과 윤리」의 보강은 3-1 에만 기록된다.
 *          내 반만 보면 3-3 학생은 영영 못 받는다. 그 강좌의 어느 반에 적혔든 내 수업이다.
 *   분반  — 3-1 의 5교시에는 「고전과 윤리」와 「세계 문제와 미래 사회」가 함께 걸려 있다.
 *          원래 과목까지 같아야 한다.
 *   동명  — 같은 시간 같은 밴드에 「과학창의연구」가 둘이다(분담 운영). 과목명으로는
 *          안 갈리므로 교사로 가른다. 공동수업은 원장이 「박가영·Akhona」처럼 병기하고
 *          변경 기록은 한 사람만 적으므로, 한쪽이 다른 쪽을 품으면 같은 사람으로 본다.
 */
function sameTeacher(left, right) {
  if (!left || !right) return true;          // 한쪽을 모르면 가르지 않는다
  return left === right || left.includes(right) || right.includes(left);
}

function ownsCell(chg, lesson) {
  if (!lesson || lesson.kind === 'unpicked') return false;
  if (lesson.kind === 'section') {
    if (!(lesson.classIds || []).includes(chg.classId)) return false;
    if (chg.origSubject && chg.origSubject !== lesson.subject) return false;
    if ((lesson.twins ?? 1) <= 1) return true;      // 갈릴 것이 없으면 교사를 안 본다
    return sameTeacher(chg.origTeacher, lesson.teacher);
  }
  if (chg.classId !== state.me.classId) return false;
  /*
   * 학급 칸에서는 교사를 대보지 않는다. 그 시간에 그 반이 듣는 수업은 하나뿐이라
   * 과목이면 충분하고, 병기된 교사명 때문에 멀쩡한 보강을 떨어뜨릴 이유가 없다.
   */
  return !chg.origSubject || !lesson.subject || chg.origSubject === lesson.subject;
}

/*
 * 한 칸에 걸린 변경 — 여럿이면 합친다.
 *
 * 교체로 들어온 수업에 다시 보강이 걸리는 일이 있다(2026-09-03 2-11 7교시: 교체로
 * 「확률과 통계」가 들어오고 그 수업에 보강이 붙었다). 하나만 집으면 나머지가 조용히
 * 사라진다 — 교사웹에서도 같은 사고가 있었다. 교체는 «무슨 수업인지»를, 보강은
 * «누가 들어오는지»를 바꾸므로 둘을 겹쳐 읽는다.
 */
function changeForCell(list, period, lesson) {
  const here = list.filter((chg) => chg.period === period && ownsCell(chg, lesson));
  /*
   * 교체로 **들어온** 수업에 다시 붙은 변경은 원래 과목과 안 맞는다. 2026-09-03 2-11
   * 7교시가 그랬다 — 교체로 「확률과 통계」가 들어오고 그 수업에 보강이 붙었는데,
   * 칸의 원래 과목은 「영어Ⅱ」라 보강이 걸러져 사라졌다. 들어온 과목으로 한 번 더 본다.
   */
  const incoming = here.map((chg) => chg.newSubject).filter(Boolean);
  const extra = incoming.length
    ? list.filter((chg) => chg.period === period && !here.includes(chg)
        && incoming.includes(chg.origSubject)
        && ownsCell(chg, { ...lesson, subject: chg.origSubject }))
    : [];
  const found = [...here, ...extra];
  if (!found.length) return null;
  const cancel = found.find((chg) => chg.kind === 'cancel');
  if (cancel) return { kind: 'cancel', subject: null, teacher: null, note: '수업 없음', stack: found };
  const swap = found.find((chg) => chg.kind === 'swap');
  const substitute = found.find((chg) => chg.kind === 'substitute');
  const base = swap ?? substitute ?? found[0];
  return {
    kind: substitute ? 'substitute' : base.kind,
    subject: (swap && (swap.newSubject || swap.origSubject)) || lesson.subject,
    teacher: (substitute && substitute.newTeacher) || (swap && swap.newTeacher) || null,
    origTeacher: base.origTeacher ?? null,
    note: [swap ? '교체' : null, substitute ? '보강' : null].filter(Boolean).join(' · ') || '변경',
    fromDate: base.fromDate ?? null,
    stack: found,
  };
}

/*
 * 그 날의 학사일정 하나.
 *
 * 나이스는 학년별로 대상을 표시한다(1·2·3). 학년이 비어 있으면 전교 대상이다 —
 * 「3학년 수능 응시」를 1학년 달력에 띄우지 않으려고 걸러 준다.
 */
function myGrade() {
  const found = /^(\d)/.exec(state.me && state.me.classId ? state.me.classId : '');
  return found ? Number(found[1]) : null;
}

function calendarOn(date) {
  const days = (state.calendar && state.calendar.days) || [];
  const key = iso(date);
  const grade = myGrade();
  const found = days.find((day) => day.date === key);
  if (!found) return null;
  if (grade && found.grades && found.grades.length && !found.grades.includes(grade)) return null;
  return found;
}

/* 그 날 그 반에 걸린 변경. changes.json 이 없으면 빈 목록이다. */
function changesOn(date) {
  if (!state.changes || !state.changes.changes) return [];
  const key = iso(date);
  return state.changes.changes.filter(
    (chg) => chg.date === key,
  );
}

/* 그 날 내 칸에 실제로 걸린 변경 수. 달력의 점이 이것을 센다. */
function myChangeCount(date) {
  if (!state.changes) return 0;
  const list = changesOn(date);
  const lessons = lessonsOn(date);
  const seen = new Set();
  for (const [period, lesson] of lessons) {
    const chg = changeForCell(list, period, lesson);
    if (chg) for (const item of chg.stack) seen.add(item);
  }
  return seen.size;
}

/* ── 그리기 ── */
function render() {
  const app = document.getElementById('app');
  if (state.teacher && !state.me) {
    app.innerHTML = '';
    app.appendChild(teacherPicker());
    return;
  }
  if (!state.me || !state.me.classId) {
    app.innerHTML = '';
    app.appendChild(loginGate());
    return;
  }
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
  if (state.viewing) {
    /*
     * 교사가 남의 화면을 보는 중이라는 것을 늘 보이게 둔다. 자기 화면으로 착각한 채
     * 「내 시간표가 이상하다」고 말하는 일이 생긴다.
     */
    const tag = el('span', 'asstudent',
      `${state.viewing.classId} ${state.viewing.no}번 ${state.viewing.name} 화면`);
    right.appendChild(tag);
    const back = el('button', 'me', '다른 학생');
    back.onclick = () => { state.me = null; state.viewing = null; render(); };
    right.appendChild(back);
  } else {
    // 반은 창구가 정해 준 것이라 사람이 고칠 자리가 아니다. 표시만 한다.
    right.appendChild(el('span', 'me', state.me.classId));
  }
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

  /*
   * 식사는 접어 둔다.
   *
   * 하루 세 끼의 메뉴를 다 펼쳐 두면 그것만 스무 줄이 넘어, 정작 «몇 교시에 무슨
   * 수업»이 화면 밖으로 밀린다. 시간표를 보러 온 화면이다. 메뉴는 궁금할 때 편다.
   *
   * 편 상태는 기억한다 — 아침에 한 번 펴 놓고 날짜를 넘길 때마다 다시 접히면
   * 성가시다. 기기에만 남는다(state).
   */
  const addMeal = (label, time, kind) => {
    if (!time) return;
    const menu = state.meals && state.meals.days && state.meals.days[iso(state.cursor)];
    const items = menu && menu[kind];
    const lines = Array.isArray(items) ? items
      : typeof items === 'string' && items ? [items] : [];
    const open = state.openMeals.has(kind);

    const slot = el('div', `slot meal${open ? ' open' : ''}`);
    const gut = el('span', 'gut');
    gut.append(el('span', 'p', label), el('span', 't', time));

    const cell = el('div', 'cell');
    const head = el('button', 'mealhead');
    head.setAttribute('aria-expanded', String(open));
    head.append(el('span', 'name', label));
    // 접혀 있어도 무엇이 나오는지 한 줄은 보여 준다 — 열어 볼지 판단할 거리가 된다.
    head.appendChild(el('span', 'peek', lines.length
      ? (open ? '' : lines.slice(0, 2).join(' · '))
      : (state.meals ? '등록된 식단이 없습니다' : '급식은 아직 준비 중입니다')));
    if (lines.length) head.appendChild(el('span', 'chev', open ? '−' : '+'));
    head.onclick = () => {
      if (!lines.length) return;
      if (open) state.openMeals.delete(kind); else state.openMeals.add(kind);
      render();
    };
    cell.appendChild(head);

    if (open && lines.length) {
      const list = el('ul', 'menu');
      for (const item of lines) list.appendChild(el('li', null, item));
      cell.appendChild(list);
    }
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
    const chg = changeForCell(chgs, period.period, lesson);
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
        chg ? (chg.subject || lesson.subject) : lesson.subject));
      const who = chg
        ? `${chg.teacher ?? ''} ${chg.note}`.trim()
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
  /*
   * 주간표에 급식 줄을 두지 않는다. 여기서 보는 것은 «이번 주 수업이 어떻게 흐르는가»
   * 이고, 매일 같은 시각인 급식은 그 흐름을 끊기만 한다. 메뉴는 «오늘»에서 본다.
   */
  const byDay = [0, 1, 2, 3, 4].map((i) => ({
    lessons: lessonsOn(addDays(mon, i)), changes: changesOn(addDays(mon, i)),
  }));

  for (const period of periods) {
    const row = el('tr');
    const pn = el('td', 'pn', String(period.period));
    pn.appendChild(el('em', null, period.startTime));
    row.appendChild(pn);
    for (let i = 0; i < 5; i += 1) {
      const lesson = byDay[i].lessons.get(period.period);
      const chg = changeForCell(byDay[i].changes, period.period, lesson);
      const td = el('td');
      if (!lesson) { td.className = 'e'; row.appendChild(td); continue; }
      if (chg) td.className = 'c';
      td.append(lesson.kind === 'unpicked'
        ? '이동수업'
        : (chg && chg.subject) || lesson.subject);
      const who = chg
        ? `${chg.teacher ?? ''} ${chg.note}`.trim()
        : lesson.teacher;
      if (who) td.appendChild(el('small', null, who));
      row.appendChild(td);
    }
    table.appendChild(row);
  }
  panel.appendChild(table);

  /*
   * 「이번 주 바뀐 수업」도 내 칸에 걸린 것만 싣는다. 그 날의 변경을 통째로 나열하면
   * 옆 강좌를 듣는 학생에게 「고전과 윤리 보강」이 뜬다 — 표는 맞게 그려 놓고 목록에서
   * 새는 식이라 눈에 잘 안 띈다.
   */
  const week = [0, 1, 2, 3, 4].flatMap((i) => {
    const seen = new Set();
    const out = [];
    for (const period of periods) {
      const chg = changeForCell(byDay[i].changes, period.period, byDay[i].lessons.get(period.period));
      if (!chg || seen.has(chg)) continue;
      seen.add(chg);
      out.push({ ...chg, dayIdx: i });
    }
    return out;
  });
  const side = el('div', 'side');
  side.appendChild(el('h3', null, '이번 주 바뀐 수업'));
  if (!state.changes) side.appendChild(el('p', 'none', '수업 변경은 아직 준비 중입니다'));
  else if (week.length === 0) side.appendChild(el('p', 'none', '바뀐 수업이 없습니다'));
  else for (const c of week) {
    const row = el('div', 'r');
    row.appendChild(el('b', null, `${DAYS[c.dayIdx]} ${c.period}교시`));
    row.appendChild(el('span', null,
      `${c.subject || ''} · ${c.origTeacher ? `${c.origTeacher} → ` : ''}`
      + `${c.teacher ?? ''} ${c.note}`.trim()));
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
        const ev = calendarOn(date);
        if (ev) {
          if (ev.kind === 'holiday') td.classList.add('off');
          td.appendChild(el('span', `tag ${ev.kind}`, ev.labels[0] || ''));
        }
        if (myChangeCount(date) > 0) {
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
  const today = iso(new Date());
  const grade = myGrade();
  const soon = ((state.calendar && state.calendar.days) || [])
    .filter((day) => day.date >= today)
    .filter((day) => !grade || !day.grades || !day.grades.length || day.grades.includes(grade))
    .slice(0, 5);
  if (!state.calendar) side.appendChild(el('p', 'none', '학사일정은 아직 준비 중입니다'));
  else if (soon.length === 0) side.appendChild(el('p', 'none', '등록된 일정이 없습니다'));
  else for (const day of soon) {
    const date = parse(day.date);
    const row = el('div', `r cal ${day.kind}`);
    row.appendChild(el('b', null, `${date.getMonth() + 1}/${date.getDate()}`));
    row.appendChild(el('span', null, day.labels.join(' · ')));
    side.appendChild(row);
  }
  return side;
}

/* ── 로그인 ───────────────────────────────────────────────────────────
 * 구글 로그인으로 «나는 누구»만 확인하고, 창구에서 내 반과 강좌 번호를 받는다.
 * 이 화면을 지나면 다시 볼 일이 없다.
 */
function loadGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve(true);
  if (loadGoogle.pending) return loadGoogle.pending;
  loadGoogle.pending = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://accounts.google.com/gsi/client';
    tag.async = true;
    tag.onload = () => resolve(true);
    tag.onerror = () => resolve(false);   // 학교 망이 막아 둔 경우 — 직접 고르기로 간다
    document.head.appendChild(tag);
  });
  return loadGoogle.pending;
}

/*
 * 창구에 묻기.
 *
 * Content-Type 을 text/plain 으로 보내는 것은 실수가 아니다. application/json 이면
 * 브라우저가 먼저 OPTIONS 를 보내는데(preflight) 앱스스크립트는 그것을 받지 못해
 * 요청 자체가 실패한다. text/plain 은 preflight 없이 바로 간다.
 */
async function askDesk(credential) {
  const res = await fetch(DESK, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'mySections', credential }),
  });
  if (!res.ok) throw new Error('창구에 닿지 못했습니다.');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '확인하지 못했습니다.');
  return data;
}

/*
 * 받은 강좌 번호를 화면이 쓰는 모양(밴드 → 강좌)으로 옮긴다.
 * 자료에 없는 번호는 조용히 버린다 — 시간표에 안 잡힌 강좌(방과후 등)일 수 있고,
 * 남겨 두면 «고르기»가 영영 안 사라진다.
 */
function adoptSections(ids) {
  const wanted = new Set((ids || []).map(String));
  const out = {};
  for (const sec of state.sections) {
    if (!wanted.has(String(sec.sectionId))) continue;
    out[sec.bandKey || sec.subject] = sectionKey(sec);
  }
  return out;
}

function loginGate() {
  const box = el('div', 'setup');
  box.appendChild(el('h1', null, '내 시간표'));
  box.appendChild(el('p', null,
    '학교 구글 계정으로 로그인하세요. 내 반과 이동수업이 한 번에 채워집니다.'));

  const slot = el('div', 'gsi');
  box.appendChild(slot);

  if (state.busy) {
    slot.appendChild(el('div', 'waiting', '시간표를 찾는 중입니다…'));
  } else {
    loadGoogle().then((ready) => {
      if (!ready) {
        slot.innerHTML = '';
        /*
         * 구글 스크립트를 못 받아 왔다 — 학교 망이 막았거나 잠깐 끊긴 것이다.
         * 우회로를 주지 않는다. 대신 무엇이 막혔고 어떻게 하면 되는지 말한다.
         * 막다른 길에 아무 말 없이 세워 두는 것이 가장 나쁘다.
         */
        slot.appendChild(el('div', 'waiting',
          '로그인 창을 열지 못했습니다. 잠시 뒤 새로고침해 주세요.'));
        slot.appendChild(el('div', 'hint',
          '학교 와이파이에서 계속 안 되면 담임 선생님께 알려 주세요.'));
        return;
      }
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: onCredential,
        auto_select: true,          // 이미 학교 계정으로 로그인해 있으면 그냥 통과시킨다
      });
      slot.innerHTML = '';
      google.accounts.id.renderButton(slot, {
        theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline',
        size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 260,
      });
      // 이미 학교 계정으로 로그인해 있으면 누를 것도 없이 지나가게 한다.
      google.accounts.id.prompt();
    });
  }

  if (state.gateError) box.appendChild(el('div', 'gate-err', state.gateError));

  /*
   * «로그인 없이 반 고르기»를 두지 않는다.
   *
   * 그 길로 들어오면 이동수업 칸이 «고르기»로 남아 학생이 자기 시간표를 손으로
   * 맞춰야 한다 — 틀리게 맞춰 놓고도 맞다고 믿게 된다. 로그인하면 그 자리가
   * 저절로 채워진다. 손쉬운 우회로가 있으면 사람은 그쪽으로 간다.
   */
  return box;
}

/* ── 교사: 학생 골라 보기 ─────────────────────────────────────────────
 * 학생 화면이 어떻게 보이는지 확인해야 할 때가 있다(문의 대응·점검). 학생 계정을
 * 빌릴 수는 없으니, 교사 계정으로 들어와 학급·번호로 고른다.
 *
 * 고르는 목록에는 이메일도 강좌도 없다 — 학급·번호·이름뿐이다. 시간표는 고른 뒤에
 * 그 학생 것만 따로 받아 온다. 나가는 개인정보는 적을수록 좋다.
 */
async function openStudent(target) {
  state.busy = true; state.gateError = null; render();
  try {
    const res = await fetch(DESK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'studentView',
        credential: state.teacher.credential,
        classId: target.classId,
        no: target.no,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '가져오지 못했습니다.');
    if (!data.found) throw new Error('그 학생을 찾지 못했습니다.');
    state.viewing = { classId: data.classId, no: data.no, name: data.name };
    state.me = { classId: data.classId, sections: adoptSections(data.sections) };
    // 교사가 보는 것은 저장하지 않는다 — 이 기기의 «내 시간표»가 아니다.
  } catch (error) {
    state.gateError = String(error.message || error);
  } finally {
    state.busy = false;
    render();
  }
}

function teacherPicker() {
  const box = el('div', 'setup wide');
  box.appendChild(el('h1', null, '학생 시간표 보기'));
  box.appendChild(el('p', null, '학급을 고르고 학생을 고르면 그 학생이 보는 화면이 그대로 나옵니다.'));

  if (state.busy) {
    box.appendChild(el('div', 'waiting', '가져오는 중입니다…'));
    return box;
  }
  if (state.gateError) box.appendChild(el('div', 'gate-err', state.gateError));

  const roster = state.teacher.roster;
  const classes = [...new Set(roster.map((r) => r.classId))];
  const grid = el('div', 'pick-grid');
  for (const id of classes) {
    const btn = el('button', state.pickClass === id ? 'on' : null, id);
    btn.onclick = () => { state.pickClass = state.pickClass === id ? null : id; render(); };
    grid.appendChild(btn);
  }
  box.appendChild(grid);

  if (state.pickClass) {
    const list = el('div', 'pick-grid names');
    for (const r of roster.filter((x) => x.classId === state.pickClass)) {
      const btn = el('button', null, `${r.no}. ${r.name || '(이름 없음)'}`);
      btn.onclick = () => openStudent(r);
      list.appendChild(btn);
    }
    box.appendChild(list);
  }

  const out = el('button', 'back', '로그아웃');
  out.onclick = () => {
    state.teacher = null; state.viewing = null; state.pickClass = null;
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    render();
  };
  box.appendChild(out);
  return box;
}

async function onCredential(response) {
  state.busy = true; state.gateError = null; render();
  try {
    const found = await askDesk(response.credential);
    if (found.role === 'teacher') {
      // 교사는 자기 시간표가 없다. 누구를 볼지 고르는 화면으로 간다.
      state.teacher = { credential: response.credential, roster: found.roster || [] };
      state.me = null;
      return;
    }
    if (!found.found || !found.classId) {
      /*
       * 로그인은 됐는데 명단에 없다 — 전학 온 지 얼마 안 됐거나 아직 반 배정 전이다.
       * 스스로 고르게 하지 않는다(틀린 시간표를 만들어 놓고 믿게 된다). 누구에게
       * 말해야 하는지 알려 준다. 명단은 학교가 채우는 것이지 학생이 채울 것이 아니다.
       */
      state.gateError = '명단에서 찾지 못했습니다. 담임 선생님께 알려 주시면 등록해 드립니다.';
    } else {
      state.me = { classId: found.classId, sections: adoptSections(found.sections) };
      save();
    }
  } catch (error) {
    state.gateError = String(error.message || error);
  } finally {
    state.busy = false;
    render();
  }
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
  const reset = el('button', null, '다른 계정으로 로그인');
  reset.onclick = () => {
    localStorage.removeItem(KEY);
    state.me = null; state.gateError = null;
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
    render();
  };
  foot.appendChild(reset);
  return foot;
}

boot();
