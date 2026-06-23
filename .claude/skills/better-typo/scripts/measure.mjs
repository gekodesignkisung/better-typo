// measure.mjs — measure(글줄 길이) / line-height(행간) / type-scale(위계) 산술 검출.
// theory.md §3,§4,§5. 입력은 Playwright probe가 수집한 측정값(computed styles),
// 또는 정적 폴백(소스에서 추정). 순수 산술이라 결정적이다.
//
// 사용(프로브 결과 JSON을 받아 평가):
//   import { evaluateMeasurements } from './measure.mjs'
//   const issues = evaluateMeasurements(probeResult)
//
// probeResult.elements: [{
//   selector, role: 'body'|'heading', tag,
//   fontSizePx, lineHeightPx, letterSpacingPx,
//   measuredCh,            // 한글 글자폭 보정된 줄당 글자수 (probe가 계산)
//   isCJK,                 // 본문이 한글/CJK 위주인가
// }]

import { makeIssue } from './lib/issues.mjs';

// theory.md §3
const MEASURE = {
  cjk: { min: 25, max: 45, ideal: [25, 40] },
  latin: { min: 45, max: 75, ideal: [50, 65] },
};
// theory.md §4 (line-height / font-size 비율)
const LINE_HEIGHT = {
  bodyCJK: { warn: 1.5, error: 1.3, ideal: [1.6, 1.8] },
  bodyLatin: { warn: 1.4, error: 1.3, ideal: [1.5, 1.6] },
  heading: { idealMax: 1.3 },
};
// theory.md §5
const SCALE_RATIOS = [1.2, 1.25, 1.333, 1.414, 1.5];
const SCALE_TOLERANCE = 0.15;

export function evaluateMeasurements(probeResult, file = '<page>') {
  const issues = [];
  const els = probeResult?.elements ?? [];

  for (const el of els) {
    // measure
    if (el.role === 'body' && Number.isFinite(el.measuredCh)) {
      const band = el.isCJK ? MEASURE.cjk : MEASURE.latin;
      if (el.measuredCh > band.max || el.measuredCh < band.min) {
        const target = el.isCJK ? '40ch 부근(한글)' : '60ch 부근(라틴)';
        issues.push(
          makeIssue({
            category: 'measure',
            severity: el.measuredCh > band.max ? 'warning' : 'info',
            file,
            anchor: hash(el.selector),
            message: `${el.selector} 글줄 ${Math.round(el.measuredCh)}자/줄 — 권장 ${band.min}–${band.max}자. max-width를 ${target}로 (theory §3)`,
            fix: { kind: 'css-rule', cssTarget: `${el.selector} { max-width: ... }`, before: '', after: '' },
            evidence: { measuredCh: el.measuredCh },
          }),
        );
      }
    }

    // line-height
    if (Number.isFinite(el.lineHeightPx) && Number.isFinite(el.fontSizePx) && el.fontSizePx > 0) {
      const ratio = el.lineHeightPx / el.fontSizePx;
      if (el.role === 'body') {
        const lh = el.isCJK ? LINE_HEIGHT.bodyCJK : LINE_HEIGHT.bodyLatin;
        if (ratio < lh.error || ratio < lh.warn) {
          issues.push(
            makeIssue({
              category: 'line-height',
              severity: ratio < lh.error ? 'warning' : 'info',
              file,
              anchor: hash(el.selector),
              message: `${el.selector} 행간 ${ratio.toFixed(2)} — 본문 권장 ${lh.ideal[0]}–${lh.ideal[1]} (theory §4)`,
              fix: { kind: 'css-rule', cssTarget: `${el.selector} { line-height: ${lh.ideal[0]} }`, before: '', after: '' },
              evidence: { lineHeightRatio: ratio },
            }),
          );
        }
      } else if (el.role === 'heading' && ratio > LINE_HEIGHT.heading.idealMax + 0.2) {
        issues.push(
          makeIssue({
            category: 'line-height',
            severity: 'info',
            file,
            anchor: hash(el.selector),
            message: `${el.selector} 제목 행간 ${ratio.toFixed(2)} — 권장 1.1–1.3 (theory §4)`,
            fix: { kind: 'css-rule', cssTarget: `${el.selector} { line-height: 1.2 }`, before: '', after: '' },
            evidence: { lineHeightRatio: ratio },
          }),
        );
      }
    }

    // letter-spacing (큰 제목 음수 트래킹 권장)
    if (el.role === 'heading' && el.fontSizePx >= 28) {
      const ls = (el.letterSpacingPx ?? 0) / el.fontSizePx;
      if (ls > -0.005) {
        issues.push(
          makeIssue({
            category: 'letter-spacing',
            severity: 'info',
            file,
            anchor: hash(el.selector),
            message: `${el.selector} 큰 제목 자간 약한 음수 트래킹 권장 -0.01~-0.02em (theory §6)`,
            fix: { kind: 'css-rule', cssTarget: `${el.selector} { letter-spacing: -0.015em }`, before: '', after: '' },
          }),
        );
      }
    }
  }

  // type-scale: 제목들의 font-size가 모듈러 스케일을 따르는지
  const headings = els
    .filter((e) => e.role === 'heading' && Number.isFinite(e.fontSizePx))
    .sort((a, b) => b.fontSizePx - a.fontSizePx);
  for (let i = 0; i + 1 < headings.length; i++) {
    const r = headings[i].fontSizePx / headings[i + 1].fontSizePx;
    if (r <= 1.02) continue; // 거의 같은 크기는 위계 자체가 모호 — 별도
    const nearest = SCALE_RATIOS.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), SCALE_RATIOS[0]);
    if (Math.abs(r - nearest) / nearest > SCALE_TOLERANCE) {
      issues.push(
        makeIssue({
          category: 'type-scale',
          severity: 'info',
          file,
          anchor: hash(headings[i].selector + headings[i + 1].selector),
          message: `${headings[i].selector}↔${headings[i + 1].selector} 크기비 ${r.toFixed(2)} — 모듈러 스케일(${SCALE_RATIOS.join('/')})에서 벗어남 (theory §5)`,
        }),
      );
    }
  }

  return issues;
}

// 셀렉터 문자열을 안정적인 정수 앵커로 (id 생성용)
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
