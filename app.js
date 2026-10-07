const AX_EXTERNAL = new URLSearchParams(location.search).get('axExternal')==='1' && !!window.opener;
const AX_EMBEDDED = new URLSearchParams(location.search).get('axEmbed')==='1' && window.parent!==window;
/*
 * 한민고 학생 AX — 시간표·일정·급식·자리(2026-10-08 «학생 시간표»에서 이름을 바꿨다. 시간표만이 아니다).
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

const VERSION = '20261008-v11';      // index.html 의 ?v= 와 sw.js 의 VERSION 과 같은 값
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
/*
 * 학생용 층(2026-10-07) — 학생 로그인과 «내 것»(강좌·선생님 일정·우리 반 자리). 원본은 Hi-AX, 이 주소는
 * 그 사본을 둔 클라우드플레어 워커다. 앱스 스크립트(DESK)는 교사 로그인과, 이 층이 닿지 않을 때 대비로 남는다.
 */
const HUB = 'https://students.hiax.cloud';
const HUB_KEY = 'hanmin.timetable.hub.v1';
const HUB_TRY_KEY = 'hanmin.timetable.hub-try.v1';
/*
 * 살아 있는 자료(수업 변경·일과표·급식·학사일정)는 학생용 층 /live 에서 받아 기기에 둔다(2026-10-07).
 * 열면 기기의 것으로 바로 그리고, 층에는 «내 지문과 같은가»만 묻는다 — 같으면 수십 바이트.
 * 켜 둔 동안은 2분마다 묻고, 알림이 오면 바로 묻는다. Supabase 는 부르지 않는다.
 */
const LIVE_KEY = 'hanmin.timetable.live.v1';
const PUSH_KEY = 'hanmin.timetable.push.v1';
const LIVE_EVERY = 120_000;
const DATA = 'data/';
/* 오래 열어 둔 앱이 낡은 변경·급식을 보여 주지 않게 — 다시 보일 때 이만큼 지났으면 새로 받는다. */
const REFRESH_AFTER = 10 * 60 * 1000;

/* 창구와 구글 로그인. 학교가 바뀌면 이 두 줄만 고친다. */
const DESK = 'https://script.google.com/macros/s/AKfycbxrSNLXhSMh7MvzV860ebOhVCJY1Pe0mSUSfnvFpXFZL4CE9SFCqFu9myJS19u9FWHr/exec';
const CLIENT_ID = '817402337132-buq4v80hslbv80d2ajteaj8h5664hod2.apps.googleusercontent.com';

const TABS = [
  ['today', '오늘'], ['timetable', '시간표'], ['calendar', '달력'], ['meals', '급식'], ['me', '내 정보'],
];
const MEALS = [['breakfast', '조식'], ['lunch', '중식'], ['dinner', '석식']];

const state = {
  school: null, classes: [], sections: [],
  changes: null, meals: null, calendar: null, abbrev: {},
  hub: null,              // { token, me: { student, sections, events, seats }, savedAt } — 학생용 층
  seatEdit: null,         // 자리배치 맡김 편집 중
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

function readLive() {
  try { const raw = JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); return raw && raw.etag ? raw : null; } catch { return null; }
}
function adoptLive(live) {
  if (live.school && live.school.periods) state.school = live.school;
  if (live.changes) state.changes = live.changes;
  if (live.meals) state.meals = live.meals;
  if (live.calendar) state.calendar = live.calendar;
  state.liveEtag = live.etag;
}

/** 층에 지문만 묻고, 다르면 네 묶음을 받아 기기에 둔다. 돌려주는 값: 바뀌었는지 */
async function refreshLive(timeout = 8000) {
  try {
    const known = state.liveEtag ? `?known=${state.liveEtag}` : '';
    const res = await fetch(`${HUB}/live${known}`, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return false;
    const live = await res.json();
    if (live.unchanged || !live.etag) return false;
    adoptLive(live);
    try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch { /* 이번 화면에서만 */ }
    return true;
  } catch { return false; }
}

async function loadData() {
  const cached = readLive();
  // 기기에 사본이 있으면 정적 사이트의 같은 자료는 받지 않는다 — 층이 안 닿을 때의 대비로만 쓴다
  const names = cached ? ['school.json', 'classes.json', 'sections.json', 'abbrev.json'] : ['school.json', 'classes.json', 'sections.json', 'changes.json', 'meals.json', 'calendar.json', 'abbrev.json'];
  const [files] = await Promise.all([Promise.all(names.map(load)), cached ? null : refreshLive(4000)]);
  const got = Object.fromEntries(names.map((name, i) => [name, files[i]]));
  const { 'classes.json': classes, 'sections.json': sections, 'abbrev.json': abbrev } = got;
  if (!classes) return false;
  state.school = state.school || got['school.json'];
  if (!state.school) return false;
  state.classes = classes.classes || [];
  state.sections = (sections && sections.sections) || [];
  if (cached) adoptLive(cached);
  else if (!state.liveEtag) { state.changes = got['changes.json']; state.meals = got['meals.json']; state.calendar = got['calendar.json']; }
  state.abbrev = (abbrev && abbrev.subjects) || {};
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
  state.hub = !AX_EMBEDDED && !AX_EXTERNAL ? loadHub() : null;
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
  if (state.me && state.hub) refreshHub();
  const liveTick = () => { if (document.visibilityState === 'visible') refreshLive().then((changed) => { if (changed) render(); }); };
  if (readLive()) liveTick();
  setInterval(liveTick, LIVE_EVERY);
  document.addEventListener('visibilitychange', liveTick);
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (event) => { if (event.data && event.data.type === 'live-refresh') liveTick(); });
  else if (state.me && !state.viewing && !AX_EMBEDDED && !AX_EXTERNAL) quietConnect();
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
 * 고른 강좌인가 — 강좌 번호가 있으면 번호로만 본다(2026-10-08).
 *
 * 같은 강좌도 요일마다 맡는 선생님이 번갈아 바뀐다(문학과 영상 127·128, 고급 물리학 132).
 * 열쇠에 교사까지 넣어 대 보니, 고른 강좌인데 선생님이 다른 요일 칸이 공강으로 비었다.
 * 옛 열쇠(번호|과목|교사)를 그대로 기억해 둔 학생도 번호만 맞으면 된다.
 */
const keySection = (key) => String(key || '').split('|')[0];
const isChosen = (sec, key) => !!key && (sec.sectionId != null && keySection(key) !== ''
  ? String(sec.sectionId) === keySection(key)
  : sectionKey(sec) === key);

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
      if (chosen && !isChosen(sec, chosen)) continue;
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
            // 이동수업 자리 열쇠(sec:…) — 교과 선생님이 그 수업 자리를 짜 두면 수업 창에서 본다
            sectionId: sec.sectionId ?? null,
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
/*
 * 과목 약칭 — 주간 표의 좁은 칸에서만 쓴다. 하루 목록·수업 판은 이름 그대로.
 * 데스크탑 «단축어» 표에 있는 것만 줄이고, 없는 과목은 자르지 않고 그대로 둔다(교사웹과 같은 규칙).
 */
const shortName = (subject) => (subject && state.abbrev && state.abbrev[subject]) || subject;

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
  else if (state.seatEdit) app.appendChild(seatEditor());
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
  const school = (state.school.name || '').replace(/등학교$/, '');
  const nav = TABS.map(([key, label]) => h('button', {
    class: `tab${state.tab === key ? ' is-on' : ''}`, type: 'button',
    'aria-current': state.tab === key ? 'page' : null, onclick: () => go(key),
  }, icon(key), h('span', null, label)));
  return h('div', { class: `shell is-${layout}` },
    layout !== 'single' && h('nav', { class: 'rail', 'aria-label': '메뉴' },
      h('div', { class: 'brand', title: state.school.name || '' }, icon('book'), layout === 'dashboard' && h('b', null, school)),
      nav,
      h('span', { class: 'class-chip', title: '내 반' }, state.me.classId)),
    h('div', { class: 'main' },
      layout === 'single' && topbar(),
      state.viewing && viewingBar(),
      state.swWaiting && h('div', { class: 'notice' },
        h('span', null, '새 버전이 있습니다'),
        h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => state.swWaiting.postMessage('skip') }, '새로 고침')),
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
    h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => { state.me = null; state.viewing = null; render(); } }, '다른 학생'),
    h('button', { class: 'btn is-plain is-small', type: 'button', disabled: state.busy, onclick: () => openStudent(state.viewing, true) },
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

/* ── 부품 — Hi-AX kit 의 Card·Row·Badge 와 같은 짜임 ─────────────────── */
function card(title, opts, ...body) {
  const { tail, cls } = opts || {};
  return h('section', { class: `card${cls ? ` ${cls}` : ''}` },
    title && h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, title), tail),
    body);
}

/** 목록 한 줄 — 앞 칸 · 제목 · 보조 · 끝 칸. */
function row({ lead, title, note, extra, tail, onclick, cls, label }) {
  const tails = [tail].flat().filter(Boolean);
  return h(onclick ? 'button' : 'div', {
    class: `row${cls ? ` ${cls}` : ''}`, type: onclick ? 'button' : null, onclick, 'aria-label': label || null,
  },
    lead != null && h('span', { class: 'row-lead' }, lead),
    h('span', { class: 'row-body' },
      h('span', { class: 'row-title' }, title),
      note && h('span', { class: 'row-note' }, note),
      extra),
    tails.length > 0 && h('span', { class: 'row-tail' }, tails));
}

const empty = (text) => h('p', { class: 'empty' }, text);
const linkTo = (label, onclick) => h('button', { class: 'link', type: 'button', onclick }, label, icon('next'));
const periodLead = (top, bottom) => h('span', { class: 'lead-2' }, h('b', null, top), bottom && h('span', null, bottom));

