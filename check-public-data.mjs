// 공개 저장소 문지기(2026-11-08). 이 저장소는 누구나 보고 이력이 영구히 남는다.
// 교사 이름이 붙은 시간표·수업 변경, 학생 정보는 학생용 층에서 로그인한 사람에게만 준다.
// 실행: node check-public-data.mjs   (커밋될 파일 기준, 걸리면 1로 끝난다)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// data/ 에는 공개해도 되는 이 넷만 둔다.
const ALLOWED_DATA = new Set(['data/school.json', 'data/meals.json', 'data/calendar.json', 'data/abbrev.json', 'data/.etag', 'data/.gitkeep']);
// 어느 JSON 에서든 이런 칸이 보이면 사람 정보다.
const PERSON_KEYS = /^(teacher|origTeacher|newTeacher|teacherName|teachers|student|students|studentCode|studentName|studentId|guardian|phone|email)$/i;

export function problems(files, read) {
  const found = [];
  for (const file of files) {
    if (file.startsWith('data/') && !ALLOWED_DATA.has(file)) found.push(`${file}: data/ 에 허용되지 않은 파일`);
    if (!file.endsWith('.json')) continue;
    let value;
    try { value = JSON.parse(read(file)); } catch { continue; }
    const stack = [value];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      const key = Object.keys(node).find(k => PERSON_KEYS.test(k));
      if (key) { found.push(`${file}: 사람 정보 칸 «${key}»`); break; }
      stack.push(...Object.values(node));
    }
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // 작업 트리 전체가 아니라 git 이 올릴(또는 올린) 파일만 본다.
  const files = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter(file => !file.startsWith('node_modules/'));
  const found = problems(files, file => readFileSync(file, 'utf8'));
  if (found.length) {
    console.error('공개 저장소에 올리면 안 되는 자료가 있습니다:\n- ' + found.join('\n- '));
    process.exit(1);
  }
  console.log(`공개 자료 검사 통과 (${files.length}개 파일)`);
}
