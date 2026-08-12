// run.mjs — 에이전트 중립 CLI 진입점.
// Claude Code / Codex / 사람 누구나 동일하게 호출한다:
// `node .claude/skills/better-typo/scripts/run.mjs <file|dir...>`
// 결정적(스크립트) 단계만 한 번에 돌린다: discover → segment → detect → propose → (dry|apply).
//
// 이 스크립트가 하는 것 (안전·형태로 확정되는 것만):
//   - 문장부호/공백 정리(hygiene.mjs, theory §7)
//   - 숫자+단위·고정 복합어 glue 후보(unit-rules.mjs, theory §1)
// 이 스크립트가 하지 않는 것 (LLM 판단 필요 → SKILL.md/AGENTS.md 파이프라인):
//   - 줄내림·고아 판단(probe 렌더 필요), 맞춤법, 위계/measure/행간, CSS 제안
//
// 사용:
//   node .claude/skills/better-typo/scripts/run.mjs <file...>            # 검출만 → .better-typo/result.json 저장 + 요약 출력
//   node .claude/skills/better-typo/scripts/run.mjs <file...> --dry      # 적용하면 무엇이 바뀌는지 미리보기(파일 불변)
//   node .claude/skills/better-typo/scripts/run.mjs <file...> --apply    # 승인 간주하고 저위험 항목 실제 적용
//   node .claude/skills/better-typo/scripts/run.mjs <file...> --json     # result.json 내용을 stdout으로(도구 연동용)
//
// 종료 코드: 이슈 0건이면 0, 검출 있으면 0(정상). 오류 시 1.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { segment, proseChunks, fileTypeOf } from './segment.mjs';
import { detectHygiene } from './hygiene.mjs';
import { findAtomicSpaces } from './lib/unit-rules.mjs';
import { makeIssue, buildResult, writeResult } from './lib/issues.mjs';
import { applyToFile } from './apply.mjs';

const DOC_RE = /\.(html?|mdx|md)$/i;
const SKIP_RE = /(^|[\\/])(node_modules|\.next|dist|build|out|\.git)([\\/]|$)/;

// ── glue 후보(숫자+단위, 고정 복합어)를 insert-nbsp fix로 (theory §1) ──
function detectGlue(text, fileType, file) {
  const spans = segment(text, { fileType });
  const chunks = proseChunks(text, spans);
  const issues = [];
  for (const chunk of chunks) {
    for (const hit of findAtomicSpaces(chunk.text)) {
      const at = chunk.start + hit.at; // 공백 위치(원문 오프셋)
      if (text[at] !== ' ') continue;  // 안전: 실제 공백일 때만
      issues.push(
        makeIssue({
          category: 'cjk-line-break',
          severity: 'info',
          file,
          message: `줄 끝 분리 방지 glue: ${JSON.stringify(hit.before)} (theory §1)`,
          fix: { kind: 'insert-nbsp', at, before: ' ', after: ' ' },
        }),
      );
    }
  }
  return issues;
}

// ── 파일 하나 검출 ──
function detectFile(file) {
  const text = readFileSync(file, 'utf8');
  const ft = fileTypeOf(file);
  const hygiene = detectHygiene(text, ft).map((i) => ({
    ...i,
    file,
    id: i.id.replace('<text>', file),
  }));
  const glue = detectGlue(text, ft, file);
  return [...hygiene, ...glue];
}

// ── discover: 인자를 파일 목록으로 (디렉터리면 재귀) ──
function discover(args) {
  const files = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) {
        const child = join(p, name);
        if (SKIP_RE.test(child)) continue;
        walk(child);
      }
    } else if (DOC_RE.test(p) && !SKIP_RE.test(p)) {
      files.push(p);
    }
  };
  for (const a of args) {
    if (!existsSync(a)) { process.stderr.write(`skip (not found): ${a}\n`); continue; }
    walk(a);
  }
  return [...new Set(files)];
}

