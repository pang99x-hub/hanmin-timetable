const AX_EXTERNAL = new URLSearchParams(location.search).get('axExternal')==='1' && !!window.opener;
const AX_EMBEDDED = new URLSearchParams(location.search).get('axEmbed')==='1' && window.parent!==window;
/*
 * 한민고 학생 시간표.
 *
 * 자료는 전부 이 사이트의 정적 파일에서 온다 — 서버에 묻지 않는다.
 *   school.json    교시 시각·식사 시각 (교사웹 일과표에서 옴)
 *   classes.json   반별 시간표
 *   sections.json  강좌별 시간표 (명단 없이 시간만)
 *   changes.json   수업 변경
 *   meals.json     급식
 *   calendar.json  학사일정
 *
 * 없는 파일은 없는 대로 그린다. 「아직 안 올라온 것」과 「오늘은 없는 것」을 화면이
 * 구분해 말한다 — 빈칸만 두면 학생은 고장으로 읽는다.
 *
 * 내 반과 내 강좌는 **이 기기에만** 저장한다. 서버로 보내지 않는다.
 *
 * 딱 한 번, 처음 열 때만 바깥에 묻는다 — 구글 로그인으로 «나는 누구»를 확인하고
 * 내 반과 내 강좌 번호를 받아 온다(앱스스크립트 창구). 정적 파일에는 누가 무엇을
 * 듣는지가 없다. 없어야 한다 — 주소만 알면 누구나 받는 파일이기 때문이다.
 *
 * 화면(2026-10 개편): 탭 다섯 — 오늘 · 시간표 · 급식 · 일정 · 내 정보.
 * 기능은 쓰는 순간 보이는 탭에 둔다. 디데이는 오늘·일정 맨 위, 급식은 시간표에서
 * 빼서 급식 탭과 «오늘 급식» 카드로, 수업 기록(내 일정 중 교시가 붙은 것)은 시간표에.
 * 배치는 화면 폭으로 정하되 학생이 고를 수 있다(내 정보 → 화면 설정).
 * 값은 Hi-AX 화면 원칙을 따른다(docs/ax/화면-원칙.md) — 강조색만 학생용 indigo.
 */
'use strict';

const VERSION = '20261007-v3';      // index.html 의 ?v= 와 sw.js 의 VERSION 과 같은 값
const DAYS = ['월', '화', '수', '목', '금'];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const KEY = 'hanmin.timetable.me.v1';
/* 디데이와 내 일정은 이 기기에만 남는다. 서버로 보내지 않고, 서버에서 받지도 않는다. */
const DDAY_KEY = 'hanmin.timetable.dday.v1';
const EVENTS_KEY = 'hanmin.timetable.events.v1';
/* 화면 설정(배치·시간표 보기)과 «앱으로 받기»를 미룬 때. 이 기기에만. */
const PREFS_KEY = 'hanmin.timetable.prefs.v1';
const INSTALL_KEY = 'hanmin.timetable.install.v1';
/* 구글 캘린더를 이 기기에서 한 번이라도 연결했나 — 그랬을 때만 열 때마다 조용히 되받는다. */
const CAL_KEY = 'hanmin.timetable.cal.v1';
const DATA = 'data/';
/* 오래 열어 둔 앱이 낡은 변경·급식을 보여 주지 않게 — 다시 보일 때 이만큼 지났으면 새로 받는다. */
const REFRESH_AFTER = 10 * 60 * 1000;

/* 창구와 구글 로그인. 학교가 바뀌면 이 두 줄만 고친다. */
const DESK = 'https://script.google.com/macros/s/AKfycbxrSNLXhSMh7MvzV860ebOhVCJY1Pe0mSUSfnvFpXFZL4CE9SFCqFu9myJS19u9FWHr/exec';
const CLIENT_ID = '817402337132-buq4v80hslbv80d2ajteaj8h5664hod2.apps.googleusercontent.com';

const TABS = [
  ['today', '오늘'], ['timetable', '시간표'], ['meals', '급식'], ['calendar', '일정'], ['me', '내 정보'],
];
const MEALS = [['breakfast', '조식'], ['lunch', '중식'], ['dinner', '석식']];

const state = {
  school: null, classes: [], sections: [],
  changes: null, meals: null, calendar: null,
  loadedAt: null,         // 반 시간표를 낸 때
  fetchedAt: 0,           // 이 기기가 자료를 받은 때
  me: null,               // { classId, sections: {bandKey: sectionKey} }
  /*
   * 교사로 로그인했을 때만 채워진다 — 학생 화면이 어떻게 보이는지 확인해야 하는
   * 일이 있는데(문의 대응·점검), 학생 계정을 빌릴 수는 없다.
   * 이 세 가지는 기기에 저장하지 않는다. 창을 닫으면 사라진다.
   */
  teacher: null,          // { credential, roster: [{classId, no, name}] }
  viewing: null,          // 지금 보고 있는 학생 { classId, no, name }
  pickClass: null,        // 교사 화면에서 고른 학급
  busy: false,            // 창구에 묻는 중
  gateError: null,
  tab: 'today',
  listDay: null,          // 시간표 «목록»에서 고른 날
  week: null,             // 시간표·급식이 보는 주의 월요일
  mealDay: null,          // 급식에서 고른 날
  month: null,            // 일정 달력이 보는 달의 1일
  selDate: null,          // 일정 달력에서 고른 날
  dday: null,             // { label, date }
  events: [],             // [{ id, date, period, title, gcalId }]
  calNote: null,          // 캘린더에 못 올렸을 때 사람에게 할 말
  prefs: { layout: 'auto', ttview: null },
  sheet: null,            // 아래에서 올라오는 판(넓은 화면은 가운데 창)
  installPrompt: null,    // 안드로이드·데스크톱 크롬의 설치 창
  installOffered: false,  // 이번에 «앱으로 받기»를 이미 띄웠나
  swWaiting: null,        // 새 버전이 기다리는 중
};

/* ── 날짜 도구 ── 시간대에 흔들리지 않게 로컬 기준으로만 다룬다. */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayIndex = (d) => d.getDay() - 1;              // 0=월 … 4=금, 주말은 음수/5
const isWeekday = (d) => dayIndex(d) >= 0 && dayIndex(d) <= 4;
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const sameDay = (a, b) => iso(a) === iso(b);
const today = () => parse(iso(new Date()));
const fmtDate = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
const fmtShort = (d) => `${d.getMonth() + 1}.${d.getDate()} (${WEEK[d.getDay()]})`;
const fmtRange = (mon, n) => `${mon.getMonth() + 1}.${mon.getDate()} – ${addDays(mon, n).getMonth() + 1}.${addDays(mon, n).getDate()}`;
const nowHM = () => new Date().toTimeString().slice(0, 5);
/** 주말이면 다음 수업일. 빈 주말을 띄워 놓을 이유가 없다. */
const schoolDay = (d) => { let x = d; while (!isWeekday(x)) x = addDays(x, 1); return x; };

