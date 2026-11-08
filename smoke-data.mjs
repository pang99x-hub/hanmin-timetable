/* 연기 시험 공용 자료 — 교사 이름이 든 시간표·수업 변경은 공개 사이트에서 내렸다(2026-11-08).
 * 시험 자료는 내리기 전 판(9ec2736)에서 꺼내고, 앱에는 로그인한 층 응답(/timetable·/live)으로 준다. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = process.env.HOME + '/Documents/hanmin-timetable';
export const dataFile = (n) => {
  try { return fs.readFileSync(`${ROOT}/data/${n}`, 'utf8'); } catch { /* 내린 자료 */ }
  try { return execSync(`git -C "${ROOT}" show 9ec2736:data/${n}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};
/** 로그인한 학생의 층 열쇠 — localStorage 에 넣는다 */
export const HUB_SESSION = ['hanmin.timetable.hub.v1', JSON.stringify({ token: 'smoke'.padEnd(40, 'x') })];
/** /timetable/*.json 요청이면 층 응답, 아니면 null */
export function timetableReply(url) {
  const m = /\/timetable\/(classes|sections)\.json/.exec(String(url));
  return m ? { ok: true, status: 200, json: async () => ({ etag: 'smoke', body: JSON.parse(dataFile(`${m[1]}.json`)) }) } : null;
}
