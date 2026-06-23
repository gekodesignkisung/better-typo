// TypoIssue 팩토리 · 정렬 · JSON IO
// 모든 검출기(measure/hygiene/LLM)가 이 형태로 이슈를 정규화한다.
//
// TypoIssue 형태:
//   {
//     id, category, severity, file, message,
//     fix?: { kind, range?, at?, before?, after?, cssTarget? },
//     evidence?: { lastWordOfLine?, measuredCh?, lineHeightRatio? }
//   }

import { readFileSync, writeFileSync } from 'node:fs';

export const CATEGORIES = [
  'cjk-line-break',
  'orphan-widow',
  'measure',
  'line-height',
  'type-scale',
  'letter-spacing',
  'punctuation-hygiene',
  'cjk-break-css',
  'spelling',
];

export const SEVERITIES = ['error', 'warning', 'info'];

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * 이슈 하나를 만든다. id는 category:file:offset 형태로 자동 생성.
 */
export function makeIssue({ category, severity, file, message, fix, evidence, anchor }) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`unknown category: ${category}`);
  }
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`unknown severity: ${severity}`);
  }
  const loc = anchor ?? fix?.at ?? fix?.range?.[0] ?? 0;
  return {
    id: `${category}:${file}:${loc}`,
    category,
    severity,
    file,
    message,
    ...(fix ? { fix } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * severity(error→warning→info) 그다음 파일·위치 순으로 정렬.
 */
export function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const la = a.fix?.at ?? a.fix?.range?.[0] ?? 0;
    const lb = b.fix?.at ?? b.fix?.range?.[0] ?? 0;
    return la - lb;
  });
}

/**
 * 결과 객체로 감싼다. generatedAt은 호출자가 주입(스크립트 내 Date 회피 환경 대비).
 */
export function buildResult(issues, { generatedAt = null, files = [] } = {}) {
  const sorted = sortIssues(issues);
  return {
    generatedAt,
    files,
    counts: countBySeverity(sorted),
    issues: sorted,
  };
}

export function countBySeverity(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.severity] += 1;
  return c;
}

export function writeResult(path, result) {
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf8');
}

export function readResult(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