async function load(name) {
  try {
    const res = await fetch(`${DATA}${name}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function loadData() {
  const [school, classes, sections, changes, meals, calendar] = await Promise.all(
    ['school.json', 'classes.json', 'sections.json', 'changes.json', 'meals.json', 'calendar.json']
      .map(load),
  );
  if (!school || !classes) return false;
  state.school = school;
  state.classes = classes.classes || [];
  state.sections = (sections && sections.sections) || [];
  state.changes = changes;
  state.meals = meals;
  state.calendar = calendar;
  state.loadedAt = classes.generatedAt || null;
  state.fetchedAt = Date.now();
  return true;
}

async function boot() {
  if (!await loadData()) {
    document.getElementById('app').innerHTML =
      '<div class="boot">시간표를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</div>';
    return;
  }
  try { state.me = !AX_EMBEDDED && !AX_EXTERNAL && JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state.me = null; }
  state.dday = loadDday();
  state.events = loadEvents();
  state.prefs = loadPrefs();
  const fromHash = location.hash.replace('#', '');
  if (TABS.some(([key]) => key === fromHash)) state.tab = fromHash;

  render();
  /*
   * 권한을 이미 준 기기면 캘린더에 있는 것을 조용히 가져온다. 연결한 적이 없는 기기에서
   * 이것을 부르면 열 때마다 권한 창을 띄우려다 막혀 «팝업 차단» 표시만 남는다.
   */
  if (state.me && state.me.classId && calConnected()) pullEventsFromCalendar();
  window.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => {
    const key = location.hash.replace('#', '');
    if (key !== state.tab && TABS.some(([k]) => k === key)) { state.tab = key; render(); }
  });
  /*
   * 배치는 창 폭으로 정해진다. 폭이 바뀌어 배치가 달라질 때만 다시 그린다 —
   * 끌어서 창 크기를 바꾸는 동안 매번 그리면 무겁다.
   */
  let lastLayout = currentLayout();
  window.addEventListener('resize', () => {
    const next = currentLayout();
    if (next !== lastLayout) { lastLayout = next; render(); }
  });
  /* 홈 화면에 둔 앱은 며칠씩 열려 있다. 다시 볼 때 오래됐으면 조용히 새로 받는다. */
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Date.now() - state.fetchedAt < REFRESH_AFTER) return;
    if (await loadData()) render();
  });
  setupInstall();
  registerWorker();
}

function onKey(event) {
  if (event.key === 'Escape' && state.sheet) { closeSheet(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement || state.sheet) return;
  if (event.key === 'ArrowLeft') { step(-1); event.preventDefault(); }
  if (event.key === 'ArrowRight') { step(1); event.preventDefault(); }
}

/**
 * 이 기기의 «내 시간표»를 저장한다.
 *
 * 교사가 학생 화면을 보는 중에는 저장하지 않는다. 그때 state.me 는 남의 것이라,
 * 저장하면 학생 이름·반·수강 강좌가 교사 기기에 남는다. 화면에 잠깐 보여 주는 것과
 * 기기에 남기는 것은 다른 일이다 — 보는 것은 업무지만 남기는 것은 유출이다.
 */
const save = () => {
  if (state.viewing) return;
  localStorage.setItem(KEY, JSON.stringify(state.me));
};

/* ── 화면 설정 ─────────────────────────────────────────────────────── */
function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
    return {
      layout: ['auto', 'single', 'split', 'dashboard'].includes(raw.layout) ? raw.layout : 'auto',
      ttview: ['list', 'grid'].includes(raw.ttview) ? raw.ttview : null,
    };
  } catch { return { layout: 'auto', ttview: null }; }
}
function savePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* 저장 못 해도 이번 화면은 바뀐다 */ }
}

/*
 * 배치 — 한 줄형(아래 탭) · 두 칸형(왼쪽 메뉴 + 본문) · 대시보드형(시간표와 오늘을 한 화면에).
 * 화면에 안 들어가는 배치는 고를 수 없다. 골라 둔 배치가 지금 폭에 안 맞으면 자동으로 간다.
 */
const LAYOUTS = {
  single: { label: '한 줄형', note: '아래 탭으로 넘겨 봐요', min: 0 },
  split: { label: '두 칸형', note: '왼쪽 메뉴와 넓은 본문', min: 700 },
  dashboard: { label: '대시보드형', note: '시간표와 오늘을 한 화면에', min: 1100 },
};
const autoLayout = (w) => (w >= LAYOUTS.dashboard.min ? 'dashboard' : w >= LAYOUTS.split.min ? 'split' : 'single');
function currentLayout() {
  const w = window.innerWidth || 1024;
  const want = state.prefs.layout;
  if (want !== 'auto' && LAYOUTS[want] && w >= LAYOUTS[want].min) return want;
  return autoLayout(w);
}
/* 시간표 기본 보기 — 고른 것이 없으면 좁은 화면은 목록, 넓은 화면은 표. */
const ttView = () => state.prefs.ttview || (currentLayout() === 'single' ? 'list' : 'grid');

/* ── 디데이 ──────────────────────────────────────────────────────────
 * 학생이 직접 정한 날까지 며칠 남았는지 오늘·일정 맨 위에 크게 띄운다.
 * 자료를 주고받지 않는다. 날짜도 이름도 이 기기의 저장소에만 있다.
 * 교사가 학생 화면을 보는 중이면 그 학생의 디데이가 아니라 **교사 자기 것**이 뜬다.
 */
function loadDday() {
  try {
    const raw = JSON.parse(localStorage.getItem(DDAY_KEY) || 'null');
    if (!raw || !raw.date || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) return null;
    return { label: String(raw.label || '').slice(0, 20), date: raw.date };
  } catch { return null; }
}

function saveDday(next) {
  if (next) localStorage.setItem(DDAY_KEY, JSON.stringify(next));
  else localStorage.removeItem(DDAY_KEY);
  state.dday = next;
}

/** 오늘부터 그 날까지 며칠. 지난 날은 음수. 시각은 보지 않는다 — 날짜만 센다. */
function daysUntil(dateStr) {
  return Math.round((parse(dateStr) - today()) / 86400000);
}

function ddayText(left) {
  if (left === 0) return 'D-DAY';
  return left > 0 ? `D-${left}` : `D+${-left}`;
}

/* ── 내 일정 ─────────────────────────────────────────────────────────
 * 학생이 직접 적는 일정. 교시를 붙이면 그 수업의 «수업 기록»이 되어 시간표 칸에
 * 붙고, 교시 없이 적으면 그날 전체의 일정이 된다. 이 기기의 저장소가 원본이고,
 * 구글 캘린더는 그 위에 얹는다(아래 «구글 캘린더»).
 */
function loadEvents() {
  try {
    const raw = JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && String(item.title || '').trim())
      .map((item) => ({
        id: String(item.id || newEventId()),
        date: item.date,
        period: Number.isInteger(item.period) && item.period > 0 ? item.period : null,
        title: String(item.title).trim().slice(0, 40),
        gcalId: item.gcalId || null,
      }));
  } catch { return []; }
}

function saveEvents(next) {
  state.events = next;
  localStorage.setItem(EVENTS_KEY, JSON.stringify(next));
}

function newEventId() {
  return `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** 그 날 내 일정. 교시가 붙은 것이 먼저, 그 안에서는 교시 순. */
function eventsOn(date) {
  const key = iso(date);
  return state.events
    .filter((item) => item.date === key)
    .sort((a, b) => (a.period ?? 99) - (b.period ?? 99));
}

/** 그 날 그 교시에 붙은 일정 — 그 수업의 기록. */
function eventsAt(date, period) {
  return eventsOn(date).filter((item) => item.period === period);
}

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
 * 반을 가리지 않는다. 이것을 안 보면 그날 시간표가 통째로 틀린 채로 그려진다.
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
            band,
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
 * 반과 교시만으로는 칸이 하나로 좁혀지지 않는다(밴드 칸은 반·교시로 특정되지 않는다).
 *   합반  — 3-1 과 3-3 이 함께 듣는 강좌의 보강은 3-1 에만 기록된다.
 *          그 강좌의 어느 반에 적혔든 내 수업이다.
 *   분반  — 같은 교시에 다른 강좌가 함께 걸려 있다. 원래 과목까지 같아야 한다.
 *   동명  — 같은 시간 같은 밴드에 같은 이름 강좌가 둘이다(분담 운영). 교사로 가른다.
 *          공동수업은 원장이 «박가영·Akhona»처럼 병기하고 변경 기록은 한 사람만 적으므로,
 *          한쪽이 다른 쪽을 품으면 같은 사람으로 본다.
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
 * 교체로 들어온 수업에 다시 보강이 걸리는 일이 있다. 하나만 집으면 나머지가 조용히
 * 사라진다. 교체는 «무슨 수업인지»를, 보강은 «누가 들어오는지»를 바꾸므로 겹쳐 읽는다.
 */
function changeForCell(list, period, lesson) {
  const here = list.filter((chg) => chg.period === period && ownsCell(chg, lesson));
  // 교체로 **들어온** 수업에 다시 붙은 변경은 원래 과목과 안 맞는다. 들어온 과목으로 한 번 더 본다.
  const incoming = here.map((chg) => chg.newSubject).filter(Boolean);
  const extra = incoming.length
    ? list.filter((chg) => chg.period === period && !here.includes(chg)
        && incoming.includes(chg.origSubject)
        && ownsCell(chg, { ...lesson, subject: chg.origSubject }))
    : [];
  const found = [...here, ...extra];
  if (!found.length) return null;
  const cancel = found.find((chg) => chg.kind === 'cancel');
  // 교시를 함께 돌려준다 — 칸을 떠나 줄로 세우는 자리(«이번 주 바뀐 수업»)에서 쓴다.
  if (cancel) {
    return { kind: 'cancel', period, subject: null, teacher: null, note: '수업 없음', stack: found };
  }
  const swap = found.find((chg) => chg.kind === 'swap');
  const substitute = found.find((chg) => chg.kind === 'substitute');
  const base = swap ?? substitute ?? found[0];
  return {
    kind: substitute ? 'substitute' : base.kind,
    period,
    subject: (swap && (swap.newSubject || swap.origSubject)) || lesson.subject,
    teacher: (substitute && substitute.newTeacher) || (swap && swap.newTeacher) || null,
    // 보강·교체로 교실이 바뀌기도 한다. 이동수업은 «어디로 가나»가 곧 정보다.
    room: (substitute && substitute.newRoom) || (swap && swap.newRoom) || null,
    origTeacher: base.origTeacher ?? null,
    note: [swap ? '교체' : null, substitute ? '보강' : null].filter(Boolean).join(' · ') || '변경',
    fromDate: base.fromDate ?? null,
    stack: found,
  };
}

/*
 * 그 날의 학사일정 하나.
 * 나이스는 학년별로 대상을 표시한다(1·2·3). 학년이 비어 있으면 전교 대상이다.
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
  if (!found || weekendHoliday(found)) return null;
  if (grade && found.grades && found.grades.length && !found.grades.includes(grade)) return null;
  return found;
}

/*
 * 토요휴업일처럼 주말에 걸린 휴업일은 늘 그런 날이라 일정이 아니다. 달력과 «다가오는 일정»에
 * 매주 빨갛게 세우면 정작 볼 일정이 묻힌다.
 */
function weekendHoliday(day) {
  return day.kind === 'holiday' && !isWeekday(parse(day.date));
}

/** 평일인데 학사일정이 휴일이면 수업이 없는 날이다(대체공휴일·한글날 같은). */
function holidayOn(date) {
  if (!isWeekday(date)) return null;
  const day = calendarOn(date);
  return day && day.kind === 'holiday' ? day : null;
}

/* 그 날 걸린 변경. changes.json 이 없으면 빈 목록이다. */
function changesOn(date) {
  if (!state.changes || !state.changes.changes) return [];
  const key = iso(date);
  return state.changes.changes.filter((chg) => chg.date === key);
}

/* 그 날 내 칸에 실제로 걸린 변경(칸별로 합친 것). */
function myChanges(date) {
  if (!state.changes) return [];
  const list = changesOn(date);
  const lessons = lessonsOn(date);
  const out = [];
  for (const period of state.school.periods || []) {
    const chg = changeForCell(list, period.period, lessons.get(period.period));
    if (chg) out.push({ ...chg, lesson: lessons.get(period.period) });
  }
  return out;
}

/** 다가오는 학사일정 — 내 학년 것만. */
function upcomingSchool(fromKey, limit = 8) {
  const grade = myGrade();
  return ((state.calendar && state.calendar.days) || [])
    .filter((day) => day.date >= fromKey && !weekendHoliday(day))
    .filter((day) => !grade || !day.grades || !day.grades.length || day.grades.includes(grade))
    .slice(0, limit);
}

/** 한 칸을 화면이 쓰는 모양으로 — 변경을 얹고, 이동수업이면 교실을 붙인다. */
function cellOf(date, period, lessons, chgs) {
  const lesson = lessons.get(period);
  if (!lesson) return { period, empty: true };
  if (lesson.kind === 'unpicked') return { period, unpicked: true, band: lesson.band, subject: '이동수업' };
  const chg = changeForCell(chgs, period, lesson);
  if (chg && chg.kind === 'cancel') {
    return { period, lesson, chg, subject: lesson.subject, teacher: lesson.teacher, room: '', cancelled: true };
  }
  return {
    period, lesson, chg,
    subject: chg ? (chg.subject || lesson.subject) : lesson.subject,
    teacher: (chg && chg.teacher) || lesson.teacher || '',
    /*
     * 이동수업은 교실을 함께 보여 준다 — 학생이 «어디로 가나»를 알아야 한다.
     * 자기 교실에서 하는 수업(kind: 'class')은 갈 곳이 없으니 적지 않는다.
     */
    room: lesson.kind === 'section' ? ((chg && chg.room) || lesson.room || '') : '',
  };
}

/* ── 그리기 도구 ── */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}
const ICON = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  timetable: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/>',
  meals: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-2 6 0 8v10"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  add: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5"/>',
};
const icon = (name) => h('span', { class: 'i', 'aria-hidden': 'true',
  html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>` });
const badge = (text, tone) => h('span', { class: `badge${tone ? ` is-${tone}` : ''}` }, text);
const changeTone = (chg) => (chg.kind === 'cancel' ? 'danger' : 'warn');

/* ── 화면 ────────────────────────────────────────────────────────── */
function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (state.teacher && !state.me) app.appendChild(teacherPicker());
  else if (!state.me || !state.me.classId) app.appendChild(loginGate());
  else app.appendChild(shell());
  renderSheet();
  maybeOfferInstall();
}

function go(tab) {
  state.tab = tab;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
}

function shell() {
  const layout = currentLayout();
  const nav = TABS.map(([key, label]) => h('button', {
    class: `tab${state.tab === key ? ' is-on' : ''}`, type: 'button',
    'aria-current': state.tab === key ? 'page' : null, onclick: () => go(key),
  }, icon(key), h('span', null, label)));
  const school = (state.school.name || '').replace(/등학교$/, '');
  return h('div', { class: `shell is-${layout}` },
    layout !== 'single' && h('nav', { class: 'rail', 'aria-label': '메뉴' },
      h('div', { class: 'brand', title: state.school.name || '' }, icon('book'), layout === 'dashboard' && h('b', null, school)),
      nav,
      h('span', { class: 'class-chip', title: '내 반' }, state.me.classId)),
    h('div', { class: 'main' },
      layout === 'single' && topbar(),
      state.viewing && viewingBar(),
      state.swWaiting && h('div', { class: 'notice' },
        h('span', null, '새 버전이 있어요.'),
        h('button', { class: 'btn is-quiet', type: 'button', onclick: () => state.swWaiting.postMessage('skip') }, '새로 고침')),
      h('main', { class: 'screen', id: 'screen' }, screen(layout))),
    layout === 'single' && h('nav', { class: 'tabbar', 'aria-label': '메뉴' }, nav));
}

function topbar() {
  return h('header', { class: 'top' },
    h('span', { class: 'school' }, state.school.name || '학교'),
    h('span', { class: 'class-chip', title: '내 반' }, state.me.classId));
}

/*
 * 교사가 남의 화면을 보는 중이라는 것을 늘 보이게 둔다. 자기 화면으로 착각한 채
 * 「내 시간표가 이상하다」고 말하는 일이 생긴다.
 */
function viewingBar() {
  return h('div', { class: 'viewing' },
    h('b', null, `${state.viewing.classId} ${state.viewing.no}번 ${state.viewing.name} 화면`),
    h('button', { class: 'btn is-quiet', type: 'button', onclick: () => { state.me = null; state.viewing = null; render(); } }, '다른 학생'),
    h('button', { class: 'btn is-quiet', type: 'button', disabled: state.busy, onclick: () => openStudent(state.viewing, true) },
      state.busy ? '조회 중…' : '새로 고침'),
    state.gateError && h('span', { class: 'err' }, state.gateError));
}

function screen(layout) {
  switch (state.tab) {
    case 'timetable': return timetableScreen(layout);
    case 'meals': return mealsScreen(layout);
    case 'calendar': return calendarScreen(layout);
    case 'me': return meScreen(layout);
    default: return todayScreen(layout);
  }
}

/** 화살표 키 — 보고 있는 탭의 날짜를 넘긴다. */
function step(n) {
  if (state.tab === 'timetable') {
    if (ttView() === 'list') {
      let next = addDays(state.listDay || schoolDay(today()), n);
      while (!isWeekday(next)) next = addDays(next, n);
      state.listDay = next; state.week = mondayOf(next);
    } else state.week = addDays(state.week || mondayOf(schoolDay(today())), n * 7);
  } else if (state.tab === 'meals') {
    state.mealDay = addDays(state.mealDay || today(), n);
  } else if (state.tab === 'calendar') {
    const cur = state.month || new Date(today().getFullYear(), today().getMonth(), 1);
    state.month = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
  } else return;
  render();
}

/* ── 오늘 ─────────────────────────────────────────────────────────── */
function todayScreen(layout) {
  const now = today();
  const date = schoolDay(now);
  const weekend = !sameDay(date, now);
  const head = h('div', { class: 'page-head' },
    h('h1', null, fmtDate(date), !weekend && h('em', null, '오늘')),
    weekend && h('p', { class: 'muted' }, '주말이라 다음 수업일을 보여 드려요'));
  const rot = rotationNote(date);
  const blocks = {
    dday: ddayCard(),
    install: installCard(layout),
    changes: changesCard(date),
    nowNext: nowNextCards(date, !weekend),
    flow: dayFlowCard(date, '하루 흐름'),
    meals: mealCard(date),
    upcoming: upcomingCard(),
  };
  if (layout === 'dashboard') {
    return h('div', { class: 'page' }, head, rot,
      h('div', { class: 'cols is-dash' },
        h('div', { class: 'col' }, blocks.install, blocks.changes, blocks.nowNext, weekGridCard(mondayOf(date), date)),
        h('div', { class: 'col is-side' }, blocks.dday, blocks.meals, blocks.upcoming)));
  }
  return h('div', { class: 'page' }, head, blocks.dday, blocks.install, blocks.changes,
    blocks.nowNext, blocks.flow, blocks.meals);
}

function rotationNote(date) {
  const day = effectiveDay(date);
  if (day === dayIndex(date) || !DAYS[day]) return null;
  return h('div', { class: 'note' }, `이날은 ${DAYS[day]}요일 시간표로 운영해요`);
}

/* 디데이 — 오늘과 일정 맨 위. 누르면 고친다. 없으면 «디데이 정하기» 빈 카드. */
function ddayCard() {
  if (!state.dday) {
    return h('button', { class: 'card dday is-empty', type: 'button', onclick: () => openSheet({ type: 'dday' }) },
      h('span', { class: 'dday-text' }, h('b', null, '디데이 정하기'), h('span', { class: 'muted' }, '기다리는 날을 여기서 세어 드려요')),
      icon('plus'));
  }
  const left = daysUntil(state.dday.date);
  return h('button', { class: 'card dday', type: 'button', 'aria-label': '디데이 고치기', onclick: () => openSheet({ type: 'dday' }) },
    h('span', { class: 'dday-text' },
      h('span', { class: 'label' }, '기다리는 날'),
      h('b', null, state.dday.label || '디데이'),
      h('span', { class: 'muted' }, fmtShort(parse(state.dday.date)))),
    h('strong', { class: `dday-num${left === 0 ? ' is-now' : ''}` }, ddayText(left)));
}

/* 그날 내 칸에 걸린 변경 — 맨 위에. 상태는 배지로만 말한다(원칙 4). */
function changesCard(date) {
  const list = myChanges(date);
  if (!list.length) return null;
  return h('section', { class: 'card changes' },
    h('h2', { class: 'card-title' }, icon('bell'), '바뀐 수업'),
    list.map((chg) => h('button', { class: 'row', type: 'button', onclick: () => openSheet({ type: 'lesson', date: iso(date), period: chg.period }) },
      h('span', { class: 'row-lead' }, `${chg.period}교시`),
      h('span', { class: 'row-body' },
        h('b', null, chg.kind === 'cancel' ? (chg.lesson && chg.lesson.subject) || '수업' : chg.subject || ''),
        h('span', { class: 'muted' }, changeLine(chg))),
      badge(chg.note, changeTone(chg)))));
}

const changeLine = (chg) => (chg.kind === 'cancel'
  ? '이 시간 수업이 없어요'
  : [chg.origTeacher && chg.teacher ? `${chg.origTeacher} → ${chg.teacher}` : chg.teacher, chg.room].filter(Boolean).join(' · '));

/* 지금 수업·다음 수업 — 오늘일 때만. 강조는 테두리와 글자로(색면으로 채우지 않는다, 원칙 3). */
function nowNextCards(date, isToday) {
  if (!isToday || holidayOn(date)) return null;
  const periods = state.school.periods || [];
  const lessons = lessonsOn(date);
  const chgs = changesOn(date);
  const t = nowHM();
  const cur = periods.find((p) => p.startTime <= t && t < p.endTime && lessons.has(p.period));
  const next = periods.find((p) => p.startTime > t && lessons.has(p.period));
  const card = (label, p, on) => {
    const c = cellOf(date, p.period, lessons, chgs);
    return h('button', { class: `card lesson-card${on ? ' is-now' : ''}`, type: 'button',
      onclick: () => (c.unpicked ? openSheet({ type: 'picker', band: c.band }) : openSheet({ type: 'lesson', date: iso(date), period: p.period })) },
      h('span', { class: 'label' }, label, h('span', { class: 'muted' }, ` · ${p.period}교시 ${p.startTime}–${p.endTime}`)),
      h('b', { class: 'lesson-name' }, c.unpicked ? '이동수업' : c.subject),
      h('span', { class: 'muted' }, c.unpicked ? '어떤 강좌를 듣는지 골라 주세요' : [c.teacher, c.room].filter(Boolean).join(' · ')),
      c.chg && badge(c.chg.note, changeTone(c.chg)));
  };
  if (!cur && !next) return null;
  return h('div', { class: 'pair' }, cur && card('지금 수업', cur, true), next && card(cur ? '다음 수업' : '첫 수업', next, false));
}

/*
 * 하루 흐름 — 교시마다 한 줄. 급식은 넣지 않는다(급식 탭과 «오늘 급식» 카드).
 * 수업을 누르면 그 수업의 정보·강좌 고르기·수업 기록이 열린다.
 */
function dayFlowCard(date, title) {
  const holiday = holidayOn(date);
  if (holiday) {
    return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, title),
      h('p', { class: 'empty' }, `${holiday.labels.join(' · ')} — 수업이 없어요`));
  }
  const periods = state.school.periods || [];
  const lessons = lessonsOn(date);
  const chgs = changesOn(date);
  const isToday = sameDay(date, today());
  const t = nowHM();
  const rows = periods.map((p) => {
    const c = cellOf(date, p.period, lessons, chgs);
    const records = eventsAt(date, p.period);
    const on = isToday && p.startTime <= t && t < p.endTime && !c.empty;
    const open = () => (c.unpicked ? openSheet({ type: 'picker', band: c.band })
      : openSheet({ type: 'lesson', date: iso(date), period: p.period }));
    return h('button', { class: `slot${on ? ' is-now' : ''}${c.empty ? ' is-free' : ''}${c.unpicked ? ' is-unpicked' : ''}${c.chg ? ' is-chg' : ''}`, type: 'button', onclick: open,
      'aria-label': `${p.period}교시 ${c.empty ? '공강' : c.subject}` },
      h('span', { class: 'slot-time' }, h('b', null, `${p.period}교시`), h('span', null, p.startTime)),
      h('span', { class: 'slot-body' },
        h('span', { class: 'slot-name' },
          h('b', { class: c.cancelled ? 'is-cut' : null }, c.empty ? '공강' : c.subject),
          on && badge('지금', 'accent'),
          c.chg && badge(c.chg.note, changeTone(c.chg))),
        !c.empty && h('span', { class: 'muted' }, c.unpicked ? '어떤 강좌를 듣는지 골라 주세요'
          : c.cancelled ? '이 시간 수업이 없어요' : [c.teacher, c.room].filter(Boolean).join(' · ')),
        records.length > 0 && h('span', { class: 'records' }, records.map((item) => h('span', { class: 'chip' }, item.title)))),
      c.unpicked && h('span', { class: 'btn is-quiet is-small' }, '고르기'));
  });
  const allDay = eventsOn(date).filter((item) => item.period === null);
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    rotationNote(date),
    h('div', { class: 'slots' }, rows),
    allDay.length > 0 && h('div', { class: 'chips' }, allDay.map((item) =>
      h('button', { class: 'chip is-mine', type: 'button', onclick: () => openSheet({ type: 'event', draft: { ...item } }) }, item.title))));
}

/* 오늘 급식 — 시간표와 떨어진 카드. 누르면 급식 탭으로. */
function mealCard(date) {
  const day = state.meals && state.meals.days && state.meals.days[iso(date)];
  const times = state.school.mealTimes || {};
  const items = MEALS.map(([key, label]) => ({ key, label, time: times[key], lines: menuLines(day && day[key]) }))
    .filter((m) => m.lines.length);
  return h('section', { class: 'card meals-card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, sameDay(date, today()) ? '오늘 급식' : `${fmtShort(date)} 급식`),
      h('button', { class: 'link', type: 'button', onclick: () => { state.mealDay = date; go('meals'); } }, '급식 탭', icon('next'))),
    items.length === 0
      ? h('p', { class: 'empty' }, state.meals ? '등록된 식단이 없어요' : '급식은 아직 준비 중이에요')
      : items.map((m) => h('div', { class: 'meal-line' },
          h('span', { class: 'meal-name' }, h('b', null, m.label), m.time && h('span', { class: 'muted' }, m.time)),
          h('span', { class: 'meal-menu' }, m.lines.slice(0, 4).join(' · ')))));
}

const menuLines = (items) => (Array.isArray(items) ? items : typeof items === 'string' && items ? [items] : []);

/* 다가오는 일정 — 학사일정과 내 일정을 한 줄로(색으로 갈래를 가른다). */
function upcomingCard() {
  const from = iso(today());
  const school = upcomingSchool(from).map((day) => ({ date: day.date, text: day.labels.join(' · '), kind: day.kind, day }));
  const mine = state.events.filter((item) => item.date >= from)
    .map((item) => ({ date: item.date, text: item.period ? `${item.period}교시 ${item.title}` : item.title, kind: 'mine', item }));
  const soon = [...school, ...mine].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '다가오는 일정'),
      h('button', { class: 'link', type: 'button', onclick: () => go('calendar') }, '일정 탭', icon('next'))),
    soon.length === 0
      ? h('p', { class: 'empty' }, state.calendar ? '다가오는 일정이 없어요' : '학사일정은 아직 준비 중이에요')
      : soon.map((row) => h('button', { class: `row is-${row.kind}`, type: 'button',
          onclick: () => openSheet(row.item ? { type: 'event', draft: { ...row.item } } : { type: 'school', date: row.date }) },
          h('span', { class: 'row-lead' }, fmtShort(parse(row.date))),
          h('span', { class: 'row-body' }, h('b', null, row.text)))));
}

/* ── 시간표 ─────────────────────────────────────────────────────── */
function timetableScreen(layout) {
  const base = schoolDay(today());
  state.week = state.week || mondayOf(base);
  if (!state.listDay || !sameDay(mondayOf(state.listDay), state.week)) {
    state.listDay = sameDay(mondayOf(base), state.week) ? base : state.week;
  }
  const view = ttView();
  const mon = state.week;
  const head = h('div', { class: 'page-head is-row' },
    h('h1', null, '시간표'),
    h('div', { class: 'seg', role: 'group', 'aria-label': '시간표 보기' },
      [['list', '목록'], ['grid', '표']].map(([key, label]) => h('button', {
        type: 'button', class: view === key ? 'is-on' : null, 'aria-pressed': String(view === key),
        onclick: () => { savePrefs({ ttview: key }); render(); },
      }, label))));
  const nav = weekNav(mon, 4, (n) => { state.week = addDays(mon, n * 7); state.listDay = null; render(); });
  const main = view === 'list'
    ? h('div', { class: 'stack' }, dayChips(mon, 5, state.listDay, (d) => { state.listDay = d; render(); }),
        dayFlowCard(state.listDay, fmtDate(state.listDay)))
    : weekGridCard(mon, null);
  const side = [weekChangesCard(mon), myCoursesCard()];
  if (layout === 'dashboard') {
    return h('div', { class: 'page' }, head, nav, h('div', { class: 'cols is-dash' }, h('div', { class: 'col' }, main), h('div', { class: 'col is-side' }, side)));
  }
  return h('div', { class: 'page' }, head, nav, main, side);
}

function weekNav(mon, span, move) {
  const thisWeek = sameDay(mon, mondayOf(schoolDay(today())));
  return h('div', { class: 'week-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '지난주', onclick: () => move(-1) }, icon('back')),
    h('b', null, fmtRange(mon, span)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '다음 주', onclick: () => move(1) }, icon('next')),
    !thisWeek && h('button', { class: 'btn is-quiet is-small', type: 'button', onclick: () => move(Math.round((mondayOf(schoolDay(today())) - mon) / (7 * 86400000))) }, '이번 주'));
}

function dayChips(mon, count, selected, pick) {
  return h('div', { class: 'day-chips' }, Array.from({ length: count }, (_, i) => {
    const d = addDays(mon, i);
    const on = selected && sameDay(d, selected);
    const mark = count === 5 ? myChanges(d).length > 0 : false;
    return h('button', { type: 'button', class: `day-chip${on ? ' is-on' : ''}${sameDay(d, today()) ? ' is-today' : ''}${holidayOn(d) ? ' is-off' : ''}`,
      'aria-pressed': String(Boolean(on)), onclick: () => pick(d) },
      h('span', null, WEEK[d.getDay()]), h('b', null, String(d.getDate())), mark && h('i', { class: 'dot', 'aria-label': '바뀐 수업 있음' }));
  }));
}

/*
 * 주간 시간표. 급식 줄은 두지 않는다 — 여기서 보는 것은 «이번 주 수업이 어떻게 흐르는가».
 * 칸을 누르면 그 수업이 열린다(정보·강좌·수업 기록).
 */
function weekGridCard(mon, focus) {
  const periods = state.school.periods || [];
  const days = [0, 1, 2, 3, 4].map((i) => {
    const date = addDays(mon, i);
    return { date, holiday: holidayOn(date), lessons: lessonsOn(date), changes: changesOn(date) };
  });
  const head = h('tr', null, h('th', { class: 'pn' }),
    days.map(({ date, holiday }) => h('th', { class: `${sameDay(date, today()) ? 'is-today' : ''}${focus && sameDay(date, focus) ? ' is-focus' : ''}` },
      h('span', null, WEEK[date.getDay()]), h('b', null, String(date.getDate())), holiday && h('small', null, holiday.labels[0]))));
  const rows = periods.map((p, row) => h('tr', null,
    h('td', { class: 'pn' }, h('b', null, String(p.period)), h('span', null, p.startTime)),
    days.map(({ date, holiday, lessons, changes }) => {
      if (holiday) {
        return row === 0 ? h('td', { class: 'off', rowspan: String(periods.length) }, h('span', null, holiday.labels[0]), h('small', null, '수업 없음')) : null;
      }
      const c = cellOf(date, p.period, lessons, changes);
      if (c.empty) return h('td', { class: 'free' }, h('span', { class: 'muted' }, '공강'));
      const records = eventsAt(date, p.period);
      return h('td', null, h('button', { type: 'button', class: `cell${c.chg ? ' is-chg' : ''}${c.unpicked ? ' is-unpicked' : ''}`,
        onclick: () => (c.unpicked ? openSheet({ type: 'picker', band: c.band }) : openSheet({ type: 'lesson', date: iso(date), period: p.period })) },
        h('b', { class: c.cancelled ? 'is-cut' : null }, c.subject),
        h('span', null, c.unpicked ? '고르기' : [c.teacher, c.room].filter(Boolean).join(' · ')),
        c.chg && badge(c.chg.note, changeTone(c.chg)),
        records.length > 0 && h('span', { class: 'rec' }, records[0].title)));
    })));
  return h('section', { class: 'card grid-card' },
    h('div', { class: 'grid-wrap' }, h('table', { class: 'wk' }, h('thead', null, head), h('tbody', null, rows))));
}

/* 이번 주 바뀐 수업 — 내 칸에 걸린 것만. 그날 변경을 통째로 늘어놓으면 옆 강좌 보강이 샌다. */
function weekChangesCard(mon) {
  const list = [0, 1, 2, 3, 4].flatMap((i) => myChanges(addDays(mon, i)).map((chg) => ({ ...chg, date: addDays(mon, i) })));
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, '이번 주 바뀐 수업'),
    !state.changes ? h('p', { class: 'empty' }, '수업 변경은 아직 준비 중이에요')
      : list.length === 0 ? h('p', { class: 'empty' }, '바뀐 수업이 없어요')
        : list.map((chg) => h('button', { class: 'row', type: 'button', onclick: () => openSheet({ type: 'lesson', date: iso(chg.date), period: chg.period }) },
            h('span', { class: 'row-lead' }, `${WEEK[chg.date.getDay()]} ${chg.period}교시`),
            h('span', { class: 'row-body' }, h('b', null, chg.kind === 'cancel' ? (chg.lesson && chg.lesson.subject) || '' : chg.subject || ''),
              h('span', { class: 'muted' }, changeLine(chg))),
            badge(chg.note, changeTone(chg)))));
}

/* 내 강좌 — 이동수업마다 어느 강좌를 듣는지. 누르면 고친다. */
function myCoursesCard() {
  const bands = [...bandsOfMyClass().entries()];
  if (!bands.length) return null;
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, '내 강좌'),
    bands.map(([band, list]) => {
      const key = state.me.sections[band];
      const chosen = list.find((sec) => sectionKey(sec) === key);
      const when = chosen ? list.filter((sec) => sectionKey(sec) === key).map((sec) => `${DAYS[sec.day]}${sec.period}`).join(' · ') : '';
      return h('button', { class: 'row', type: 'button', onclick: () => openSheet({ type: 'picker', band }) },
        h('span', { class: 'row-body' },
          h('b', null, chosen ? chosen.subject : '아직 안 골랐어요'),
          h('span', { class: 'muted' }, chosen ? [chosen.teacher, chosen.room, when].filter(Boolean).join(' · ') : '눌러서 듣는 강좌를 골라 주세요')),
        icon('next'));
    }));
}

/* ── 급식 ─────────────────────────────────────────────────────────── */
function mealsScreen(layout) {
  state.mealDay = state.mealDay || today();
  const day = state.mealDay;
  const mon = mondayOf(day);
  const menu = state.meals && state.meals.days && state.meals.days[iso(day)];
  const times = state.school.mealTimes || {};
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, '급식')),
    weekNav(mon, 6, (n) => { state.mealDay = addDays(state.mealDay, n * 7); render(); }),
    dayChips(mon, 7, day, (d) => { state.mealDay = d; render(); }),
    h('h2', { class: 'section-title' }, fmtDate(day), sameDay(day, today()) && h('em', null, '오늘')),
    !state.meals ? h('p', { class: 'card empty' }, '급식은 아직 준비 중이에요')
      : !menu ? h('p', { class: 'card empty' }, '등록된 식단이 없어요')
        : h('div', { class: `meal-grid${layout === 'single' ? '' : ' is-wide'}` }, MEALS.map(([key, label]) => {
            const lines = menuLines(menu[key]);
            return h('section', { class: 'card meal' },
              h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, label), times[key] && h('span', { class: 'muted' }, times[key])),
              lines.length ? h('ul', { class: 'menu' }, lines.map((line) => h('li', null, line))) : h('p', { class: 'empty' }, '없어요'));
          })));
}

/* ── 일정 ─────────────────────────────────────────────────────────── */
function calendarScreen(layout) {
  state.month = state.month || new Date(today().getFullYear(), today().getMonth(), 1);
  state.selDate = state.selDate || today();
  const first = state.month;
  const head = h('div', { class: 'page-head' }, h('h1', null, '일정'));
  const month = monthCard(first);
  const side = [dayDetailCard(state.selDate), upcomingCard(), myEventsCard()];
  if (layout === 'single') return h('div', { class: 'page' }, head, ddayCard(), month, side);
  return h('div', { class: 'page' }, head, ddayCard(),
    h('div', { class: 'cols is-dash' }, h('div', { class: 'col' }, month), h('div', { class: 'col is-side' }, side)));
}

function monthCard(first) {
  const start = addDays(first, -first.getDay());
  const rows = [];
  for (let week = 0; week < 6; week += 1) {
    const cells = [];
    let any = false;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(start, week * 7 + i);
      const outside = date.getMonth() !== first.getMonth();
      if (!outside) any = true;
      const school = !outside && calendarOn(date);
      const mine = outside ? [] : eventsOn(date);
      const changed = !outside && isWeekday(date) && myChanges(date).length > 0;
      const cls = ['day', outside && 'is-out', (!isWeekday(date) || (school && school.kind === 'holiday')) && 'is-off',
        sameDay(date, today()) && 'is-today', state.selDate && sameDay(date, state.selDate) && 'is-sel'].filter(Boolean).join(' ');
      cells.push(h('td', null, outside ? h('span', { class: cls }, String(date.getDate())) : h('button', { type: 'button', class: cls,
        'aria-label': `${date.getMonth() + 1}월 ${date.getDate()}일`, onclick: () => { state.selDate = date; render(); } },
        h('span', { class: 'num' }, String(date.getDate()), changed && h('i', { class: 'dot', 'aria-label': '바뀐 수업 있음' })),
        school && h('span', { class: `tag is-${school.kind}` }, school.labels[0]),
        mine.slice(0, 2).map((item) => h('span', { class: 'tag is-mine' }, item.title)),
        mine.length > 2 && h('span', { class: 'more' }, `외 ${mine.length - 2}`))));
    }
    if (any) rows.push(h('tr', null, cells));
  }
  return h('section', { class: 'card month-card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, `${first.getFullYear()}년 ${first.getMonth() + 1}월`),
      h('div', { class: 'nav-btns' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '지난달', onclick: () => step(-1) }, icon('back')),
        h('button', { class: 'btn is-quiet is-small', type: 'button', onclick: () => { state.month = null; state.selDate = today(); render(); } }, '오늘'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '다음 달', onclick: () => step(1) }, icon('next')))),
    h('table', { class: 'mo' }, h('thead', null, h('tr', null, WEEK.map((w, i) => h('th', { class: i === 0 ? 'is-sun' : null }, w)))), h('tbody', null, rows)),
    h('div', { class: 'legend' }, h('span', { class: 'tag is-event' }, '학사일정'), h('span', { class: 'tag is-mine' }, '내 일정'),
      h('span', null, h('i', { class: 'dot' }), ' 바뀐 수업')));
}

/* 고른 날 — 학사일정(누르면 디데이로 정하기), 내 일정(누르면 고치기), 그날 시간표로 가는 길. */
function dayDetailCard(date) {
  const school = calendarOn(date);
  const mine = eventsOn(date);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, fmtShort(date)),
      isWeekday(date) && h('button', { class: 'link', type: 'button', onclick: () => { state.week = mondayOf(date); state.listDay = date; go('timetable'); } }, '이날 시간표', icon('next'))),
    school && h('button', { class: `row is-${school.kind}`, type: 'button', onclick: () => openSheet({ type: 'school', date: iso(date) }) },
      h('span', { class: 'row-body' }, h('b', null, school.labels.join(' · ')), h('span', { class: 'muted' }, '학사일정')), icon('next')),
    mine.map((item) => h('button', { class: 'row is-mine', type: 'button', onclick: () => openSheet({ type: 'event', draft: { ...item } }) },
      h('span', { class: 'row-body' }, h('b', null, item.title), h('span', { class: 'muted' }, item.period ? `${item.period}교시 · 수업 기록` : '내 일정')), icon('next'))),
    !school && !mine.length && h('p', { class: 'empty' }, '일정이 없어요'),
    h('button', { class: 'btn is-quiet', type: 'button', onclick: () => openSheet({ type: 'event', draft: { date: iso(date), period: null, title: '' } }) }, icon('plus'), '이날 일정 추가'));
}

/*
 * 내 일정과 구글 캘린더. 캘린더에 못 올린 것이 있으면 그렇게 말한다 — 「저장됐다」고
 * 믿게 두고 기기를 바꾸면 그때 사라진 것을 안다.
 */
function myEventsCard() {
  const local = state.events.filter((item) => !item.gcalId);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '내 일정'),
      h('button', { class: 'btn is-quiet is-small', type: 'button', onclick: () => openSheet({ type: 'event', draft: { date: iso(state.selDate || today()), period: null, title: '' } }) }, icon('plus'), '일정')),
    h('div', { class: 'row is-static' },
      h('span', { class: 'row-body' }, h('b', null, '구글 캘린더'),
        h('span', { class: 'muted' }, local.length ? `이 기기에만 ${local.length}건 있어요` : cal.token ? '연결됨' : '내 구글 캘린더에도 함께 적어요')),
      h('button', { class: 'btn is-quiet is-small', type: 'button', onclick: syncCalendar }, local.length ? '올리기' : '연결')),
    state.calNote && h('p', { class: 'note' }, state.calNote));
}

async function syncCalendar() {
  state.calNote = null;
  const token = await calToken(false);
  if (!token) { state.calNote = '구글 캘린더에 연결하지 못했어요. 일정은 이 기기에 그대로 있어요.'; render(); return; }
  for (const item of state.events.filter((row) => !row.gcalId)) await pushEventToCalendar(item);
  await pullEventsFromCalendar();
  render();
}

/* ── 내 정보 ─────────────────────────────────────────────────────── */
function meScreen() {
  const width = window.innerWidth || 1024;
  const current = currentLayout();
  const standalone = isStandalone();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, '내 정보')),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, '계정'),
      h('div', { class: 'row is-static' }, h('span', { class: 'row-body' }, h('b', null, `${state.me.classId.replace('-', '학년 ')}반`),
        h('span', { class: 'muted' }, state.viewing ? '선생님이 보는 학생 화면' : '학교 구글 계정으로 로그인'))),
      !state.viewing && h('button', { class: 'btn is-quiet', type: 'button', onclick: logout }, '다른 계정으로 로그인')),
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, '화면 설정'),
      h('h3', { class: 'sub-title' }, '화면 배치'),
      h('div', { class: 'options' },
        [['auto', '자동', '창 크기에 맞춰요', 0], ...Object.entries(LAYOUTS).map(([key, v]) => [key, v.label, v.note, v.min])].map(([key, label, note, min]) => {
          const blocked = width < min;
          const on = state.prefs.layout === key;
          return h('button', { type: 'button', class: `option${on ? ' is-on' : ''}`, disabled: blocked,
            'aria-pressed': String(on), onclick: () => { savePrefs({ layout: key }); render(); } },
            h('span', { class: `layout-mark is-${key}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
            h('b', null, label), h('span', { class: 'muted' }, blocked ? '화면이 좁아요' : key === 'auto' ? `지금: ${LAYOUTS[current].label}` : note));
        })),
      h('h3', { class: 'sub-title' }, '시간표 기본 보기'),
      h('div', { class: 'options is-two' },
        [['list', '요일별 목록', '하루 수업을 차례로'], ['grid', '주간 표', '월~금을 한눈에']].map(([key, label, note]) => {
          const on = ttView() === key;
          return h('button', { type: 'button', class: `option${on ? ' is-on' : ''}`, 'aria-pressed': String(on), onclick: () => { savePrefs({ ttview: key }); render(); } },
            h('b', null, label), h('span', { class: 'muted' }, note));
        })),
      h('p', { class: 'muted small' }, '이 기기에만 적용돼요')),
    !AX_EMBEDDED && !AX_EXTERNAL && h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, '앱으로 받기'),
      standalone ? h('p', { class: 'muted' }, '앱으로 쓰는 중이에요')
        : h('button', { class: 'btn is-key', type: 'button', onclick: () => openSheet({ type: 'install' }) }, icon('download'), '시간표를 앱으로 받기')),
    h('p', { class: 'muted small foot' }, dataNote()));
}