/* ── 오늘 ─────────────────────────────────────────────────────────── */
/*
 * 디데이 → 수업 → 급식. 바뀐 수업은 수업 목록 그 줄에 배지로 — 따로 카드를 두면 같은 것을
 * 두 번 그린다(원칙 8). 지금 수업은 그 줄을 옅게 칠한다.
 */
function todayScreen(layout) {
  const now = today();
  const date = schoolDay(now);
  const weekend = !sameDay(date, now);
  const head = h('div', { class: 'page-head' },
    h('h1', null, fmtDate(date)),
    weekend && h('p', { class: 'muted' }, '다음 수업일'));
  if (layout === 'dashboard') {
    return h('div', { class: 'page' }, head,
      h('div', { class: 'cols is-dash' },
        h('div', { class: 'col' }, installCard(layout), weekGridCard(mondayOf(date), date, '이번 주 시간표')),
        h('div', { class: 'col is-side' }, ddayCard(), seatJobCard(), teacherSoonCard(), newSeatsCard(), mealCard(date), upcomingCard())));
  }
  return h('div', { class: 'page' }, head, ddayCard(), installCard(layout), pushOfferCard(), seatJobCard(), teacherSoonCard(), newSeatsCard(), lessonsCard(date, '수업'), mealCard(date));
}

function rotationNote(date) {
  const day = effectiveDay(date);
  if (day === dayIndex(date) || !DAYS[day]) return null;
  return h('p', { class: 'card-note' }, `${DAYS[day]}요일 시간표로 운영합니다`);
}

/* 디데이 — 오늘과 달력 맨 위. 누르면 고친다. */
function ddayCard() {
  const open = () => openSheet({ type: 'dday' });
  if (!state.dday) {
    return h('button', { class: 'card dday is-empty', type: 'button', onclick: open },
      h('span', { class: 'dday-text' }, h('b', null, '디데이 정하기')), icon('plus'));
  }
  const left = daysUntil(state.dday.date);
  return h('button', { class: 'card dday', type: 'button', 'aria-label': '디데이 고치기', onclick: open },
    h('span', { class: 'dday-text' },
      h('b', null, state.dday.label || '디데이'),
      h('span', { class: 'muted' }, fmtShort(parse(state.dday.date)))),
    h('strong', { class: `dday-num${left === 0 ? ' is-now' : ''}` }, ddayText(left)));
}

const changeLine = (chg) => (chg.kind === 'cancel'
  ? '수업 없음'
  : [chg.origTeacher && chg.teacher ? `${chg.origTeacher} → ${chg.teacher}` : chg.teacher, chg.room].filter(Boolean).join(' · '));

/*
 * 그날 수업 — 교시마다 한 줄. 급식은 넣지 않는다(급식 탭과 «오늘 급식»).
 * 바뀐 것은 배지, 지금은 옅은 칠, 그 수업에 붙인 기록은 한 줄로(원칙 9 — 눌러 봐야 아는 표시는 표시가 아니다).
 */
function lessonsCard(date, title) {
  const changed = myChanges(date).length;
  return card(title, { tail: changed > 0 && badge(`바뀐 수업 ${changed}`, 'warn') },
    rotationNote(date), lessonRows(date), allDayChips(date));
}

function lessonRows(date) {
  const holiday = holidayOn(date);
  if (holiday) return empty(`${holiday.labels.join(' · ')} — 수업 없음`);
  const periods = state.school.periods || [];
  const lessons = lessonsOn(date);
  const chgs = changesOn(date);
  const isToday = sameDay(date, today());
  const t = nowHM();
  return h('div', { class: 'rows' }, periods.map((p) => {
    const c = cellOf(date, p.period, lessons, chgs);
    const records = eventsAt(date, p.period);
    const on = isToday && p.startTime <= t && t < p.endTime && !c.empty;
    return row({
      cls: ['slot', on && 'is-now', c.empty && 'is-free', c.unpicked && 'is-unpicked', c.chg && 'is-chg'].filter(Boolean).join(' '),
      lead: periodLead(`${p.period}교시`, p.startTime),
      title: c.empty ? '공강' : h('span', { class: c.cancelled ? 'is-cut' : null }, c.subject),
      note: c.empty || c.cancelled ? null : c.unpicked ? '강좌 고르기' : c.chg ? changeLine(c.chg) : [c.teacher, c.room].filter(Boolean).join(' · '),
      extra: records.length > 0 && h('span', { class: 'row-mine' }, records.map((item) => item.title).join(' · ')),
      tail: [on && badge('지금', 'accent'), c.chg && badge(c.chg.note, changeTone(c.chg))],
      label: `${p.period}교시 ${c.empty ? '공강' : c.subject}`,
      onclick: () => (c.unpicked ? openSheet({ type: 'picker', band: c.band }) : openSheet({ type: 'lesson', date: iso(date), period: p.period })),
    });
  }));
}

/* 교시 없이 적은 그날 일정 — 수업 목록 아래 한 줄. */
function allDayChips(date) {
  const list = eventsOn(date).filter((item) => item.period === null);
  if (!list.length) return null;
  return h('div', { class: 'chips' }, list.map((item) =>
    h('button', { class: 'chip', type: 'button', onclick: () => openSheet({ type: 'event', draft: { ...item } }) }, item.title)));
}

/* 선생님 일정 — 오늘부터 사흘 안. 없으면 카드를 두지 않는다 */
function teacherSoonCard() {
  const from = iso(today());
  const list = teacherEventsBetween(from, iso(addDays(today(), 3)));
  if (!list.length) return null;
  return card('선생님 일정', { tail: linkTo('달력', () => go('calendar')) },
    h('div', { class: 'rows' }, list.map((item) => row({
      cls: 'is-teacher', lead: item.date === from ? '오늘' : fmtShort(parse(item.date)), title: item.title, note: teacherNote(item),
      tail: icon('next'), onclick: () => openSheet({ type: 'teacherEvent', id: item.id }),
    }))));
}

/* ── 수업 변경 알림 ─────────────────────────────────────────────────
 * 내 수업이 바뀌면 학생용 층이 이 기기로 알림을 보낸다(웹 푸시). 알림을 허용해야 하고, 아이폰은 홈 화면에
 * 설치한 앱에서만 된다. 끄면 열 때·켜 둔 동안 받는다.
 */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushOn = () => { try { return !!localStorage.getItem(PUSH_KEY); } catch { return false; } };

function pushRow() {
  if (!pushSupported()) {
    return row({ title: '이 기기에서는 받을 수 없습니다', note: isIOS() && !isStandalone() ? '홈 화면에 앱을 설치하면 받을 수 있습니다' : '열 때마다 바뀐 수업을 받습니다' });
  }
  if (Notification.permission === 'denied') return row({ title: '알림이 막혀 있습니다', note: '기기 설정에서 이 앱의 알림을 허용합니다' });
  const on = pushOn();
  return row({
    title: on ? '켜짐' : '꺼짐', note: state.pushNote || (on ? '내 수업이 바뀌면 바로 알립니다' : '내 수업이 바뀌면 바로 알려 받습니다'),
    tail: h('button', { class: `btn ${on ? 'is-plain' : 'is-key'} is-small`, type: 'button', disabled: state.pushBusy ? true : null, onclick: on ? pushOff : pushOnNow }, on ? '끄기' : '켜기'),
  });
}

function pushOfferCard() {
  if (!state.hub || state.viewing || !pushSupported() || pushOn() || Notification.permission === 'denied') return null;
  try { if (localStorage.getItem(`${PUSH_KEY}.later`)) return null; } catch { return null; }
  return card(null, null, h('div', { class: 'rows' }, row({
    title: '수업이 바뀌면 바로 알림', note: '보강·교체가 생기면 이 기기로 알립니다',
    tail: [h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => { try { localStorage.setItem(`${PUSH_KEY}.later`, '1'); } catch { /* 다음에 또 */ } render(); } }, '나중에'),
      h('button', { class: 'btn is-key is-small', type: 'button', onclick: pushOnNow }, '켜기')],
  })));
}