function main() {
  const argv = process.argv.slice(2);
  const bin = relative(process.cwd(), process.argv[1] || 'run.mjs') || 'run.mjs';
  // --auto-apply=<카테고리,...> : 무인 실행용 — 지정 카테고리만 적용, 나머지는 result.json에 남긴다.
  // (SKILL.md Automation hook과 동일 표기. `--auto-apply cats` 공백 구분도 허용.)
  let autoCats = null;
  const argRest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--auto-apply')) {
      const v = a.includes('=') ? a.split('=')[1] : argv[++i] || '';
      autoCats = v.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    argRest.push(a);
  }
  const flags = new Set(argRest.filter((a) => a.startsWith('--')));
  const inputs = argRest.filter((a) => !a.startsWith('--'));
  if (!inputs.length) {
    process.stderr.write(
      `usage: node ${bin} <file|dir...> [--dry|--apply|--auto-apply <cat,...>] [--json]\n` +
      '  (기본) 검출만 → .better-typo/result.json 저장 + 요약\n' +
      '  --dry    적용 미리보기(파일 불변)\n' +
      '  --apply  저위험 항목 실제 적용\n' +
      '  --auto-apply <cat,...>  지정 카테고리만 적용 (예: punctuation-hygiene,cjk-line-break)\n' +
      '  --json   result.json을 stdout으로\n',
    );
    process.exit(1);
  }

  const files = discover(inputs);
  if (!files.length) { process.stderr.write('대상 문서 없음 (.html/.md/.mdx)\n'); process.exit(1); }

  const allIssues = [];
  for (const f of files) {
    try { allIssues.push(...detectFile(f)); }
    catch (e) { process.stderr.write(`error (${f}): ${e.message}\n`); }
  }
  const result = buildResult(allIssues, { files });

  // 저장
  const outDir = '.better-typo';
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'result.json');
  writeResult(outPath, result);

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // 요약
  const c = result.counts;
  process.stdout.write(
    `\nbetter-typo — 문서 ${files.length}개, 결정적 이슈 ${allIssues.length}건 ` +
    `(error ${c.error} / warning ${c.warning} / info ${c.info})\n` +
    `→ ${outPath} 저장\n`,
  );
  const byFile = new Map();
  for (const i of result.issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  for (const [file, issues] of byFile) {
    process.stdout.write(`\n  ${relative(process.cwd(), file) || file}\n`);
    for (const i of issues) {
      const f = i.fix || {};
      const b = 'before' in f ? JSON.stringify(f.before) : '';
      const a = 'after' in f ? JSON.stringify(f.after) : '';
      process.stdout.write(`    · [${i.category}] ${b} → ${a}  ${i.message}\n`);
    }
  }

  if (flags.has('--dry') || flags.has('--apply') || autoCats) {
    // --dry가 있으면 무조건 미리보기. 없으면 --apply 또는 --auto-apply일 때만 실제 적용.
    const dry = flags.has('--dry') || (!flags.has('--apply') && !autoCats);
    const label = dry ? '── DRY RUN (파일 불변) ──'
      : autoCats ? `── AUTO-APPLY (${autoCats.join(',')}) ──` : '── APPLY (실제 수정) ──';
    process.stdout.write(`\n${label}\n`);
    const grouped = new Map();
    for (const i of result.issues) {
      if (i.file === '<text>' || i.file === '<page>') continue;
      if (autoCats && !autoCats.includes(i.category)) continue;  // 지정 카테고리만
      if (!grouped.has(i.file)) grouped.set(i.file, []);
      grouped.get(i.file).push(i);
    }
    for (const [file, issues] of grouped) {
      const r = applyToFile(file, issues, { dry });
      const applied = r.log.filter((l) => l.status === 'apply').length;
      const skipped = r.log.filter((l) => l.status === 'skip').length;
      process.stdout.write(`    ${relative(process.cwd(), file) || file}: ${applied} 적용, ${skipped} skip\n`);
    }
    if (!dry) {
      process.stdout.write('\n주의: 여기서 적용하는 것은 저위험 결정적 항목뿐이다.\n');
      process.stdout.write('줄내림·고아·맞춤법·위계는 SKILL.md/AGENTS.md의 LLM 파이프라인을 따른다.\n');
    }
  } else {
    process.stdout.write(`\n미리보기: node ${bin} <file> --dry   |   적용: --apply\n`);
  }
}

main();