/* 자료가 언제 것인지 — 경고처럼 띄우지 않고 내 정보 맨 아래에 한 줄. */
function dataNote() {
  const parts = [];
  if (state.loadedAt) { const d = new Date(state.loadedAt); parts.push(`반 시간표 ${d.getMonth() + 1}.${d.getDate()} 발행`); }
  if (state.meals && state.meals.to) parts.push(`급식 ${state.meals.to.slice(5).replace('-', '.')}까지`);
  return parts.join(' · ');
}

function logout() {
  localStorage.removeItem(KEY);
  state.me = null; state.gateError = null;
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  go('today');
}

/* ── 아래에서 올라오는 판 ─────────────────────────────────────────────
 * 폰에서는 아래에서 올라오고, 넓은 화면에서는 가운데 작은 창이다(원칙 11·12).
 * 열릴 때 한 번만 움직인다(원칙 10) — 다시 그릴 때는 움직이지 않는다.
 */
let sheetOpenedAt = 0;
function openSheet(spec) {
  state.sheet = spec;
  sheetOpenedAt = Date.now();
  render();
}
function closeSheet() {
  state.sheet = null;
  render();
}

let shownSheet = null;
function renderSheet(force = false) {
  const root = document.getElementById('sheet-root');
  if (!root) return;
  const spec = state.sheet;
  // 같은 판이 이미 떠 있으면 그대로 둔다 — 캘린더를 받아 와 다시 그려도 적던 글이 남는다.
  if (spec && spec === shownSheet && root.firstChild && !force) return;
  shownSheet = spec;
  root.innerHTML = '';
  if (!spec) { document.body.classList.remove('has-sheet'); return; }
  const body = sheetBody(spec);
  if (!body) { state.sheet = null; return; }
  document.body.classList.add('has-sheet');
  const fresh = Date.now() - sheetOpenedAt < 400;
  const panel = h('section', { class: `sheet${fresh ? ' is-entering' : ''}${currentLayout() === 'single' ? ' is-bottom' : ' is-dialog'}`,
    role: 'dialog', 'aria-modal': 'true', 'aria-label': body.title, tabindex: '-1' },
    h('div', { class: 'sheet-head' }, h('h2', null, body.title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: closeSheet }, icon('close'))),
    h('div', { class: 'sheet-body' }, body.content),
    body.footer && h('div', { class: 'sheet-foot' }, body.footer));
  root.append(h('div', { class: 'scrim', onclick: closeSheet }), panel);
  if (fresh) {
    const target = panel.querySelector('[autofocus]') || panel;
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
}

