// hygiene.mjs — 문장부호/공백 정규화 검출기 (결정적, prose 영역에서만).
// theory.md §7. 각 정규화는 canonical 형태로 수렴 → 재실행해도 무해(멱등).
//
// 사용:
//   node hygiene.mjs <file>            # TypoIssue[] JSON
//   import { detectHygiene } from './hygiene.mjs'

import { readFileSync } from 'node:fs';
import { segment, proseChunks, fileTypeOf } from './segment.mjs';
import { makeIssue, buildResult } from './lib/issues.mjs';

// 각 규칙: { name, re, fix(matchText) => replacement, message }
// re는 prose 청크 내 로컬 매칭; 오프셋은 청크 start로 보정한다.
const RULES = [
  {
    name: 'double-space',
    // 같은 줄 안의 연속 스페이스만. 줄바꿈을 낀 덩어리(태그 사이 들여쓰기 등)는 제외.
    re: /(?<=\S) {2,}(?=\S)/gu,
    fix: () => ' ',
    message: '이중 이상 공백 → 단일 공백 (theory §7)',
  },
  {
    name: 'space-before-punct',
    // 부호 앞 공백 (여는 괄호/따옴표 제외)
    re: / +([,.!?;:、。」』）)])/gu,
    fix: (m) => m.trim(),
    message: '문장부호 앞 공백 제거 (theory §7)',
  },
  {
    name: 'trailing-space',
    re: /[ \t]+$/gmu,
    fix: () => '',
    message: '줄 끝 트레일링 공백 제거 (theory §7)',
    // HTML에선 태그 사이 들여쓰기 공백이 본문이 아니라 오탐 → md/mdx 전용
    fileTypes: ['md', 'mdx'],
  },
  {
    name: 'ascii-ellipsis',
    re: /\.{3}/gu,
    fix: () => '…',
    message: '... → … 말줄임표 (theory §7)',
  },
  {
    name: 'space-after-punct',
    // 종결/쉼표 뒤 띄어쓰기 누락 (다.특히 → 다. 특히). 다음 글자가 한글일 때만 → 영문 약어(U.S.) 오탐 방지.
    re: /(?<=[가-힣A-Za-z])([.,!?])(?=[가-힣])/gu,
    fix: (m) => m + ' ',
    message: '문장부호 뒤 띄어쓰기 보완 (theory §7)',
  },
  {
    name: 'straight-quote-double',
    // 곧은 큰따옴표 → 둥근 따옴표 (한글 조판 관례). 스타일 설정에 따라 끔 가능.
    re: /"([^"\n]{1,200})"/gu,
    fix: (m) => '“' + m.slice(1, -1) + '”',
    message: '곧은 따옴표 → 둥근 따옴표 “ ” (theory §7)',
  },
  {
    name: 'date-word-space',
    // 날짜 바로 뒤에 글자/괄호가 붙음 (2026-04-22하동훈 → 2026-04-22 하동훈)
    re: /\d{4}-\d{1,2}-\d{1,2}(?=[가-힣A-Za-z(])/gu,
    fix: (m) => m + ' ',
    message: '날짜와 다음 말 띄어쓰기 (theory §8)',
  },
  {
    name: 'space-before-paren',
    // 여는 괄호 앞에 띄어쓰기 (하동훈(SE) → 하동훈 (SE))
    re: /[가-힣A-Za-z0-9](?=\()/gu,
    fix: (m) => m + ' ',
    message: '여는 괄호 앞 띄어쓰기 (theory §8)',
  },
  {
    name: 'close-paren-word',
    // 닫는 괄호 뒤에 띄어쓰기 ()다음 → ) 다음)
    re: /\)(?=[가-힣A-Za-z])/gu,
    fix: (m) => m + ' ',
    message: '닫는 괄호 뒤 띄어쓰기 (theory §8)',
  },
  {
    name: 'list-marker-combo',
    // 어색한 번호 마커 조합: 1.: → 1.  (마침표·콜론 중복)
    re: /\d+\.\s?:/gu,
    fix: (m) => m.replace(/\.\s?:/, '.'),
    message: '어색한 번호 마커 1.: → 1. (theory §7)',
  },
];

export function detectHygiene(text, fileType) {
  const spans = segment(text, { fileType });
  const chunks = proseChunks(text, spans);
  const raw = [];

  const activeRules = RULES.filter((r) => !r.fileTypes || r.fileTypes.includes(fileType));
  for (const chunk of chunks) {
    for (const rule of activeRules) {
      rule.re.lastIndex = 0;
      for (const m of chunk.text.matchAll(rule.re)) {
        const before = m[0];
        const after = rule.fix(before);
        if (after === before) continue; // 이미 canonical → skip (멱등)
        const at = chunk.start + m.index;
        raw.push({ rule: rule.name, at, end: at + before.length, before, after });
      }
    }
  }

  // 겹침 해소: 같은 텍스트 구간을 두 규칙이 잡으면 하나만 남긴다.
  // 우선순위: 트레일링 공백 제거(완전 제거)가 이중공백 축약보다 강하다.
  const PRIORITY = {
    'trailing-space': 0, 'space-before-punct': 1, 'double-space': 2, 'ascii-ellipsis': 1,
    'space-after-punct': 1, 'straight-quote-double': 1, 'date-word-space': 1,
    'space-before-paren': 1, 'close-paren-word': 1, 'list-marker-combo': 1,
  };
  raw.sort((a, b) => a.at - b.at || PRIORITY[a.rule] - PRIORITY[b.rule]);
  const kept = [];
  let lastEnd = -1;
  for (const r of raw) {
    if (r.at < lastEnd) continue; // 직전 fix와 구간 겹침 → skip
    kept.push(r);
    lastEnd = r.end;
  }

  return kept.map((r) =>
    makeIssue({
      category: 'punctuation-hygiene',
      severity: 'info',
      file: '<text>',
      message: RULES.find((x) => x.name === r.rule).message,
      fix: { kind: 'text-replace', range: [r.at, r.end], before: r.before, after: r.after },
    }),
  );
}

// CLI
if (process.argv[1]?.endsWith('hygiene.mjs')) {
  const file = process.argv[2];
  if (file) {
    const text = readFileSync(file, 'utf8');
    const issues = detectHygiene(text, fileTypeOf(file)).map((i) => ({ ...i, file }));
    process.stdout.write(JSON.stringify(buildResult(issues, { files: [file] }), null, 2) + '\n');
  }
}
