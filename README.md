# 한민고 학생 시간표

학생이 자기 시간표를 보고, 보강·교체가 생기면 그 자리만 덧칠해 보여주는 정적 사이트.
`timetable.hanmin.hs.kr` 로 서비스한다.

## 이 저장소가 지키는 규칙

**학생 개인정보를 여기에 올리지 않는다.** GitHub Pages 에는 «거절하는 쪽»이 없어서,
올라온 파일은 주소만 알면 누구나 받는다. 로그인을 붙여도 소용없다 — 남의 파일을 받는
사람은 로그인 화면을 지나가지 않는다.

그래서 여기 올라오는 것은 **누가 봐도 되는 것**뿐이다.

| 파일 | 내용 | 개인정보 |
|---|---|---|
| `data/classes.json` | 반별 시간표 | 없음 (교실 벽에 붙는 것) |
| `data/sections.json` | 강좌별 시간표 — **명단 없이 시간만** | 없음 |
| `data/changes.json` | 수업 변경(보강·교체) | 없음 |
| `data/meals.json` | 급식 | 없음 |
| `data/calendar.json` | 학사일정 | 없음 |

«어느 학생이 어느 강좌를 듣는가»는 **여기 올리지 않는다.** 그것만 로그인 뒤에
학교 구글시트(앱스크립트)에서 받아 기기에 저장한다.

### 절대 올리지 않는 것

- 학생 이름·학번·개인 시간표 (`studentTimetables`)
- 강좌별 수강생 명단
- 교사 개인 연락처

## 누가 무엇을 올리나

| 파일 | 올리는 쪽 | 언제 |
|---|---|---|
| `classes.json` · `sections.json` | 데스크탑앱 | 발행할 때 |
| `changes.json` | Supabase 에지 함수 | 수업 변경 승인마다 (약 20초) |
| `meals.json` · `calendar.json` | Supabase 에지 함수 | 하루 / 주 1회 |

학생 기기는 **여기에서만** 받는다. Supabase 주소를 알지 못한다.

## 고칠 때마다 v 를 올린다

`app.js`·`app.css` 를 고쳤으면 `index.html` 의 `?v=` 도 함께 올린다.

깃허브 페이지스는 이 파일들을 10분 동안 브라우저가 붙잡게 한다(`max-age=600`).
주소가 그대로면 고쳐 올려도 그동안은 옛 파일이 돌고, 사람은 «안 고쳐졌다»고 본다 —
실제로 그렇게 한 번 헛돌았다(2026-09-07 «교시가 안 나온다»).

`node smoke-cachebust.mjs` 가 빠뜨린 것을 잡는다.

## 설계 문서

`hanmin-academic-system` 저장소의 `docs/학생-시간표-공개-계획.md`

## DNS 연결 전 임시 주소

`CNAME` 파일을 `CNAME.대기` 로 미뤄 두었다. DNS 가 붙기 전에는 커스텀 도메인으로
301 이 걸려 아무것도 안 보이기 때문이다. 그동안은 아래에서 확인한다.

```
https://pang99x-hub.github.io/hanmin-timetable/
```

**DNS 를 붙인 뒤** `CNAME.대기` 를 `CNAME` 으로 되돌리고 커밋하면 `timetable.hanmin.hs.kr`
로 열린다. 필요한 레코드는 `course` 와 같은 모양이다.

```
timetable.hanmin.hs.kr.   CNAME   pang99x-hub.github.io.
```