function sheetBody(spec) {
  switch (spec.type) {
    case 'dday': return ddaySheet();
    case 'lesson': return lessonSheet(parse(spec.date), spec.period);
    case 'event': return eventSheet(spec.draft);
    case 'school': return schoolSheet(spec.date);
    case 'picker': return pickerSheet(spec.band);
    case 'install': return installSheet();
    default: return null;
  }
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', null, label), input);
}

/* 디데이 정하기 — 학사일정에서 고르거나 직접 적는다. */
function ddaySheet() {
  const name = h('input', { type: 'text', maxlength: '20', placeholder: '예: 기말고사', value: state.dday ? state.dday.label : '', autofocus: !state.dday });
  const when = h('input', { type: 'date', value: state.dday ? state.dday.date : '' });
  const upcoming = upcomingSchool(iso(today()), 6);
  return {
    title: '디데이',
    content: [
      upcoming.length > 0 && h('div', { class: 'pick-list' },
        h('h3', { class: 'sub-title' }, '학사일정에서 고르기'),
        upcoming.map((day) => h('button', { type: 'button', class: `row${state.dday && state.dday.date === day.date ? ' is-on' : ''}`,
          onclick: () => { name.value = day.labels[0]; when.value = day.date; } },
          h('span', { class: 'row-lead' }, fmtShort(parse(day.date))), h('span', { class: 'row-body' }, h('b', null, day.labels.join(' · ')))))),
      h('h3', { class: 'sub-title' }, '직접 적기'),
      field('이름', name), field('날짜', when),
      h('p', { class: 'muted small' }, '이 기기에만 저장돼요'),
    ],
    footer: [
      state.dday && h('button', { class: 'btn is-quiet', type: 'button', onclick: () => { saveDday(null); closeSheet(); } }, '디데이 끄기'),
      h('button', { class: 'btn is-key', type: 'button', onclick: () => {
        if (!when.value) { when.focus(); return; }
        saveDday({ label: name.value.trim(), date: when.value });
        closeSheet();
      } }, '저장'),
    ],
  };
}

