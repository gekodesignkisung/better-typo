// apply.mjs — 승인된 제안을 파일 바이트에 적용. 멱등하고 안전하게.
// theory + 가드레일: prose 영역 밖이면 거부, 이미 적용됐으면 skip, before 불일치면 stale skip.
//
// 사용:
//   node apply.mjs <result.json> [id1 id2 ...]   # id 생략 시 전부 적용
//   --dry  : 적용 없이 무엇이 적용/스킵될지만 출력
//
// 적용 종류:
//   text-replace : range[a,b)를 after로 치환
//   insert-nbsp  : at 위치 공백(또는 직전 공백)을 U+00A0으로
//   insert-wbr   : at 위치에 <wbr> 삽입
//   css-rule     : 자동 적용 안 함 — 사람이 위치를 정해야 하므로 리포트만
//
// 안전:
//   - 같은 파일의 여러 fix는 오프셋 내림차순으로 적용(앞쪽 변형이 뒤 오프셋을 밀지 않게)
//   - segment로 prose 검사, before 재확인

import { readFileSync, writeFileSync } from 'node:fs';
import { segment, isProse, fileTypeOf } from './segment.mjs';

const NBSP = ' ';

export function applyToFile(path, fixes, { dry = false } = {}) {
  let text = readFileSync(path, 'utf8');
  const spans = segment(text, { fileType: fileTypeOf(path) });
  const log = [];

  // 적용 가능한 것만 추려서 오프셋 내림차순
  const planned = [];
  for (const fix of fixes) {
    const r = planFix(text, spans, fix);
    if (r.skip) {
      log.push({ id: fix.id, status: 'skip', reason: r.reason });
      continue;
    }
    planned.push({ id: fix.id, order: planned.length, ...r });
  }
  const kept = removeConflicts(planned, log);
  kept.sort((a, b) => b.at - a.at);

  for (const p of kept) {
    text = text.slice(0, p.at) + p.insert + text.slice(p.removeEnd ?? p.at);
    log.push({ id: p.id, status: 'apply', at: p.at });
  }

  if (!dry) writeFileSync(path, text, 'utf8');
  return { path, applied: kept.length, log, text };
}

function planFix(text, spans, issue) {
  const fix = issue.fix;
  if (!fix) return { skip: true, reason: 'no-fix' };

  if (fix.kind === 'css-rule') {
    return { skip: true, reason: 'css-needs-human-placement' };
  }

  if (fix.kind === 'text-replace') {
    const [a, b] = fix.range;
    if (!isProseRange(spans, a, b)) return { skip: true, reason: 'not-prose' };
    if (text.slice(a, b) !== fix.before) return { skip: true, reason: 'stale-before' };
    if (fix.before === fix.after) return { skip: true, reason: 'already-canonical' };
    return { at: a, removeEnd: b, insert: fix.after };
  }

  if (fix.kind === 'insert-nbsp') {
    const at = fix.at;
    if (!isProse(spans, at)) return { skip: true, reason: 'not-prose' };
    // at은 공백 위치라고 가정. 멱등: 이미 NBSP면 skip.
    if (text[at] === NBSP) return { skip: true, reason: 'already-nbsp' };
    if (text[at] !== ' ') return { skip: true, reason: 'no-space-at-anchor' };
    return { at, removeEnd: at + 1, insert: NBSP };
  }

  if (fix.kind === 'insert-wbr') {
    const at = fix.at;
    if (!isProse(spans, at)) return { skip: true, reason: 'not-prose' };
    if (text.slice(at, at + 5) === '<wbr>' || text.slice(at - 5, at) === '<wbr>') {
      return { skip: true, reason: 'already-wbr' };
    }
    return { at, removeEnd: at, insert: '<wbr>' };
  }

  return { skip: true, reason: `unknown-kind:${fix.kind}` };
}

function isProseRange(spans, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return false;
  return spans.some((s) => s.kind === 'prose' && start >= s.start && end <= s.end);
}

function removeConflicts(planned, log) {
  const sorted = [...planned].sort((a, b) => {
    const ae = a.removeEnd ?? a.at;
    const be = b.removeEnd ?? b.at;
    return a.at - b.at || be - ae || a.order - b.order;
  });
  const kept = [];
  const insertAnchors = new Set();
  let lastEnd = -1;

  for (const p of sorted) {
    const end = p.removeEnd ?? p.at;
    const insertion = end === p.at;
    const duplicateInsert = insertion && insertAnchors.has(p.at);
    if (p.at < lastEnd || duplicateInsert) {
      log.push({ id: p.id, status: 'skip', reason: 'overlap' });
      continue;
    }
    kept.push(p);
    if (insertion) insertAnchors.add(p.at);
    lastEnd = Math.max(lastEnd, end);
  }

  return kept;
}

// CLI
if (process.argv[1]?.endsWith('apply.mjs')) {
  const [resultPath, ...rest] = process.argv.slice(2);
  const dry = rest.includes('--dry');
  const ids = rest.filter((x) => x !== '--dry');
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  const wanted = ids.length ? result.issues.filter((i) => ids.includes(i.id)) : result.issues;

  // 파일별 그룹
  const byFile = new Map();
  for (const issue of wanted) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }
  const report = [];
  for (const [file, issues] of byFile) {
    if (file === '<text>' || file === '<page>') continue;
    report.push(applyToFile(file, issues, { dry }));
  }
  process.stdout.write(
    JSON.stringify(report.map(({ text, ...r }) => r), null, 2) + '\n',
  );
}
