// segment.mjs — prose(본문) vs protected(보호) 영역 토크나이저.
// 이것이 안전의 핵심: protected로 표시된 바이트는 어떤 검출기/적용기도 건드리지 않는다.
//
// 사용:
//   node segment.mjs <file>            # 스팬 배열 JSON을 stdout으로
//   import { segment } from './segment.mjs'
//
// 반환 스팬: { start, end, kind, ctx }
//   kind: 'prose' | 'protected'
//   ctx:  'text' | 'code-fence' | 'inline-code' | 'tag' | 'url'
//       | 'frontmatter' | 'math' | 'mdx-expr' | 'jsx'
//
// 보호 대상(절대 변형 금지):
//   - 코드 펜스 ``` ... ```  및  ~~~ ... ~~~
//   - 인라인 코드 `...`
//   - <pre>, <code>, <script>, <style> 블록 (HTML)
//   - HTML/JSX 태그 자체 <...> 와 속성
//   - URL (http/https, 마크다운 링크 타깃 ](...))
//   - YAML frontmatter (--- ... --- 파일 선두)
//   - 수식 $...$, $$...$$
//   - MDX 표현식 {...}, import/export 라인

import { readFileSync } from 'node:fs';

const FENCE_RE = /^(\s*)(```+|~~~+)/;

export function segment(text, { fileType = 'md' } = {}) {
  const spans = [];
  const n = text.length;

  // 보호 구간 마스크. true면 protected.
  const mask = new Uint8Array(n);
  const ctxAt = new Array(n).fill('text');

  const protect = (start, end, ctx) => {
    for (let i = Math.max(0, start); i < Math.min(n, end); i++) {
      mask[i] = 1;
      ctxAt[i] = ctx;
    }
  };

  // 1) Frontmatter (파일 선두 --- ... ---)
  if (text.startsWith('---')) {
    const close = text.indexOf('\n---', 3);
    if (close !== -1) {
      const end = text.indexOf('\n', close + 1);
      protect(0, end === -1 ? n : end + 1, 'frontmatter');
    }
  }

  // 2) 코드 펜스 (라인 단위)
  const lines = splitLinesWithOffsets(text);
  let fence = null; // { marker }
  for (const { start, end, line } of lines) {
    const m = line.match(FENCE_RE);
    if (fence) {
      protect(start, end, 'code-fence');
      if (m && line.trim().startsWith(fence.marker)) fence = null;
      continue;
    }
    if (m) {
      fence = { marker: m[2][0].repeat(3) };
      protect(start, end, 'code-fence');
    }
  }

  // 3) HTML 주석 <!-- ... --> 및 doctype 선언
  for (const m of text.matchAll(/<!--[\s\S]*?-->/gu)) protect(m.index, m.index + m[0].length, 'tag');
  for (const m of text.matchAll(/<!doctype[^>]*>/giu)) protect(m.index, m.index + m[0].length, 'tag');

  // 4) HTML 보호 블록 <pre|code|script|style|head> ... </...>
  // head 전체를 보호하면 <title>·<style>·<meta> 등 비본문이 prose로 새지 않는다.
  for (const tag of ['pre', 'code', 'script', 'style', 'head']) {
    const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'giu');
    for (const m of text.matchAll(re)) protect(m.index, m.index + m[0].length, 'tag');
  }

  // 4) 인라인 코드 `...` (코드펜스 밖에서만 의미; 마스크가 이미 막아줌)
  for (const m of text.matchAll(/`[^`\n]+`/gu)) {
    if (!mask[m.index]) protect(m.index, m.index + m[0].length, 'inline-code');
  }

  // 5) HTML/JSX 태그 자체 <...>
  for (const m of text.matchAll(/<\/?[A-Za-z][^>]*>/gu)) {
    protect(m.index, m.index + m[0].length, fileType === 'mdx' ? 'jsx' : 'tag');
  }

  // 6) URL 및 마크다운 링크 타깃
  for (const m of text.matchAll(/https?:\/\/[^\s)<>"']+/gu)) {
    protect(m.index, m.index + m[0].length, 'url');
  }
  for (const m of text.matchAll(/\]\(([^)]+)\)/gu)) {
    // ](...) 의 괄호 안쪽만 보호 (링크 텍스트 [..]는 prose 가능)
    const inner = m.index + m[0].indexOf('(');
    protect(inner, m.index + m[0].length, 'url');
  }

  // 7) 수식 $$...$$, $...$
  for (const m of text.matchAll(/\$\$[\s\S]*?\$\$/gu)) protect(m.index, m.index + m[0].length, 'math');
  for (const m of text.matchAll(/(?<!\$)\$[^$\n]+\$(?!\$)/gu)) {
    if (!mask[m.index]) protect(m.index, m.index + m[0].length, 'math');
  }

  // 8) MDX 표현식 {...} 및 import/export 라인
  if (fileType === 'mdx') {
    for (const m of text.matchAll(/\{[^{}]*\}/gu)) protect(m.index, m.index + m[0].length, 'mdx-expr');
    for (const { start, end, line } of lines) {
      if (/^\s*(import|export)\s/.test(line)) protect(start, end, 'mdx-expr');
    }
  }

  // 마스크 → 스팬 병합
  let i = 0;
  while (i < n) {
    const start = i;
    const isProt = mask[i] === 1;
    const ctx = ctxAt[i];
    while (i < n && mask[i] === (isProt ? 1 : 0) && ctxAt[i] === ctx) i++;
    spans.push({ start, end: i, kind: isProt ? 'protected' : 'prose', ctx });
  }
  return spans;
}

/**
 * 오프셋이 prose 영역 안인지 — apply.mjs가 안전 검사로 사용.
 */
export function isProse(spans, offset) {
  for (const s of spans) {
    if (offset >= s.start && offset < s.end) return s.kind === 'prose';
  }
  return false;
}

/**
 * prose 스팬들의 텍스트만 추출 (오프셋 보존용 [{start, text}]).
 */
export function proseChunks(text, spans) {
  return spans
    .filter((s) => s.kind === 'prose')
    .map((s) => ({ start: s.start, end: s.end, text: text.slice(s.start, s.end), ctx: s.ctx }));
}

function splitLinesWithOffsets(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push({ start, end: i + 1, line: text.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < text.length) out.push({ start, end: text.length, line: text.slice(start) });
  return out;
}

export function fileTypeOf(path) {
  if (path.endsWith('.mdx')) return 'mdx';
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
  return 'md';
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('segment.mjs')) {
  const file = process.argv[2];
  if (file) {
    const text = readFileSync(file, 'utf8');
    const spans = segment(text, { fileType: fileTypeOf(file) });
    process.stdout.write(JSON.stringify(spans, null, 2) + '\n');
  }
}