/* 수업 — 정보, 바뀐 것, 이동수업이면 강좌 고르기, 그 수업에 붙인 기록. */
function lessonSheet(date, period) {
  const p = (state.school.periods || []).find((x) => x.period === period);
  const c = cellOf(date, period, lessonsOn(date), changesOn(date));
  const records = eventsAt(date, period);
  return {
    title: c.empty ? `${period}교시 공강` : c.subject,
    content: [
      h('p', { class: 'muted' }, `${fmtShort(date)} · ${period}교시${p ? ` · ${p.startTime}–${p.endTime}` : ''}`),
      !c.empty && h('div', { class: 'facts' },
        c.teacher && h('span', null, h('b', null, '선생님'), c.teacher),
        c.room && h('span', null, h('b', null, '교실'), c.room)),
      c.chg && h('div', { class: 'row is-static' }, badge(c.chg.note, changeTone(c.chg)), h('span', { class: 'row-body' }, changeLine(c.chg))),
      c.lesson && c.lesson.kind === 'section' && h('button', { class: 'btn is-quiet', type: 'button', onclick: () => openSheet({ type: 'picker', band: c.lesson.band }) }, '강좌 확인·고르기'),
      h('h3', { class: 'sub-title' }, '수업 기록'),
      records.length ? records.map((item) => h('button', { class: 'row is-mine', type: 'button', onclick: () => openSheet({ type: 'event', draft: { ...item } }) },
        h('span', { class: 'row-body' }, h('b', null, item.title)), icon('next')))
        : h('p', { class: 'empty' }, '수행평가·준비물·메모를 이 수업에 붙여 둬요'),
    ],
    footer: [h('button', { class: 'btn is-key', type: 'button', onclick: () => openSheet({ type: 'event', draft: { date: iso(date), period, title: '' } }) }, icon('plus'), '기록 추가')],
  };
}