function keyBytes(text) {
  const base = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base.padEnd(Math.ceil(base.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

async function pushOnNow() {
  state.pushBusy = true; render();
  try {
    if (await Notification.requestPermission() !== 'granted') return;
    const [reg, keyRes] = await Promise.all([navigator.serviceWorker.ready, fetch(`${HUB}/push/key`)]);
    const { key } = await keyRes.json();
    if (!key) throw new Error('알림 준비가 안 됐습니다.');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await hubCall('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    localStorage.setItem(PUSH_KEY, sub.endpoint);
  } catch (error) {
    state.pushNote = String((error && error.message) || '알림을 켜지 못했습니다.');
  } finally {
    state.pushBusy = false; render();
  }
}

async function pushOff() {
  state.pushBusy = true; render();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await hubCall('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* 이 기기에서는 끈 것으로 */ }
  try { localStorage.removeItem(PUSH_KEY); } catch { /* 없음 */ }
  state.pushBusy = false; render();
}

/* 자리배치를 맡았을 때 — 아직 안 냈거나 돌려받았으면 오늘에 */
function seatJobCard() {
  const job = hubMe() && hubMe().delegation;
  if (!job || (job.submission && job.submission.status !== 'returned')) return null;
  return card(null, null, h('div', { class: 'rows' }, row({
    title: job.submission ? '자리배치를 돌려받았습니다' : '자리배치를 맡았습니다', note: delegationNote(job),
    tail: icon('next'), onclick: openSeatEditor,
  })));
}

function delegationNote(job) {
  const sub = job.submission;
  if (!sub) return job.roomLocked ? '친구들 자리를 정해 담임 선생님께 냅니다' : '책상과 자리를 정해 담임 선생님께 냅니다';
  if (sub.status === 'submitted') return '냈습니다 · 담임 선생님이 확인합니다';
  if (sub.status === 'applied') return '담임 선생님이 적용했습니다';
  return sub.note ? `돌려받음 · ${sub.note}` : '돌려받음 · 고쳐서 다시 냅니다';
}

/* 새 자리 — 시작일 앞뒤 사흘만 오늘에 띄운다. 그 밖에는 내 정보에서 */
function newSeatsCard() {
  const plan = seatPlanNow();
  if (!plan) return null;
  const gap = daysUntil(plan.effectiveFrom);
  if (gap < -3 || gap > 3) return null;
  return card(null, null, h('div', { class: 'rows' }, row({
    title: gap > 0 ? '새 자리가 정해졌습니다' : '자리가 바뀌었습니다',
    note: `${fmtShort(parse(plan.effectiveFrom))}부터`,
    tail: icon('next'), onclick: () => openSheet({ type: 'seats' }),
  })));
}

/* 오늘 급식 — 시간표와 떨어진 카드. 끼니마다 한 줄로 줄인다. */
function mealCard(date) {
  const day = state.meals && state.meals.days && state.meals.days[iso(date)];
  const times = state.school.mealTimes || {};
  const items = MEALS.map(([key, label]) => ({ label, time: times[key], lines: menuLines(day && day[key]) }))
    .filter((m) => m.lines.length);
  return card(sameDay(date, today()) ? '오늘 급식' : `${fmtShort(date)} 급식`,
    { tail: linkTo('이번 주 급식', () => { state.mealDay = date; go('meals'); }) },
    items.length === 0
      ? empty(state.meals ? '등록된 식단이 없습니다.' : '급식 자료가 아직 없습니다.')
      : h('div', { class: 'rows' }, items.map((m) => row({
          lead: periodLead(m.label, m.time),
          title: h('span', { class: 'menu-line' }, m.lines.join(' · ')),
        }))));
}

const menuLines = (items) => (Array.isArray(items) ? items : typeof items === 'string' && items ? [items] : []);

/* 다가오는 일정 — 학사일정과 내 일정을 한 줄로(갈래는 앞 칸 색으로). */
function upcomingCard(withLink = true) {
  const from = iso(today());
  const school = upcomingSchool(from).map((day) => ({ date: day.date, text: day.labels.join(' · '), kind: day.kind }));
  const mine = state.events.filter((item) => item.date >= from)
    .map((item) => ({ date: item.date, text: item.period ? `${item.period}교시 ${item.title}` : item.title, kind: 'mine', item }));
  const teacher = teacherEventsBetween(from, '9999-12-31').map((item) => ({ date: item.date, text: item.title, kind: 'teacher', teacherId: item.id }));
  const soon = [...school, ...teacher, ...mine].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  return card('다가오는 일정', { tail: withLink && linkTo('달력', () => go('calendar')) },
    soon.length === 0
      ? empty(state.calendar ? '다가오는 일정이 없습니다.' : '학사일정 자료가 아직 없습니다.')
      : h('div', { class: 'rows' }, soon.map((item) => row({
          cls: `is-${item.kind}`,
          lead: fmtShort(parse(item.date)),
          title: item.text,
          onclick: () => openSheet(item.teacherId ? { type: 'teacherEvent', id: item.teacherId } : item.item ? { type: 'event', draft: { ...item.item } } : { type: 'school', date: item.date }),
        }))));
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
      [['list', '하루'], ['grid', '주간']].map(([key, label]) => h('button', {
        type: 'button', class: view === key ? 'is-on' : null, 'aria-pressed': String(view === key),
        onclick: () => { savePrefs({ ttview: key }); render(); },
      }, label))));
  const nav = weekNav(mon, 4, (n) => { state.week = addDays(mon, n * 7); state.listDay = null; render(); });
  const main = view === 'list'
    ? h('div', { class: 'stack' }, dayChips(mon, 5, state.listDay, (d) => { state.listDay = d; render(); }),
        lessonsCard(state.listDay, fmtDate(state.listDay)))
    : weekGridCard(mon, null, null);
  const side = [weekChangesCard(mon), myCoursesCard()];
  if (layout === 'dashboard') {
    return h('div', { class: 'page' }, head, nav, h('div', { class: 'cols is-dash' }, h('div', { class: 'col' }, main), h('div', { class: 'col is-side' }, side)));
  }
  return h('div', { class: 'page' }, head, nav, main, side);
}

function weekNav(mon, span, move) {
  const thisMon = mondayOf(schoolDay(today()));
  const thisWeek = sameDay(mon, thisMon);
  return h('div', { class: 'week-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '지난주', onclick: () => move(-1) }, icon('back')),
    h('b', null, fmtRange(mon, span)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '다음 주', onclick: () => move(1) }, icon('next')),
    !thisWeek && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => move(Math.round((thisMon - mon) / (7 * 86400000))) }, '이번 주'));
}

function dayChips(mon, count, selected, pick) {
  return h('div', { class: 'day-chips' }, Array.from({ length: count }, (_, i) => {
    const d = addDays(mon, i);
    const on = selected && sameDay(d, selected);
    const mark = count === 5 && myChanges(d).length > 0;
    return h('button', { type: 'button', class: `day-chip${on ? ' is-on' : ''}${sameDay(d, today()) ? ' is-today' : ''}${holidayOn(d) ? ' is-off' : ''}`,
      'aria-pressed': String(Boolean(on)), 'aria-label': `${d.getMonth() + 1}월 ${d.getDate()}일${mark ? ' · 바뀐 수업 있음' : ''}`, onclick: () => pick(d) },
      h('span', null, WEEK[d.getDay()]), h('b', null, String(d.getDate())), mark && h('i', { class: 'dot is-warn' }));
  }));
}

/*
 * 주간 시간표. 급식 줄은 두지 않는다. 좁은 칸에는 과목과 선생님만 — 바뀐 수업과 내 기록은
 * 점으로(원칙 9: 읽을 수 없는 글자는 넣지 않는다). 칸을 누르면 그 수업이 열린다.
 */
function weekGridCard(mon, focus, title) {
  const periods = state.school.periods || [];
  const days = [0, 1, 2, 3, 4].map((i) => {
    const date = addDays(mon, i);
    return { date, holiday: holidayOn(date), lessons: lessonsOn(date), changes: changesOn(date) };
  });
  const isToday = (d) => sameDay(d, today());
  const t = nowHM();
  const head = h('tr', null, h('th', { class: 'pn' }),
    days.map(({ date }) => h('th', { class: isToday(date) ? 'is-today' : null },
      h('span', null, WEEK[date.getDay()]), h('b', null, String(date.getDate())))));
  const rows = periods.map((p, rowIndex) => h('tr', null,
    h('td', { class: 'pn' }, h('b', null, String(p.period)), h('span', null, p.startTime)),
    days.map(({ date, holiday, lessons, changes }) => {
      if (holiday) {
        return rowIndex === 0 ? h('td', { class: 'off', rowspan: String(periods.length) }, h('b', null, holiday.labels[0]), h('span', null, '수업 없음')) : null;
      }
      const c = cellOf(date, p.period, lessons, changes);
      if (c.empty) return h('td', { class: 'free' });
      const records = eventsAt(date, p.period);
      const on = isToday(date) && p.startTime <= t && t < p.endTime;
      return h('td', null, h('button', { type: 'button',
        class: ['cell', c.chg && 'is-chg', c.unpicked && 'is-unpicked', on && 'is-now', focus && sameDay(date, focus) && 'is-focus'].filter(Boolean).join(' '),
        'aria-label': `${WEEK[date.getDay()]} ${p.period}교시 ${c.subject}${c.chg ? ` ${c.chg.note}` : ''}${records.length ? ` · 기록 ${records.length}` : ''}`,
        onclick: () => (c.unpicked ? openSheet({ type: 'picker', band: c.band }) : openSheet({ type: 'lesson', date: iso(date), period: p.period })) },
        h('b', { class: c.cancelled ? 'is-cut' : null }, c.unpicked ? c.subject : shortName(c.subject)),
        h('span', null, c.unpicked ? '고르기' : c.teacher || ''),
        (c.chg || records.length > 0) && h('span', { class: 'marks' },
          c.chg && h('i', { class: 'dot is-warn' }), records.length > 0 && h('i', { class: 'dot is-mine' }))));
    })));
  return card(title, { cls: 'grid-card' },
    h('div', { class: 'grid-wrap' }, h('table', { class: 'wk' }, h('thead', null, head), h('tbody', null, rows))),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'dot is-warn' }), '바뀐 수업'),
      h('span', null, h('i', { class: 'dot is-mine' }), '내 기록')));
}

/* 이번 주 바뀐 수업 — 내 칸에 걸린 것만. 그날 변경을 통째로 늘어놓으면 옆 강좌 보강이 샌다. */
function weekChangesCard(mon) {
  const list = [0, 1, 2, 3, 4].flatMap((i) => myChanges(addDays(mon, i)).map((chg) => ({ ...chg, date: addDays(mon, i) })));
  return card('이번 주 바뀐 수업', null,
    !state.changes ? empty('수업 변경 자료가 아직 없습니다.')
      : list.length === 0 ? empty('바뀐 수업이 없습니다.')
        : h('div', { class: 'rows' }, list.map((chg) => row({
            lead: `${WEEK[chg.date.getDay()]} ${chg.period}교시`,
            title: chg.kind === 'cancel' ? (chg.lesson && chg.lesson.subject) || '' : chg.subject || '',
            note: changeLine(chg),
            tail: badge(chg.note, changeTone(chg)),
            onclick: () => openSheet({ type: 'lesson', date: iso(chg.date), period: chg.period }),
          }))));
}