/* 내 일정·수업 기록 적기. 교시를 고르면 그 수업에 붙고, 하루 종일이면 그날의 일정이 된다. */
function eventSheet(draft) {
  const title = h('input', { type: 'text', maxlength: '40', placeholder: '무엇을 (예: 수행평가, 준비물)', value: draft.title || '', autofocus: true });
  const when = h('input', { type: 'date', value: draft.date || iso(today()) });
  const period = h('select', null, h('option', { value: '' }, '하루 종일'),
    (state.school.periods || []).map((p) => h('option', { value: String(p.period), selected: draft.period === p.period }, `${p.period}교시`)));
  return {
    title: draft.id ? '일정 고치기' : draft.period ? '수업 기록' : '일정 추가',
    content: [field('무엇을', title), h('div', { class: 'field-row' }, field('날짜', when), field('교시', period)),
      state.calNote && h('p', { class: 'note' }, state.calNote)],
    footer: [
      draft.id && h('button', { class: 'btn is-quiet is-danger', type: 'button', onclick: () => {
        saveEvents(state.events.filter((item) => item.id !== draft.id));
        closeSheet();
        removeEventFromCalendar(draft);
      } }, '지우기'),
      h('button', { class: 'btn is-key', type: 'button', onclick: () => {
        const text = title.value.trim();
        if (!text) { title.focus(); return; }
        if (!when.value) { when.focus(); return; }
        const next = { id: draft.id || newEventId(), date: when.value, period: period.value ? Number(period.value) : null, title: text, gcalId: draft.gcalId || null };
        saveEvents([...state.events.filter((item) => item.id !== next.id), next]);
        closeSheet();
        pushEventToCalendar(next);
      } }, '저장'),
    ],
  };
}

/* 학사일정 한 날 — «디데이로 정하기». */
function schoolSheet(dateKey) {
  const day = calendarOn(parse(dateKey));
  if (!day) return null;
  const label = day.labels[0];
  return {
    title: day.labels.join(' · '),
    content: [h('p', { class: 'muted' }, `${fmtShort(parse(dateKey))} · 학사일정`)],
    footer: [h('button', { class: 'btn is-key', type: 'button', onclick: () => { saveDday({ label, date: dateKey }); closeSheet(); } }, '디데이로 정하기')],
  };
}

/* 강좌 고르기 — 이동수업은 학생마다 다르다. 한 번 고르면 계속 기억한다. */
function pickerSheet(band) {
  const list = bandsOfMyClass().get(band) || [];
  const uniq = new Map();
  for (const sec of list) if (!uniq.has(sectionKey(sec))) uniq.set(sectionKey(sec), sec);
  return {
    title: '어떤 강좌를 듣나요?',
    content: [...uniq].map(([key, sec]) => {
      const when = list.filter((x) => sectionKey(x) === key).map((x) => `${DAYS[x.day]}${x.period}`).join(' · ');
      const on = state.me.sections[band] === key;
      return h('button', { type: 'button', class: `row${on ? ' is-on' : ''}`, 'aria-pressed': String(on),
        onclick: () => { state.me.sections[band] = key; save(); closeSheet(); } },
        h('span', { class: 'row-body' }, h('b', null, sec.subject), h('span', { class: 'muted' }, [sec.teacher || '담당 미정', sec.room, when].filter(Boolean).join(' · '))),
        on && badge('듣는 강좌', 'accent'));
    }),
  };
}

/* ── 앱으로 받기 ─────────────────────────────────────────────────────
 * 홈 화면에 두면 주소를 다시 찾을 일이 없고, 누르자마자 뜬다(서비스 워커가 기기에 둔다).
 * 기기마다 받는 길이 달라 안내도 다르다. 카카오톡·인스타그램 안의 창에서는 설치가 안
 * 되므로 브라우저로 먼저 연다.
 */
const UA = navigator.userAgent || '';
const isIOS = () => /iPad|iPhone|iPod/.test(UA) || (UA.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isKakao = () => /KAKAOTALK/i.test(UA);
const isInApp = () => isKakao() || /Instagram|FBAN|FBAV|NAVER\(inapp|Line\//i.test(UA);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPrompt = event;
    if (state.sheet && state.sheet.type === 'install') renderSheet(true);
  });
  window.addEventListener('appinstalled', () => { state.installPrompt = null; closeSheet(); });
}

function installDismissed() {
  try {
    const raw = JSON.parse(localStorage.getItem(INSTALL_KEY) || 'null');
    return raw && Date.now() - raw.dismissedAt < 7 * 86400000;
  } catch { return false; }
}
function dismissInstall() {
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify({ dismissedAt: Date.now() })); } catch { /* 다음에 또 묻는다 */ }
  closeSheet();
}

/* 처음 열 때 한 번 — 휴대폰은 아래 판으로. 넓은 화면은 오늘의 작은 카드(installCard)로. */
function maybeOfferInstall() {
  if (state.installOffered || state.sheet || !state.me || state.viewing || AX_EMBEDDED || AX_EXTERNAL) return;
  if (isStandalone() || installDismissed() || currentLayout() !== 'single') return;
  state.installOffered = true;
  setTimeout(() => { if (!state.sheet) openSheet({ type: 'install' }); }, 600);
}

function installCard(layout) {
  if (layout === 'single' || AX_EMBEDDED || AX_EXTERNAL || state.viewing || isStandalone() || installDismissed()) return null;
  return h('section', { class: 'card install-card' },
    h('span', { class: 'row-body' }, h('b', null, '시간표를 앱으로 받기'), h('span', { class: 'muted' }, '바로 열리고, 바뀐 수업을 빨리 봐요')),
    h('button', { class: 'btn is-quiet', type: 'button', onclick: dismissInstall }, '나중에'),
    h('button', { class: 'btn is-key', type: 'button', onclick: () => openSheet({ type: 'install' }) }, '받기'));
}

function installSheet() {
  const later = h('button', { class: 'btn is-quiet', type: 'button', onclick: dismissInstall }, '나중에');
  const lead = h('p', { class: 'muted' }, '홈 화면에서 바로 열리고, 바뀐 수업을 빨리 봐요.');
  if (isInApp()) {
    const url = location.href.split('#')[0];
    return {
      title: '시간표를 앱으로 받기',
      content: [h('p', null, `${isKakao() ? '카카오톡' : '이 앱'} 안에서는 설치할 수 없어요. 브라우저에서 먼저 열어 주세요.`),
        !isKakao() && h('p', { class: 'muted' }, '오른쪽 위 ⋯ → «다른 브라우저로 열기»')],
      footer: [later, isKakao() && h('a', { class: 'btn is-key', href: `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}` }, icon('open'), '브라우저로 열기')],
    };
  }
  if (isIOS()) {
    return {
      title: '시간표를 앱으로 받기',
      content: [lead, h('ol', { class: 'steps' },
        h('li', null, icon('share'), h('span', null, '사파리 아래쪽 ', h('b', null, '공유 단추'), '를 눌러요')),
        h('li', null, icon('add'), h('span', null, h('b', null, '홈 화면에 추가'), '를 골라요')))],
      footer: [later],
    };
  }
  if (state.installPrompt) {
    return {
      title: '시간표를 앱으로 받기',
      content: [lead],
      footer: [later, h('button', { class: 'btn is-key', type: 'button', onclick: async () => {
        const prompt = state.installPrompt;
        state.installPrompt = null;
        prompt.prompt();
        await prompt.userChoice.catch(() => null);
        closeSheet();
      } }, icon('download'), '설치')],
    };
  }
  return {
    title: '시간표를 앱으로 받기',
    content: [lead, h('p', null, '브라우저 메뉴에서 ', h('b', null, '«앱 설치»'), ' 또는 ', h('b', null, '«홈 화면에 추가»'), '를 눌러요.')],
    footer: [later],
  };
}

/* ── 서비스 워커 ─────────────────────────────────────────────────────
 * 앱 껍데기와 자료를 기기에 둬서 누르자마자 뜨게 한다. 새 버전이 오면 바로 갈아 끼우지
 * 않고 «새 버전이 있어요»를 띄운다 — 보던 화면이 갑자기 바뀌면 고장으로 읽는다.
 */
function registerWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || AX_EMBEDDED || AX_EXTERNAL) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const waitFor = (worker) => worker && worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) { state.swWaiting = worker; render(); }
    });
    if (reg.waiting && navigator.serviceWorker.controller) { state.swWaiting = reg.waiting; render(); }
    reg.addEventListener('updatefound', () => waitFor(reg.installing));
  }).catch(() => { /* 워커가 없어도 앱은 돈다 */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !state.swWaiting) return;
    reloading = true;
    location.reload();
  });
}

/* ── 구글 캘린더 ─────────────────────────────────────────────────────
 * 적어 둔 일정을 **학생 자기 구글 캘린더**에 함께 적는다. 기기를 바꿔도 따라오고,
 * 학생이 이미 쓰는 캘린더 앱에서 알림이 온다. 기기 저장이 원본이고 캘린더는 그 위에 얹는다.
 * 우리가 적은 것만 되받아 온다(extendedProperties.private.hanmin).
 */
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CAL_MARK = 'hanmin-timetable';

const cal = { token: null, until: 0, client: null, denied: false };
const calConnected = () => { try { return localStorage.getItem(CAL_KEY) === '1'; } catch { return false; } };

/**
 * 권한 토큰 받기.
 * `quiet` 면 창을 띄우지 않는다 — 화면을 열자마자 동의 창이 뜨면 학생은 먼저 닫고 본다.
 */
function calToken(quiet) {
  if (cal.token && Date.now() < cal.until) return Promise.resolve(cal.token);
  if (cal.denied && quiet) return Promise.resolve(null);
  return loadGoogle().then((ready) => {
    if (!ready || !window.google || !google.accounts || !google.accounts.oauth2) return null;
    return new Promise((resolve) => {
      if (!cal.client) {
        cal.client = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: CAL_SCOPE,
          callback: (res) => {
            if (res && res.access_token) {
              cal.token = res.access_token;
              cal.until = Date.now() + (Number(res.expires_in || 3600) - 120) * 1000;
              cal.denied = false;
              try { localStorage.setItem(CAL_KEY, '1'); } catch { /* 다음에 다시 묻는다 */ }
            } else {
              cal.denied = true;
            }
            resolve(cal.token && Date.now() < cal.until ? cal.token : null);
          },
          error_callback: () => { cal.denied = true; resolve(null); },
        });
      }
      cal.client.requestAccessToken({ prompt: quiet ? '' : 'consent' });
    });
  }).catch(() => null);
}

/** 일정 하나를 캘린더가 아는 모양으로. 교시가 있으면 그 시각, 없으면 하루 종일. */
function calBody(item) {
  const body = {
    summary: item.title,
    extendedProperties: { private: { hanmin: CAL_MARK, period: String(item.period ?? '') } },
  };
  const slot = (state.school.periods || []).find((p) => p.period === item.period);
  if (item.period && slot && slot.startTime && slot.endTime) {
    body.start = { dateTime: `${item.date}T${slot.startTime}:00`, timeZone: 'Asia/Seoul' };
    body.end = { dateTime: `${item.date}T${slot.endTime}:00`, timeZone: 'Asia/Seoul' };
    body.summary = `${item.period}교시 ${item.title}`;
  } else {
    const next = addDays(parse(item.date), 1);
    body.start = { date: item.date };
    body.end = { date: iso(next) };   // 캘린더의 하루 종일은 끝날을 다음 날로 적는다
  }
  return body;
}

async function calFetch(url, init, quiet) {
  const token = await calToken(quiet);
  if (!token) return null;
  const res = await fetch(url, {
    ...init,
    headers: { ...(init && init.headers), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) { cal.token = null; cal.until = 0; return null; }
  if (!res.ok) return null;
  return res.status === 204 ? {} : res.json();
}

/** 적거나 고친 것을 캘린더에도. 실패하면 기기에만 남는다 — 다음에 다시 올린다. */
async function pushEventToCalendar(item) {
  const saved = await calFetch(
    item.gcalId ? `${CAL_API}/${encodeURIComponent(item.gcalId)}` : CAL_API,
    { method: item.gcalId ? 'PATCH' : 'POST', body: JSON.stringify(calBody(item)) },
    false,
  );
  if (!saved || !saved.id) {
    // 눌렀는데 아무 일도 안 일어나는 화면을 두지 않는다. 안 된 이유와 그래도 남아 있다는 것을 함께 말한다.
    state.calNote = '구글 캘린더에 올리지 못했어요. 일정은 이 기기에 그대로 있어요.';
    render();
    return;
  }
  state.calNote = null;
  const next = state.events.map((row) => (row.id === item.id ? { ...row, gcalId: saved.id } : row));
  saveEvents(next);
  render();
}

async function removeEventFromCalendar(item) {
  if (!item.gcalId) return;
  await calFetch(`${CAL_API}/${encodeURIComponent(item.gcalId)}`, { method: 'DELETE' }, true);
}

/** 캘린더에 있는 것을 이 기기로 가져온다 — 기기를 바꿨을 때 빈 화면으로 시작하지 않게. 조용히. */
async function pullEventsFromCalendar() {
  const from = addDays(new Date(), -30);
  const to = addDays(new Date(), 180);
  const query = new URLSearchParams({
    privateExtendedProperty: `hanmin=${CAL_MARK}`,
    timeMin: `${iso(from)}T00:00:00Z`,
    timeMax: `${iso(to)}T00:00:00Z`,
    singleEvents: 'true',
    maxResults: '250',
  });
  const found = await calFetch(`${CAL_API}?${query}`, { method: 'GET' }, true);
  if (!found || !Array.isArray(found.items)) return;

  const byGcal = new Map(state.events.filter((row) => row.gcalId).map((row) => [row.gcalId, row]));
  const merged = [...state.events];
  for (const remote of found.items) {
    if (byGcal.has(remote.id)) continue;
    const date = (remote.start && (remote.start.date || String(remote.start.dateTime || '').slice(0, 10))) || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const raw = (remote.extendedProperties && remote.extendedProperties.private) || {};
    const period = Number(raw.period) > 0 ? Number(raw.period) : null;
    const title = String(remote.summary || '').replace(/^\d+교시\s*/, '').trim();
    if (!title) continue;
    merged.push({ id: newEventId(), date, period, title, gcalId: remote.id });
  }
  if (merged.length !== state.events.length) {
    saveEvents(merged);
    render();
  }
}

/* ── 로그인 ───────────────────────────────────────────────────────────
 * 구글 로그인으로 «나는 누구»만 확인하고, 창구에서 내 반과 강좌 번호를 받는다.
 */
function loadGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve(true);
  if (loadGoogle.pending) return loadGoogle.pending;
  loadGoogle.pending = new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = 'https://accounts.google.com/gsi/client';
    tag.async = true;
    tag.onload = () => resolve(true);
    tag.onerror = () => resolve(false);   // 학교 망이 막아 둔 경우
    document.head.appendChild(tag);
  });
  return loadGoogle.pending;
}