/* 내 강좌 — 이동수업마다 어느 강좌를 듣는지. 누르면 바꾼다. */
function myCoursesCard() {
  const bands = [...bandsOfMyClass().entries()];
  if (!bands.length) return null;
  return card('내 강좌', null, h('div', { class: 'rows' }, bands.map(([band, list]) => {
    const chosen = list.find((sec) => isChosen(sec, state.me.sections[band]));
    return row({
      title: chosen ? chosen.subject : '강좌 고르기',
      note: chosen ? [chosen.teacher, chosen.room].filter(Boolean).join(' · ') : null,
      tail: icon('next'),
      onclick: () => openSheet({ type: 'picker', band }),
    });
  })));
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
    !state.meals ? card(null, null, empty('급식 자료가 아직 없습니다.'))
      : !menu ? card(null, null, empty('등록된 식단이 없습니다.'))
        : h('div', { class: `meal-grid${layout === 'single' ? '' : ' is-wide'}` }, MEALS.map(([key, label]) => {
            const lines = menuLines(menu[key]);
            return card(label, { tail: times[key] && h('span', { class: 'muted' }, times[key]), cls: 'meal' },
              lines.length ? h('ul', { class: 'menu' }, lines.map((line) => h('li', null, line))) : empty('없습니다.'));
          })));
}

/* ── 달력 ─────────────────────────────────────────────────────────── */
function calendarScreen(layout) {
  state.month = state.month || new Date(today().getFullYear(), today().getMonth(), 1);
  state.selDate = state.selDate || today();
  const head = h('div', { class: 'page-head' }, h('h1', null, '달력'));
  const month = monthCard(state.month);
  const side = [dayDetailCard(state.selDate), upcomingCard(false), myEventsCard()];
  if (layout === 'single') return h('div', { class: 'page' }, head, ddayCard(), month, side);
  return h('div', { class: 'page' }, head, ddayCard(),
    h('div', { class: 'cols is-dash' }, h('div', { class: 'col' }, month), h('div', { class: 'col is-side' }, side)));
}

/*
 * 달력 칸에는 날짜와 점만. 45px 칸에 행사 이름을 넣으면 «2학기 1…»만 남는다(원칙 9) —
 * 무엇인지는 고른 날의 카드가 바로 아래에서 말한다.
 */
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
      if (outside) { cells.push(h('td', null, h('span', { class: 'day is-out' }, String(date.getDate())))); continue; }
      const school = calendarOn(date);
      const mine = eventsOn(date);
      const teacher = teacherEventsOn(date);
      const changed = isWeekday(date) && myChanges(date).length > 0;
      const off = !isWeekday(date) || (school && school.kind === 'holiday');
      const cls = ['day', off && 'is-off', sameDay(date, today()) && 'is-today', state.selDate && sameDay(date, state.selDate) && 'is-sel'].filter(Boolean).join(' ');
      const said = [school && school.labels.join(' · '), teacher.length && `선생님 일정 ${teacher.length}`, mine.length && `내 일정 ${mine.length}`, changed && '바뀐 수업'].filter(Boolean).join(' · ');
      cells.push(h('td', null, h('button', { type: 'button', class: cls,
        'aria-label': `${date.getMonth() + 1}월 ${date.getDate()}일${said ? ` · ${said}` : ''}`,
        onclick: () => { state.selDate = date; render(); } },
        h('span', { class: 'num' }, String(date.getDate())),
        h('span', { class: 'dots' },
          school && school.kind !== 'holiday' && h('i', { class: 'dot is-school' }),
          teacher.length > 0 && h('i', { class: 'dot is-teacher' }),
          mine.length > 0 && h('i', { class: 'dot is-mine' }),
          changed && h('i', { class: 'dot is-warn' })))));
    }
    if (any) rows.push(h('tr', null, cells));
  }
  return card(`${first.getFullYear()}년 ${first.getMonth() + 1}월`, {
    cls: 'month-card',
    tail: h('div', { class: 'nav-btns' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '지난달', onclick: () => step(-1) }, icon('back')),
      h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => { state.month = null; state.selDate = today(); render(); } }, '오늘'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '다음 달', onclick: () => step(1) }, icon('next'))),
  },
  h('table', { class: 'mo' }, h('thead', null, h('tr', null, WEEK.map((w, i) => h('th', { class: i === 0 ? 'is-sun' : null }, w)))), h('tbody', null, rows)),
  h('div', { class: 'legend' },
    h('span', null, h('i', { class: 'dot is-school' }), '학사일정'),
    hubMe() && h('span', null, h('i', { class: 'dot is-teacher' }), '선생님 일정'),
    h('span', null, h('i', { class: 'dot is-mine' }), '내 일정'),
    h('span', null, h('i', { class: 'dot is-warn' }), '바뀐 수업')));
}

/* 고른 날 — 학사일정(누르면 디데이로 정하기), 내 일정(누르면 고치기), 그날 시간표로 가는 길. */
function dayDetailCard(date) {
  const school = calendarOn(date);
  const mine = eventsOn(date);
  const teacher = teacherEventsOn(date);
  const changed = isWeekday(date) ? myChanges(date) : [];
  return card(fmtShort(date), {
    tail: isWeekday(date) && linkTo('이날 시간표', () => { state.week = mondayOf(date); state.listDay = date; go('timetable'); }),
  },
  (school || mine.length > 0 || changed.length > 0 || teacher.length > 0) ? h('div', { class: 'rows' },
    school && row({ cls: `is-${school.kind}`, lead: '학사', title: school.labels.join(' · '), tail: icon('next'), onclick: () => openSheet({ type: 'school', date: iso(date) }) }),
    teacher.map((item) => row({ cls: 'is-teacher', lead: '선생님', title: item.title, note: teacherNote(item), tail: icon('next'), onclick: () => openSheet({ type: 'teacherEvent', id: item.id }) })),
    changed.map((chg) => row({
      lead: `${chg.period}교시`,
      title: chg.kind === 'cancel' ? (chg.lesson && chg.lesson.subject) || '' : chg.subject || '',
      note: changeLine(chg),
      tail: badge(chg.note, changeTone(chg)),
      onclick: () => openSheet({ type: 'lesson', date: iso(date), period: chg.period }),
    })),
    mine.map((item) => row({ cls: 'is-mine', lead: item.period ? `${item.period}교시` : '종일', title: item.title, tail: icon('next'), onclick: () => openSheet({ type: 'event', draft: { ...item } }) })))
    : empty('일정이 없습니다.'),
  h('div', { class: 'card-foot' },
    h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => openSheet({ type: 'event', draft: { date: iso(date), period: null, title: '' } }) }, icon('plus'), '이날 일정 추가')));
}

/*
 * 내 일정과 구글 캘린더. 캘린더에 못 올린 것이 있으면 그렇게 말한다 — 「저장됐다」고
 * 믿게 두고 기기를 바꾸면 그때 사라진 것을 안다.
 */
function myEventsCard() {
  const local = state.events.filter((item) => !item.gcalId);
  return card('내 일정', null,
    h('div', { class: 'rows' }, row({
      title: '구글 캘린더',
      note: local.length ? `이 기기에만 ${local.length}건` : cal.token ? '연결됨' : '연결 안 됨',
      tail: h('button', { class: 'btn is-plain is-small', type: 'button', onclick: syncCalendar }, local.length ? '올리기' : '연결'),
    })),
    state.calNote && h('p', { class: 'card-note' }, state.calNote));
}

async function syncCalendar() {
  state.calNote = null;
  const token = await calToken(false);
  if (!token) { state.calNote = '구글 캘린더에 연결하지 못했습니다. 일정은 이 기기에 있습니다.'; render(); return; }
  for (const item of state.events.filter((row) => !row.gcalId)) await pushEventToCalendar(item);
  await pullEventsFromCalendar();
  render();
}

/* ── 내 정보 ─────────────────────────────────────────────────────── */
function meScreen() {
  const width = window.innerWidth || 1024;
  const current = currentLayout();
  const [grade, cls] = state.me.classId.split('-');
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, '내 정보')),
    card('계정', null, h('div', { class: 'rows' }, row({
      title: `${grade}학년 ${cls}반`,
      note: state.viewing ? '선생님이 보는 학생 화면' : '학교 구글 계정',
      tail: !state.viewing && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: logout }, '로그아웃'),
    }))),
    !state.viewing && !AX_EMBEDDED && !AX_EXTERNAL && card('우리 반', null, h('div', { class: 'rows' }, state.hub
      ? (() => {
          const plan = seatPlanNow();
          const job = hubMe() && hubMe().delegation;
          return [
            row({
              title: '우리 반 자리', note: plan ? `${fmtShort(parse(plan.effectiveFrom))}부터` : '아직 정해진 자리가 없습니다',
              tail: plan && icon('next'), onclick: plan ? () => openSheet({ type: 'seats' }) : null,
            }),
            job && row({ title: '자리배치 맡김', note: delegationNote(job), tail: icon('next'), onclick: openSeatEditor }),
          ];
        })()
      : row({ title: '학교 계정 연결', note: '선생님 일정과 우리 반 자리를 받습니다', tail: icon('next'), onclick: () => openSheet({ type: 'connect' }) }))),
    state.hub && !state.viewing && !AX_EMBEDDED && !AX_EXTERNAL && card('수업 변경 알림', null, h('div', { class: 'rows' }, pushRow())),
    card('화면 배치', null, h('div', { class: 'options card-pad' },
      [['auto', '자동', 0], ...Object.entries(LAYOUTS).map(([key, v]) => [key, v.label, v.min])].map(([key, label, min]) => {
        const blocked = width < min;
        const on = state.prefs.layout === key;
        return h('button', { type: 'button', class: `option${on ? ' is-on' : ''}`, disabled: blocked,
          'aria-pressed': String(on), onclick: () => { savePrefs({ layout: key }); render(); } },
          h('span', { class: `layout-mark is-${key}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('b', null, label),
          (blocked || key === 'auto') && h('span', { class: 'muted' }, blocked ? '좁은 화면' : `지금 ${LAYOUTS[current].label}`));
      }))),
    card('시간표 보기', null, h('div', { class: 'options is-two card-pad' },
      [['list', '하루'], ['grid', '주간']].map(([key, label]) => {
        const on = ttView() === key;
        return h('button', { type: 'button', class: `option${on ? ' is-on' : ''}`, 'aria-pressed': String(on), onclick: () => { savePrefs({ ttview: key }); render(); } },
          h('b', null, label));
      }))),
    !AX_EMBEDDED && !AX_EXTERNAL && card('앱', null, h('div', { class: 'rows' }, isStandalone()
      ? row({ title: '앱으로 쓰는 중' })
      : row({ title: '앱으로 받기', note: '홈 화면에서 바로 열립니다', tail: icon('next'), onclick: () => openSheet({ type: 'install' }) }))),
    h('p', { class: 'foot' }, ['화면 설정은 이 기기에만 저장됩니다', dataNote()].filter(Boolean).join(' · ')));
}

/* 자료가 언제 것인지 — 경고처럼 띄우지 않고 내 정보 맨 아래에 한 줄. */
function dataNote() {
  if (!state.loadedAt) return '';
  const d = new Date(state.loadedAt);
  return `시간표 ${d.getMonth() + 1}.${d.getDate()} 발행`;
}

function logout() {
  localStorage.removeItem(KEY);
  if (state.hub && pushOn()) pushOff();
  if (state.hub) {
    fetch(`${HUB}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${state.hub.token}` } }).catch(() => {});
    saveHub(null);
  }
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
    h('div', { class: 'sheet-head' },
      h('div', { class: 'sheet-titles' }, h('h2', null, body.title), body.sub && h('p', { class: 'muted' }, body.sub)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: closeSheet }, icon('close'))),
    h('div', { class: 'sheet-body' }, body.content),
    body.footer && h('div', { class: 'sheet-foot' }, body.footer));
  root.append(h('div', { class: 'scrim', onclick: closeSheet }), panel);
  if (fresh) {
    const target = panel.querySelector('[autofocus]') || panel;
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
  if (body.after) requestAnimationFrame(body.after);
}

function sheetBody(spec) {
  switch (spec.type) {
    case 'dday': return ddaySheet();
    case 'lesson': return lessonSheet(parse(spec.date), spec.period);
    case 'event': return eventSheet(spec.draft);
    case 'school': return schoolSheet(spec.date);
    case 'picker': return pickerSheet(spec.band);
    case 'install': return installSheet();
    case 'teacherEvent': return teacherEventSheet(spec.id);
    case 'seats': return seatsSheet();
    case 'lessonSeats': return lessonSeatsSheet(spec.lessonId, spec.date);
    case 'connect': return connectSheet();
    default: return null;
  }
}

function field(label, input) {
  return h('label', { class: 'field' }, h('span', null, label), input);
}
const subTitle = (text) => h('h3', { class: 'sub-title' }, text);

/* 디데이 — 학사일정에서 고르거나 직접 적는다. */
function ddaySheet() {
  const name = h('input', { type: 'text', maxlength: '20', placeholder: '기말고사', value: state.dday ? state.dday.label : '' });
  const when = h('input', { type: 'date', value: state.dday ? state.dday.date : '' });
  const upcoming = upcomingSchool(iso(today()), 5);
  return {
    title: '디데이',
    content: [
      upcoming.length > 0 && [subTitle('학사일정에서 고르기'), h('div', { class: 'rows is-boxed' }, upcoming.map((day) => row({
        cls: state.dday && state.dday.date === day.date ? 'is-on' : null,
        lead: fmtShort(parse(day.date)), title: day.labels.join(' · '),
        onclick: () => { name.value = day.labels[0]; when.value = day.date; },
      })))],
      subTitle('직접 적기'),
      field('이름', name), field('날짜', when),
    ],
    footer: [
      state.dday && h('button', { class: 'btn is-plain', type: 'button', onclick: () => { saveDday(null); closeSheet(); } }, '디데이 끄기'),
      h('button', { class: 'btn is-key', type: 'button', onclick: () => {
        if (!when.value) { when.focus(); return; }
        saveDday({ label: name.value.trim(), date: when.value });
        closeSheet();
      } }, '저장'),
    ],
  };
}

/* 수업 — 선생님·교실, 바뀐 것, 이동수업이면 강좌 바꾸기, 그 수업에 붙인 기록. */
function lessonSheet(date, period) {
  const p = (state.school.periods || []).find((x) => x.period === period);
  const c = cellOf(date, period, lessonsOn(date), changesOn(date));
  const records = eventsAt(date, period);
  const lessonSeat = c.lesson && c.lesson.kind === 'section' && c.lesson.sectionId != null ? lessonSeatPlanOn(`sec:${c.lesson.sectionId}`, iso(date)) : null;
  return {
    title: c.empty ? `${period}교시 공강` : c.subject,
    sub: `${fmtShort(date)} · ${period}교시${p ? ` · ${p.startTime}–${p.endTime}` : ''}`,
    content: [
      !c.empty && !c.cancelled && [c.teacher, c.room].some(Boolean) && h('p', { class: 'sheet-line' }, [c.teacher, c.room].filter(Boolean).join(' · ')),
      c.chg && h('p', { class: 'sheet-line' }, badge(c.chg.note, changeTone(c.chg)), h('span', null, changeLine(c.chg))),
      c.lesson && c.lesson.kind === 'section' && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => openSheet({ type: 'picker', band: c.lesson.band }) }, '강좌 바꾸기'),
      lessonSeat && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => openSheet({ type: 'lessonSeats', lessonId: lessonSeat.lessonId, date: iso(date) }) },
        lessonSeat.mine ? '이 수업 내 자리' : '이 수업 자리'),
      subTitle('수업 기록'),
      records.length
        ? h('div', { class: 'rows is-boxed' }, records.map((item) => row({ cls: 'is-mine', title: item.title, tail: icon('next'), onclick: () => openSheet({ type: 'event', draft: { ...item } }) })))
        : empty('아직 기록이 없습니다.'),
    ],
    footer: [h('button', { class: 'btn is-key', type: 'button', onclick: () => openSheet({ type: 'event', draft: { date: iso(date), period, title: '' } }) }, icon('plus'), '기록 추가')],
  };
}

/*
 * 내 일정·수업 기록 적기. 교시를 고르면 그 수업에 붙고, 종일이면 그날의 일정이 된다.
 * 교시는 폰 기본 선택창(까만 휠) 대신 우리가 그린 단추로 고른다(원칙 11).
 */
function eventSheet(draft) {
  const title = h('input', { type: 'text', maxlength: '40', placeholder: '수행평가, 준비물', value: draft.title || '', autofocus: true });
  const when = h('input', { type: 'date', value: draft.date || iso(today()) });
  let period = draft.period ?? null;
  const choices = [null, ...(state.school.periods || []).map((p) => p.period)];
  const group = h('div', { class: 'choice', role: 'group', 'aria-label': '교시' });
  const paint = () => {
    group.innerHTML = '';
    group.append(...choices.map((p) => h('button', { type: 'button', class: p === period ? 'is-on' : null, 'aria-pressed': String(p === period),
      onclick: () => { period = p; paint(); } }, p === null ? '종일' : `${p}교시`)));
  };
  paint();
  return {
    title: draft.id ? '일정 고치기' : draft.period ? '수업 기록' : '일정 추가',
    content: [field('내용', title), field('날짜', when), h('div', { class: 'field' }, h('span', null, '교시'), group),
      state.calNote && h('p', { class: 'card-note' }, state.calNote)],
    footer: [
      draft.id && h('button', { class: 'btn is-plain is-danger', type: 'button', onclick: () => {
        saveEvents(state.events.filter((item) => item.id !== draft.id));
        closeSheet();
        removeEventFromCalendar(draft);
      } }, '삭제'),
      h('button', { class: 'btn is-key', type: 'button', onclick: () => {
        const text = title.value.trim();
        if (!text) { title.focus(); return; }
        if (!when.value) { when.focus(); return; }
        const next = { id: draft.id || newEventId(), date: when.value, period, title: text, gcalId: draft.gcalId || null };
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
  return {
    title: day.labels.join(' · '),
    sub: `${fmtShort(parse(dateKey))} · 학사일정`,
    content: [],
    footer: [h('button', { class: 'btn is-key', type: 'button', onclick: () => { saveDday({ label: day.labels[0], date: dateKey }); closeSheet(); } }, '디데이로 정하기')],
  };
}

/* 선생님 일정 한 건 — 내용 전체, 첨부, «디데이로 정하기» */
function teacherEventSheet(id) {
  const item = ((hubMe() && hubMe().events) || []).find((e) => e.id === id);
  if (!item) return null;
  return {
    title: item.title,
    sub: [fmtShort(parse(item.date)), item.teacher && `${item.teacher} 선생님`].filter(Boolean).join(' · '),
    content: [item.content ? h('p', { class: 'sheet-text' }, item.content) : null, attachmentRows(item)],
    footer: [h('button', { class: 'btn is-key', type: 'button', onclick: () => { saveDday({ label: item.title, date: item.date }); closeSheet(); } }, '디데이로 정하기')],
  };
}

/*
 * 선생님 일정 첨부(10/7) — 누르면 학생용 층에서 5분짜리 주소를 받아 연다. 나에게 온 일정의 파일만 열린다.
 * PDF·그림은 바로 보이고, 한글·오피스 파일은 내려받는다.
 */
/** 선생님 일정 줄 아래 한 줄 — 누가 냈는지, 첨부가 있으면 «첨부 N» (눌러 들어가야 파일이 있는 걸 알면 놓친다) */
const teacherNote = (item) => [item.teacher, (item.attachments || []).length ? `첨부 ${item.attachments.length}` : null].filter(Boolean).join(' · ') || null;
const fileSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1048576).toFixed(1)}MB`);
const OPENS_INLINE = /\.(pdf|png|jpe?g|gif|webp|txt)$/i;
function attachmentRows(item) {
  const files = item.attachments || [];
  if (!files.length) return null;
  return h('div', { class: 'rows is-boxed files' }, files.map((file) => h('button', { class: 'row', type: 'button', onclick: (e) => openAttachment(file, e.currentTarget) },
    h('span', { class: 'row-body' }, h('span', { class: 'row-title' }, file.name), h('span', { class: 'row-note' }, fileSize(file.size))),
    h('span', { class: 'row-tail' }, icon(OPENS_INLINE.test(file.name) ? 'open' : 'download')))));
}
async function openAttachment(file, button) {
  // 주소를 받는 사이 누른 손짓이 끊기면 폰이 새 창을 막는다 — 빈 창을 먼저 열고 주소를 넣는다
  const win = window.open('', '_blank');
  const note = button.querySelector('.row-note');
  if (note) note.textContent = '여는 중…';
  try {
    const { url } = await hubCall(`/files/${file.id}/link`, { method: 'POST' });
    if (win) win.location.href = url; else location.href = url;
    if (note) note.textContent = fileSize(file.size);
  } catch (error) {
    if (win) win.close();
    if (note) note.textContent = error.message || '열지 못했습니다.';
  }
}

/*
 * 우리 반 자리 — 칠판이 위(학생이 앉아서 보는 쪽). 폰에서는 이름이 읽히게 넓혀 옆으로 밀고, 내 자리로
 * 굴려 둔다(계획: «휴대폰은 내 자리 주변을 크게»). 학번·사진은 오지 않는다 — 번호·이름만.
 */
const SEAT_DESKS = { single: { w: 64, h: 46, seats: [[0, 0]] }, pair: { w: 128, h: 46, seats: [[-32, 0], [32, 0]] }, group: { w: 128, h: 92, seats: [[-32, -23], [32, -23], [-32, 23], [32, 23]] } };
const SEAT_FIXTURES = { board: '칠판', lectern: '교탁', door: '문', window: '창', pillar: '기둥' };
function seatMap(plan) {
  const room = plan.room;
  const avail = Math.min((window.innerWidth || 390) - 48, 640);
  const scale = Math.max(avail / room.width, 0.62);
  const px = (v) => `${Math.round(v * scale * 10) / 10}px`;
  const parts = [];
  for (const f of room.fixtures || []) {
    parts.push(h('div', { class: `seatmap-fx is-${f.kind}`, style: `left:${px(f.x - f.w / 2)};top:${px(f.y - f.h / 2)};width:${px(f.w)};height:${px(f.h)}` },
      h('span', null, SEAT_FIXTURES[f.kind] || '')));
  }
  for (const d of room.desks || []) {
    const shape = SEAT_DESKS[d.kind] || SEAT_DESKS.pair;
    parts.push(h('div', { class: 'seatmap-desk', style: `left:${px(d.x)};top:${px(d.y)};width:${px(shape.w)};height:${px(shape.h)};transform:translate(-50%,-50%) rotate(${d.rot}deg)` }));
    const rad = (d.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    shape.seats.forEach(([dx, dy], i) => {
      const id = `${d.id}:${i}`;
      const who = plan.seats[id];
      const mineSeat = plan.mine === id;
      parts.push(h('div', {
        class: `seatmap-seat${who ? '' : ' is-empty'}${mineSeat ? ' is-mine' : ''}`, id: mineSeat ? 'my-seat' : null,
        style: `left:${px(d.x + dx * cos - dy * sin)};top:${px(d.y + dx * sin + dy * cos)};width:${px(60)};height:${px(42)}`,
      // 이동수업 자리는 여러 반이 모인다 — 번호에 반을 함께
      }, who && h('span', { class: 'no' }, who.classId ? `${who.classId} ${who.no ?? ''}` : String(who.no ?? '')), who && h('b', null, who.name)));
    });
  }
  return h('div', { class: 'seatmap-scroll' }, h('div', { class: 'seatmap', style: `width:${px(room.width)};height:${px(room.depth)}` }, parts));
}

/* 이동수업 자리 — 그날 쓰는 것, 없으면 앞으로 쓸 첫 것 */
function lessonSeatPlanOn(lessonId, key) {
  const plans = ((hubMe() && hubMe().lessonSeats) || []).filter((p) => p.lessonId === lessonId);
  return plans.filter((p) => p.effectiveFrom <= key).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    || plans.filter((p) => p.effectiveFrom > key).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    || null;
}

function lessonSeatsSheet(lessonId, date) {
  const plan = lessonSeatPlanOn(lessonId, date);
  if (!plan) return null;
  return {
    title: '이 수업 자리',
    sub: `${fmtShort(parse(plan.effectiveFrom))}부터 · 칠판이 위`,
    content: seatMap(plan),
    after: () => { const mine = document.getElementById('my-seat'); if (mine) mine.scrollIntoView({ block: 'center', inline: 'center' }); },
  };
}

function seatsSheet() {
  const plan = seatPlanNow();
  if (!plan) return null;
  return {
    title: '우리 반 자리',
    sub: `${fmtShort(parse(plan.effectiveFrom))}부터 · 칠판이 위`,
    content: seatMap(plan),
    after: () => { const mine = document.getElementById('my-seat'); if (mine) mine.scrollIntoView({ block: 'center', inline: 'center' }); },
  };
}

/*
 * 학생용 층이 생기기 전에 로그인해 둔 학생 — 열 때 구글 자동 로그인으로 조용히 한 번 잇는다.
 * 구글이 한 번 눌러 달라는 작은 창을 띄울 수 있다. 닫으면 하루 동안은 다시 묻지 않고, 내 정보의
 * «학교 계정 연결»은 늘 남아 있다.
 */
function quietConnect() {
  try {
    const last = Number(localStorage.getItem(HUB_TRY_KEY) || 0);
    if (Date.now() - last < 86_400_000) return;
    localStorage.setItem(HUB_TRY_KEY, String(Date.now()));
  } catch { return; }
  loadGoogle().then((ready) => {
    if (!ready || state.hub) return;
    google.accounts.id.initialize({
      client_id: CLIENT_ID, auto_select: true,
      callback: async (response) => {
        try {
          const hub = await hubLogin(response.credential);
          if (hub.notStudent) return;
          saveHub({ token: hub.token, me: hub.me, savedAt: Date.now() });
          adoptHub(hub.me);
          render();
        } catch { /* 다음에 연다 */ }
      },
    });
    google.accounts.id.prompt();
  });
}

/* ── 자리배치 맡김 — 담임이 지정한 학생들이 함께 고쳐 낸다 ───────────────────
 * 초안은 학생용 층에 반마다 하나다(함께 고친다). 자리는 학번이 아니라 번호로만 오간다.
 * 고정석은 옮기지 못하고(사유는 보이지 않는다), 책상 틀 고정이면 책상은 그대로다.
 * «크게»는 전자칠판에 띄워 학급 회의로 정할 때 — 화면 전체로 키운다.
 */
async function hubCall(path, init = {}) {
  const res = await fetch(`${HUB}${path}`, { ...init, headers: { Authorization: `Bearer ${state.hub.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  let data = {};
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) { const error = new Error(data.error || '처리하지 못했습니다.'); error.status = res.status; error.data = data; throw error; }
  return data;
}

async function openSeatEditor() {
  if (!state.hub) return;
  state.seatEdit = { loading: true, mode: 'seats', picked: null, desk: null, note: null };
  render();
  try {
    const data = await hubCall('/seat-draft');
    const start = data.draft || data.base;
    state.seatEdit = {
      ...state.seatEdit, loading: false, data,
      room: start ? start.room : null, seats: start ? { ...start.seats } : {}, revision: data.draft ? data.draft.revision : undefined,
      dirty: false, saving: false,
    };
  } catch (error) {
    state.seatEdit = { ...state.seatEdit, loading: false, error: String(error.message || error) };
  }
  render();
}

function closeSeatEditor() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  state.seatEdit = null;
  render();
  refreshHub();
}

const lockedSeats = () => new Set((state.seatEdit.data.base && state.seatEdit.data.base.locked) || []);

/** 앞줄부터, 한 줄 안에서는 왼쪽부터(칠판을 볼 때) — Hi-AX lib/class-seats seatOrder 와 같은 규칙 */
function seatPoints(room) {
  return (room.desks || []).flatMap((d) => {
    const shape = SEAT_DESKS[d.kind] || SEAT_DESKS.pair;
    const rad = (d.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    return shape.seats.map(([dx, dy], i) => ({ id: `${d.id}:${i}`, x: d.x + dx * cos - dy * sin, y: d.y + dx * sin + dy * cos }));
  });
}
function seatOrderOf(room) {
  const points = seatPoints(room).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const p of points) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(p.y - last[0].y) < 30) last.push(p); else rows.push([p]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x).map((p) => p.id));
}

function editSeats(next) {
  state.seatEdit.seats = next;
  state.seatEdit.dirty = true;
  queueDraftSave();
  render();
}

let draftTimer = 0;
function queueDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 700);
}
async function saveDraftNow() {
  const edit = state.seatEdit;
  if (!edit || !edit.dirty || edit.saving) return;
  edit.saving = true; edit.dirty = false; render();
  try {
    const saved = await hubCall('/seat-draft', { method: 'PUT', body: JSON.stringify({ room: edit.room, seats: edit.seats, revision: edit.revision }) });
    if (state.seatEdit !== edit) return;
    edit.revision = saved.revision; edit.room = saved.room; edit.seats = saved.seats; edit.note = null;
  } catch (error) {
    if (state.seatEdit !== edit) return;
    if (error.status === 409 && error.data && error.data.draft) {
      const latest = error.data.draft;
      Object.assign(edit, { room: latest.room, seats: latest.seats, revision: latest.revision, note: '다른 친구가 먼저 고쳤습니다. 새 초안을 불러왔습니다.' });
    } else {
      edit.dirty = true;
      edit.note = String(error.message || error);
    }
  } finally {
    edit.saving = false;
    if (state.seatEdit === edit) render();
  }
}

function placeNo(no, seat) {
  const edit = state.seatEdit;
  const locked = lockedSeats();
  if (locked.has(seat)) return;
  const seats = { ...edit.seats };
  const from = Object.keys(seats).find((id) => seats[id] === no) || null;
  if (from && locked.has(from)) return;
  const other = seats[seat];
  if (from) delete seats[from];
  seats[seat] = no;
  if (other != null && from) seats[from] = other;
  editSeats(seats);
}

function fillDraft(shuffle) {
  const edit = state.seatEdit;
  const locked = lockedSeats();
  const seats = {};
  for (const id of locked) if (edit.seats[id] != null) seats[id] = edit.seats[id];
  const placed = new Set(Object.values(seats));
  let rest = edit.data.roster.map((s) => s.no).filter((no) => !placed.has(no)).sort((a, b) => a - b);
  if (shuffle) for (let i = rest.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  for (const id of seatOrderOf(edit.room)) {
    if (seats[id] != null) continue;
    const no = rest.shift();
    if (no == null) break;
    seats[id] = no;
  }
  edit.picked = null;
  editSeats(seats);
}

function editRoom(change) {
  const edit = state.seatEdit;
  edit.room = change(edit.room);
  // 없어진 자리의 학생은 자리 없음으로
  const valid = new Set(seatPoints(edit.room).map((p) => p.id));
  edit.seats = Object.fromEntries(Object.entries(edit.seats).filter(([id]) => valid.has(id)));
  edit.dirty = true;
  queueDraftSave();
  render();
}

function addDraftDesk(kind) {
  editRoom((room) => {
    const used = new Set(room.desks.map((d) => d.id));
    let id; do { id = `s${Math.random().toString(36).slice(2, 7)}`; } while (used.has(id));
    return { ...room, desks: [...room.desks, { id, kind, rot: 0, x: Math.round(room.width / 2), y: Math.round(room.depth - 100) }] };
  });
}

async function submitDraft() {
  const edit = state.seatEdit;
  clearTimeout(draftTimer);
  if (edit.dirty) await saveDraftNow();
  edit.submitting = true; render();
  try {
    const result = await hubCall('/seat-draft/submit', { method: 'POST' });
    edit.data.submission = result.submission;
    if (state.hub && state.hub.me && state.hub.me.delegation) state.hub.me.delegation.submission = result.submission;
    edit.note = '담임 선생님께 냈습니다.';
  } catch (error) {
    edit.note = String(error.message || error);
  } finally {
    edit.submitting = false; render();
  }
}

function toggleBig() {
  const node = document.getElementById('seat-editor');
  if (!document.fullscreenElement && node && node.requestFullscreen) node.requestFullscreen().then(() => render()).catch(() => {});
  else if (document.exitFullscreen) document.exitFullscreen().then(() => render()).catch(() => {});
}

function seatEditor() {
  const edit = state.seatEdit;
  const top = h('header', { class: 'editor-top' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: closeSeatEditor }, icon('back')),
    h('h1', null, '자리배치 맡김'),
    h('span', { class: 'muted editor-status' }, edit.saving ? '저장 중…' : edit.dirty ? '' : edit.revision ? '저장됨' : ''),
    h('button', { class: 'btn is-plain is-small', type: 'button', onclick: toggleBig }, document.fullscreenElement ? '작게' : '크게'));
  if (edit.loading) return h('div', { class: 'editor', id: 'seat-editor' }, top, h('p', { class: 'empty' }, '불러오는 중…'));
  if (edit.error || !edit.room) {
    return h('div', { class: 'editor', id: 'seat-editor' }, top,
      h('p', { class: 'empty' }, edit.error || '담임 선생님이 아직 자리배치를 저장하지 않았습니다.'));
  }
  const data = edit.data;
  const roomLocked = data.roomLocked;
  const mode = roomLocked ? 'seats' : edit.mode;
  const locked = lockedSeats();
  const names = new Map(data.roster.map((s) => [s.no, s.name]));
  const seated = new Set(Object.values(edit.seats));
  const waiting = data.roster.filter((s) => !seated.has(s.no));
  const room = edit.room;
  const big = !!document.fullscreenElement;
  const avail = Math.min((window.innerWidth || 390) - 32, big ? 4000 : 900);
  const scale = Math.max(Math.min(avail / room.width, big ? ((window.innerHeight || 800) - 220) / room.depth : 10), 0.62);
  const px = (v) => `${Math.round(v * scale * 10) / 10}px`;

  const floor = h('div', { class: `seatmap is-edit${mode === 'room' ? ' is-room' : ''}`, style: `width:${px(room.width)};height:${px(room.depth)}` });
  for (const f of room.fixtures || []) {
    floor.append(h('div', { class: `seatmap-fx is-${f.kind}`, style: `left:${px(f.x - f.w / 2)};top:${px(f.y - f.h / 2)};width:${px(f.w)};height:${px(f.h)}` },
      h('span', null, SEAT_FIXTURES[f.kind] || '')));
  }
  for (const d of room.desks || []) {
    const shape = SEAT_DESKS[d.kind] || SEAT_DESKS.pair;
    const group = h('div', { class: `seatmap-group${edit.desk === d.id ? ' is-chosen' : ''}`, style: `left:${px(d.x)};top:${px(d.y)}` });
    group.append(h('div', { class: 'seatmap-desk', style: `left:0;top:0;width:${px(shape.w)};height:${px(shape.h)};transform:translate(-50%,-50%) rotate(${d.rot}deg)` }));
    const rad = (d.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    shape.seats.forEach(([dx, dy], i) => {
      const id = `${d.id}:${i}`;
      const no = edit.seats[id];
      const isLocked = locked.has(id) && no != null;
      const label = no != null ? `${no}번 ${names.get(no) || ''}${isLocked ? ' · 고정' : ''}` : '빈자리';
      group.append(h(mode === 'seats' ? 'button' : 'div', {
        type: mode === 'seats' ? 'button' : null,
        class: `seatmap-seat${no == null ? ' is-empty' : ''}${no != null && edit.picked === no ? ' is-picked' : ''}${isLocked ? ' is-locked' : ''}${data.me && no === data.me.no ? ' is-mine' : ''}`,
        style: `left:${px(dx * cos - dy * sin)};top:${px(dx * sin + dy * cos)};width:${px(60)};height:${px(42)}`,
        'aria-label': label, disabled: mode === 'seats' && isLocked ? true : null,
        onclick: mode === 'seats' ? () => {
          if (isLocked) return;
          if (edit.picked != null) { if (no === edit.picked) edit.picked = null; else { const p = edit.picked; edit.picked = null; placeNo(p, id); return; } }
          else if (no != null) edit.picked = no;
          render();
        } : null,
      }, no != null && h('span', { class: 'no' }, String(no)), no != null && h('b', null, names.get(no) || '')));
    });
    if (mode === 'room') group.addEventListener('pointerdown', (event) => startDeskDrag(event, d.id, scale, group));
    floor.append(group);
  }

  const tools = mode === 'seats'
    ? h('div', { class: 'editor-tools' },
        h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => fillDraft(false) }, '번호순'),
        h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => fillDraft(true) }, '무작위'),
        edit.picked != null && Object.values(edit.seats).includes(edit.picked) && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => {
          const seat = Object.keys(edit.seats).find((id) => edit.seats[id] === edit.picked);
          const seats = { ...edit.seats }; delete seats[seat]; edit.picked = null; editSeats(seats);
        } }, '자리 비우기'))
    : h('div', { class: 'editor-tools' },
        h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => addDraftDesk('pair') }, '2인 책상'),
        h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => addDraftDesk('single') }, '1인 책상'),
        edit.desk && h('button', { class: 'btn is-plain is-small', type: 'button', onclick: () => editRoom((r) => ({ ...r, desks: r.desks.map((d) => d.id === edit.desk ? { ...d, rot: ((d.rot + 90 + 180) % 360) - 180 } : d) })) }, '90° 돌리기'),
        edit.desk && h('button', { class: 'btn is-plain is-small is-danger', type: 'button', onclick: () => { const id = edit.desk; edit.desk = null; editRoom((r) => ({ ...r, desks: r.desks.filter((d) => d.id !== id) })); } }, '책상 빼기'));

  const sub = data.submission;
  return h('div', { class: `editor${big ? ' is-big' : ''}`, id: 'seat-editor' }, top,
    h('div', { class: 'editor-body' },
      !roomLocked && h('div', { class: 'seg', role: 'group', 'aria-label': '고칠 것' },
        [['seats', '학생 자리'], ['room', '책상']].map(([key, label]) => h('button', { type: 'button', class: mode === key ? 'is-on' : null, 'aria-pressed': String(mode === key),
          onclick: () => { edit.mode = key; edit.picked = null; edit.desk = null; render(); } }, label))),
      tools,
      h('p', { class: 'muted editor-hint' }, mode === 'seats' ? '칠판이 위 · 학생을 누르고 앉힐 자리를 누릅니다' : '칠판이 위 · 책상을 끌어 옮깁니다'),
      h('div', { class: 'seatmap-scroll' }, floor),
      mode === 'seats' && h('div', { class: 'editor-waiting' },
        h('h2', { class: 'card-title' }, `자리 없는 친구 ${waiting.length}`),
        waiting.length ? h('div', { class: 'chips' }, waiting.map((s) => h('button', {
          type: 'button', class: `chip${edit.picked === s.no ? ' is-on' : ''}`, 'aria-pressed': String(edit.picked === s.no),
          onclick: () => { edit.picked = edit.picked === s.no ? null : s.no; render(); },
        }, `${s.no} ${s.name}`))) : h('p', { class: 'empty' }, '모두 앉았습니다.')),
      edit.note && h('p', { class: 'card-note' }, edit.note)),
    h('footer', { class: 'editor-foot' },
      h('span', { class: 'muted' }, sub ? delegationNote({ submission: sub }) : '다 정했으면 냅니다'),
      h('button', { class: 'btn is-key', type: 'button', disabled: edit.submitting || edit.saving ? true : null, onclick: submitDraft },
        edit.submitting ? '내는 중…' : sub && sub.status === 'submitted' ? '다시 내기' : '담임 선생님께 내기')));
}

/* 책상 끌기 — 끄는 동안은 그 책상만 움직이고, 놓을 때 초안에 적는다(5cm 눈금) */
function startDeskDrag(event, deskId, scale, node) {
  const edit = state.seatEdit;
  edit.desk = deskId;
  const start = { x: event.clientX, y: event.clientY };
  const desk = edit.room.desks.find((d) => d.id === deskId);
  const origin = { left: parseFloat(node.style.left), top: parseFloat(node.style.top) };
  node.setPointerCapture(event.pointerId);
  let moved = false;
  const move = (e) => {
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    node.style.left = `${origin.left + dx}px`; node.style.top = `${origin.top + dy}px`;
  };
  const up = (e) => {
    node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
    if (!moved) { render(); return; }
    const snap = (v) => Math.round(v / 5) * 5;
    const x = snap(desk.x + (e.clientX - start.x) / scale), y = snap(desk.y + (e.clientY - start.y) / scale);
    editRoom((r) => ({ ...r, desks: r.desks.map((d) => d.id === deskId ? { ...d, x: Math.min(r.width - 32, Math.max(32, x)), y: Math.min(r.depth - 23, Math.max(23, y)) } : d) }));
  };
  node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
}

/* 학생용 층이 생기기 전에 로그인한 학생 — 한 번 더 구글로 확인하면 선생님 일정·자리가 들어온다 */
function connectSheet() {
  const slot = h('div', { class: 'gsi' });
  return {
    title: '학교 계정 연결',
    sub: '선생님 일정과 우리 반 자리를 받습니다',
    content: [slot, state.gateError && h('p', { class: 'err' }, state.gateError)],
    after: () => loadGoogle().then((ready) => {
      if (!ready) { slot.textContent = '로그인 창을 열지 못했습니다. 잠시 뒤 다시 엽니다.'; return; }
      google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onConnect });
      google.accounts.id.renderButton(slot, { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 260 });
    }),
  };
}

async function onConnect(response) {
  state.gateError = null;
  try {
    const hub = await hubLogin(response.credential);
    if (hub.notStudent) { state.gateError = '학생 명단에 없는 계정입니다. 학교 계정으로 다시 고릅니다.'; renderSheet(true); return; }
    saveHub({ token: hub.token, me: hub.me, savedAt: Date.now() });
    adoptHub(hub.me);
    closeSheet();
  } catch (error) {
    state.gateError = String(error.message || error);
    renderSheet(true);
  }
}

/* 강좌 고르기 — 이동수업은 학생마다 다르다. 한 번 고르면 계속 기억한다. */
function pickerSheet(band) {
  const list = bandsOfMyClass().get(band) || [];
  // 강좌 하나에 한 줄 — 요일마다 선생님이 바뀌는 강좌는 선생님을 함께 적는다
  const uniq = new Map();
  for (const sec of list) {
    const id = sec.sectionId ?? sectionKey(sec);
    const found = uniq.get(id);
    if (!found) uniq.set(id, { key: sectionKey(sec), sec, teachers: new Set(sec.teacher ? [sec.teacher] : []) });
    else if (sec.teacher) found.teachers.add(sec.teacher);
  }
  return {
    title: '강좌 고르기',
    content: h('div', { class: 'rows is-boxed' }, [...uniq.values()].map(({ key, sec, teachers }) => {
      const on = isChosen(sec, state.me.sections[band]);
      return row({
        cls: on ? 'is-on' : null,
        title: sec.subject,
        note: [[...teachers].join('·') || '담당 미정', sec.room].filter(Boolean).join(' · '),
        tail: on && badge('듣는 강좌', 'accent'),
        onclick: () => { state.me.sections[band] = key; save(); closeSheet(); },
      });
    })),
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
  return card(null, { cls: 'install-card' }, h('div', { class: 'rows' }, row({
    title: '학생 AX를 앱으로 받기',
    note: '홈 화면에서 바로 열립니다',
    tail: [h('button', { class: 'btn is-plain is-small', type: 'button', onclick: dismissInstall }, '나중에'),
      h('button', { class: 'btn is-key is-small', type: 'button', onclick: () => openSheet({ type: 'install' }) }, '받기')],
  })));
}

function installSheet() {
  const later = h('button', { class: 'btn is-plain', type: 'button', onclick: dismissInstall }, '나중에');
  const sub = '홈 화면에서 바로 열립니다';
  if (isInApp()) {
    const url = location.href.split('#')[0];
    return {
      title: '앱으로 받기', sub,
      content: [h('p', null, `${isKakao() ? '카카오톡' : '이 앱'} 안에서는 설치할 수 없습니다. 브라우저에서 엽니다.`),
        !isKakao() && h('p', { class: 'muted' }, '⋯ 메뉴 → 다른 브라우저로 열기')],
      footer: [later, isKakao() && h('a', { class: 'btn is-key', href: `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}` }, icon('open'), '브라우저로 열기')],
    };
  }
  if (isIOS()) {
    return {
      title: '앱으로 받기', sub,
      content: [h('ol', { class: 'steps' },
        h('li', null, icon('share'), h('span', null, '사파리 아래쪽 ', h('b', null, '공유'))),
        h('li', null, icon('add'), h('span', null, h('b', null, '홈 화면에 추가'))))],
      footer: [later],
    };
  }
  if (state.installPrompt) {
    return {
      title: '앱으로 받기', sub,
      content: [],
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
    title: '앱으로 받기', sub,
    content: [h('p', null, '브라우저 메뉴 → ', h('b', null, '앱 설치'), ' 또는 ', h('b', null, '홈 화면에 추가'))],
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

/* ── 학생용 층 ──────────────────────────────────────────────────────── */
function loadHub() {
  try {
    const raw = JSON.parse(localStorage.getItem(HUB_KEY) || 'null');
    return raw && typeof raw.token === 'string' ? raw : null;
  } catch { return null; }
}

/* 교사가 남의 화면을 보는 중에는 기기에 남기지 않는다 — save() 와 같은 이유 */
function saveHub(value) {
  state.hub = value;
  if (state.viewing) return;
  try {
    if (value) localStorage.setItem(HUB_KEY, JSON.stringify(value));
    else localStorage.removeItem(HUB_KEY);
  } catch { /* 이번 화면에서만 쓴다 */ }
}

/** 학생이면 { token, me }, 명단에 없으면(교사 등) { notStudent }. 닿지 않으면 던진다 — 부르는 쪽이 DESK 로 넘어간다 */
async function hubLogin(credential) {
  const res = await fetch(`${HUB}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  if (res.status === 404 && data.notStudent) return { notStudent: true };
  if (!res.ok || !data.token || !data.me) throw new Error(data.error || '학생 서버에 닿지 못했습니다.');
  return data;
}

/** 열 때마다 조용히 새로 받는다 — 반·강좌가 바뀌었으면(진급·강좌 변경) 따라가고, 일정·자리를 채운다 */
async function refreshHub() {
  if (!state.hub || state.viewing || AX_EMBEDDED || AX_EXTERNAL) return;
  try {
    const res = await fetch(`${HUB}/me`, { headers: { Authorization: `Bearer ${state.hub.token}` } });
    if (res.status === 401) { saveHub(null); render(); return; }
    if (!res.ok) return;
    const me = await res.json();
    adoptHub(me);
    saveHub({ ...state.hub, me, savedAt: Date.now() });
    render();
  } catch { /* 망이 없으면 기기에 둔 것으로 */ }
}

function adoptHub(me) {
  if (!me || !me.student || !me.student.classId) return;
  const sameClass = state.me && state.me.classId === me.student.classId;
  state.me = { classId: me.student.classId, sections: { ...(sameClass ? state.me.sections : {}), ...adoptSections(me.sections) } };
  save();
}

const hubMe = () => (state.hub && state.hub.me) || null;

/** 선생님이 나에게 낸 일정 — 학생관리 › 학생 일정 */
function teacherEventsOn(date) {
  const key = iso(date);
  return ((hubMe() && hubMe().events) || []).filter((e) => e.date === key);
}
function teacherEventsBetween(fromKey, toKey) {
  return ((hubMe() && hubMe().events) || []).filter((e) => e.date >= fromKey && e.date <= toKey);
}

/** 우리 반 자리 — 오늘 쓰는 것, 없으면 가장 가까운 다음 것 */
function seatPlanNow() {
  const plans = (hubMe() && hubMe().seats) || [];
  const key = iso(today());
  return plans.filter((p) => p.effectiveFrom <= key).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    || plans.filter((p) => p.effectiveFrom > key).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0]
    || null;
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
      h('h1', null, '학생 AX'),
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
      h('h1', null, '학생 화면 보기'),
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
    // 학생은 학생용 층으로. 명단에 없거나(교사) 층이 닿지 않으면 종전 창구로 간다
    let hub = null;
    try { hub = await hubLogin(response.credential); } catch { hub = null; }
    if (hub && !hub.notStudent) {
      state.me = { classId: hub.me.student.classId, sections: adoptSections(hub.me.sections) };
      save();
      saveHub({ token: hub.token, me: hub.me, savedAt: Date.now() });
      return;
    }
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