/*
 * 창구에 묻기. Content-Type 을 text/plain 으로 보내는 것은 실수가 아니다 —
 * application/json 이면 브라우저가 먼저 OPTIONS 를 보내는데 앱스스크립트는 그것을 못 받는다.
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
 * 자료에 없는 번호는 조용히 버린다 — 시간표에 안 잡힌 강좌(방과후 등)일 수 있다.
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
  const slot = h('div', { class: 'gsi' });
  if (AX_EMBEDDED || AX_EXTERNAL || state.busy) {
    slot.appendChild(h('p', { class: 'muted' }, '시간표를 찾는 중입니다…'));
  } else {
    loadGoogle().then((ready) => {
      if (!ready) {
        // 무엇이 막혔고 어떻게 하면 되는지 말한다 — 막다른 길에 아무 말 없이 세워 두지 않는다.
        slot.innerHTML = '';
        slot.append(h('p', null, '로그인 창을 열지 못했습니다. 잠시 뒤 새로고침해 주세요.'),
          h('p', { class: 'muted' }, '학교 와이파이에서 계속 안 되면 담임 선생님께 알려 주세요.'));
        return;
      }
      google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, auto_select: true });
      slot.innerHTML = '';
      google.accounts.id.renderButton(slot, {
        theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline',
        size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 260,
      });
      google.accounts.id.prompt();
    });
  }
  /*
   * «로그인 없이 반 고르기»를 두지 않는다. 그 길로 들어오면 이동수업을 손으로 맞춰야 하고,
   * 틀리게 맞춰 놓고도 맞다고 믿게 된다. 로그인하면 저절로 채워진다.
   */
  return h('div', { class: 'gate' },
    h('div', { class: 'gate-card' },
      h('span', { class: 'gate-icon' }, icon('book')),
      h('h1', null, '내 시간표'),
      h('p', { class: 'muted' }, '학교 구글 계정으로 로그인하세요. 내 반과 이동수업이 한 번에 채워집니다.'),
      slot,
      state.gateError && h('p', { class: 'err' }, state.gateError)));
}

/* ── 교사: 학생 골라 보기 ─────────────────────────────────────────────
 * 학생 화면이 어떻게 보이는지 확인해야 할 때가 있다(문의 대응·점검). 교사 계정으로 들어와
 * 학급·번호로 고른다. 고르는 목록에는 학급·번호·이름뿐이다.
 */
let axConnection = null;
const studentReadCache = createTeacherReadCache();
async function openStudent(target, force = false) {
  state.busy = true; state.gateError = null; render();
  try {
    if (axConnection) await axConnection.ensureFresh();
    const data = await studentReadCache.read(state.teacher.profileId || state.teacher.credential, JSON.stringify([target.classId, target.no]), async (previous) => {
      const request = async () => {
        const res = await fetch(DESK, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'studentView',
            ...(state.teacher.axSession ? { axSession: state.teacher.axSession } : { credential: state.teacher.credential }),
            classId: target.classId,
            no: target.no,
            ...(previous?.version ? { knownVersion: previous.version } : {}),
          }),
        });
        return res.json();
      };
      let data = await request();
      if (!data.ok && axConnection && /AX.*(만료|다시 연결)/.test(data.error || '')) {
        await axConnection.ensureFresh(true);
        data = await request();
      }
      if (data.ok && data.notModified && previous?.version === data.version) return previous;
      if (!data.ok || !data.found) throw new Error(data.error || '학생 자료를 찾지 못했습니다.');
      return data;
    }, { force });
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
  const roster = state.teacher.roster;
  const classes = [...new Set(roster.map((r) => r.classId))];
  return h('div', { class: 'gate is-wide' },
    h('div', { class: 'gate-card is-wide' },
      h('h1', null, '학생 시간표 보기'),
      h('p', { class: 'muted' }, '학급을 고르고 학생을 고르면 그 학생이 보는 화면이 그대로 나옵니다.'),
      state.busy ? h('p', { class: 'muted' }, '가져오는 중입니다…') : [
        state.gateError && h('p', { class: 'err' }, state.gateError),
        h('div', { class: 'pick-grid' }, classes.map((id) => h('button', { type: 'button', class: state.pickClass === id ? 'is-on' : null,
          onclick: () => { state.pickClass = state.pickClass === id ? null : id; render(); } }, id))),
        state.pickClass && h('div', { class: 'pick-grid names' }, roster.filter((x) => x.classId === state.pickClass)
          .map((r) => h('button', { type: 'button', onclick: () => openStudent(r) }, `${r.no}. ${r.name || '(이름 없음)'}`))),
        h('button', { class: 'btn is-quiet', type: 'button', onclick: () => {
          studentReadCache.clear();
          state.teacher = null; state.viewing = null; state.pickClass = null;
          if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
          render();
        } }, '로그아웃'),
      ]));
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
      // 로그인은 됐는데 명단에 없다. 스스로 고르게 하지 않는다 — 누구에게 말해야 하는지 알려 준다.
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

boot().then(async () => {
  if (!AX_EMBEDDED && !AX_EXTERNAL) return;
  if (AX_EMBEDDED) document.documentElement.classList.add('ax-embedded');
  axConnection = await connectAxStudentApp(async (ticket, { renewing }) => {
    const response = await fetch(DESK, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'axLogin', ticket, renewOnly: renewing }) });
    const data = await response.json();
    if (!data.ok || data.role !== 'teacher' || !data.sessionToken || !data.profileId) throw Error('교사 연결 실패');
    if (renewing) {
      if (state.teacher?.profileId !== data.profileId) throw Error('로그인 계정이 변경되었습니다. AX에서 다시 열어 주세요.');
      state.teacher.axSession = data.sessionToken;
    } else {
      state.teacher = { axSession: data.sessionToken, profileId: data.profileId, roster: data.roster || [] }; state.me = null; state.gateError = null; render();
    }
    return { expiresIn: data.expiresIn };
  });
});

/** Teacher data stays in this window only; scope is the current verified identity. */
function createTeacherReadCache({ ttl = 60_000, limit = 32, now = Date.now } = {}) {
  let owner;
  const entries = new Map();
  function clear() { entries.clear(); owner = undefined; }
  async function read(scope, key, loadValue, { force = false } = {}) {
    if (!scope) throw new Error('로그인 상태를 확인해 주세요.');
    if (scope !== owner) { clear(); owner = scope; }
    const hit = entries.get(key);
    if (!force && hit && (hit.pending || hit.expires > now())) return structuredClone(await hit.promise);
    if (hit) entries.delete(key);
    while (entries.size >= limit) entries.delete(entries.keys().next().value);
    const entry = { pending: true, expires: 0, promise: null };
    entry.promise = Promise.resolve().then(() => loadValue(hit && !hit.pending ? structuredClone(hit.value) : undefined)).then((value) => {
      entry.pending = false; entry.expires = now() + ttl; entry.value = structuredClone(value);
      return structuredClone(value);
    }).catch((error) => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return structuredClone(await entry.promise);
  }
  return { read, clear };
}

// In-memory credentials, renewed on demand through the original AX window only.
async function connectAxStudentApp(login) {
 const params=new URLSearchParams(location.search);
 const embedded=params.get('axEmbed')==='1'&&window.parent!==window;
 const host=embedded?window.parent:params.get('axExternal')==='1'?window.opener:null;
 if(!host)return false;
 const origin='https://ax.hanmin.hs.kr';
 if(embedded)document.documentElement.classList.add('ax-embedded');
 let nonce='',expiresAt=0,inflight=null,accepted=false,disposed=false,connected=false;
 let timer,timeout,resolve,reject;
 const clear=()=>{clearInterval(timer);clearTimeout(timeout);};
 const fail=error=>{clear();const done=reject;inflight=null;resolve=reject=null;done?.(error);};
 const announce=()=>host.postMessage({type:'ax-student-app:ready',nonce},origin);
 const ensureFresh=(force=false)=>{
  if(disposed)return Promise.reject(Error('AX 연결을 다시 열어 주세요.'));
  if(inflight)return inflight;
  if(!force&&Date.now()<expiresAt-60_000)return Promise.resolve();
  if(host.closed)return Promise.reject(Error('AX 창에서 다시 연결해 주세요.'));
  nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');accepted=false;
  inflight=new Promise((yes,no)=>{resolve=yes;reject=no;});
  timer=setInterval(announce,1000);
  timeout=setTimeout(()=>fail(Error('AX 연결이 지연되고 있습니다. 다시 시도해 주세요.')),30000);
  announce();return inflight;
 };
 async function receive(event){
  if(event.source!==host||event.origin!==origin||event.data?.nonce!==nonce)return;
  if(event.data.type==='ax-student-app:theme'){document.documentElement.dataset.axTheme=event.data.theme==='dark'?'dark':'light';document.documentElement.dataset.theme=document.documentElement.dataset.axTheme;return;}
  if(!inflight||accepted||event.data.type!=='ax-student-app:ticket'||! /^[a-f0-9]{64}$/.test(event.data.ticket??''))return;
  accepted=true;clearInterval(timer);
  const requestNonce=nonce;
  document.documentElement.dataset.axTheme=event.data.theme==='dark'?'dark':'light';document.documentElement.dataset.theme=document.documentElement.dataset.axTheme;
  try{
   const result=await login(event.data.ticket,{renewing:connected});
   if(disposed||requestNonce!==nonce||!inflight)return;
   const ttl=Number(result?.expiresIn);
   expiresAt=Date.now()+(Number.isFinite(ttl)&&ttl>60?Math.min(ttl,21600):900)*1000;
   connected=true;clear();const done=resolve;inflight=null;resolve=reject=null;
   host.postMessage({type:'ax-student-app:connected',nonce},origin);done?.();
  }catch(error){if(!disposed&&requestNonce===nonce&&inflight){expiresAt=0;host.postMessage({type:'ax-student-app:error',nonce},origin);fail(error);}}
 }
 const dispose=()=>{disposed=true;fail(Error('AX 연결이 종료되었습니다.'));window.removeEventListener('message',receive);};
 window.addEventListener('message',receive);
 void ensureFresh().catch(()=>{});
 return {ensureFresh,dispose};
}
