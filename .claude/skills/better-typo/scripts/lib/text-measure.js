// text-measure.js — DOM/reflow 없이 Canvas measureText로 텍스트를 측정·줄바꿈한다.
// chenglou/pretext(순수 JS 텍스트 측정 라이브러리)의 검증된 알고리즘을 이식했다:
//   1) Intl.Segmenter(word)로 세그먼트화
//   2) 왼쪽-접착 구두점을 앞 단어에 병합해 측정 (커닝 반영 + 줄 끝 구두점 orphan 방지)
//   3) keep-all = CJK 포함 연속 text run을 하나로 병합
//   4) last-break-opportunity 방식의 순수 산술 줄바꿈 루프
// probe.js(스킬)와 studio.html(데모)가 같은 로직을 쓴다 — 단일 기준.
//
// 브라우저 컨텍스트 전용(OffscreenCanvas/canvas 필요). Node에선 실행하지 않는다.
//
// 공개 API:
//   measureLines(text, font, maxWidth, { wordBreak, letterSpacing }) →
//     { lines: [{ text, width, lastWord, charCount }], lineCount, maxLineWidth, cjkCharWidth }
//
// ESM(import)과 전역(window.BetterTypoMeasure) 둘 다로 노출된다.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;      // Node(테스트용)
  if (typeof window !== 'undefined') window.BetterTypoMeasure = api;               // 브라우저 전역
  root.__BetterTypoMeasure = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── CJK 판정 (pretext isCJKCodePoint 유니코드 범위) ──
  function isCJKCodePoint(cp) {
    return (
      (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0x3040 && cp <= 0x309f) ||
      (cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0x3130 && cp <= 0x318f) ||
      (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2ee5d) ||
      (cp >= 0x2f800 && cp <= 0x2fa1f) || (cp >= 0x30000 && cp <= 0x33479)
    );
  }
  function isCJK(s) {
    for (let i = 0; i < s.length; i++) {
      const first = s.charCodeAt(i);
      if (first < 0x3000) continue; // fast path: 라틴/ASCII
      if (first >= 0xd800 && first <= 0xdbff && i + 1 < s.length) {
        const second = s.charCodeAt(i + 1);
        if (second >= 0xdc00 && second <= 0xdfff) {
          const cp = ((first - 0xd800) << 10) + (second - 0xdc00) + 0x10000;
          if (isCJKCodePoint(cp)) return true;
          i++; continue;
        }
      }
      if (isCJKCodePoint(first)) return true;
    }
    return false;
  }

  // ── 왼쪽-접착 구두점(앞 단어에 붙여 측정) — pretext leftStickyPunctuation ──
  const LEFT_STICKY = new Set(['.', ',', '!', '?', ':', ';', ')', ']', '}', '%',
    '"', '”', '’', '»', '›', '…', // " ” ’ » › …
    '。', '、', '）', '］', '」', '』']); // 。、）］」』
  // keep-all에서 CJK run을 끊어도 되는 뒤 문자(대시류)
  const DASH_BREAK = new Set(['-', '‐', '–', '—']);

  // ── Canvas 측정 컨텍스트 (OffscreenCanvas 우선, DOM fallback) ──
  let _ctx = null;
  function getCtx() {
    if (_ctx) return _ctx;
    if (typeof OffscreenCanvas !== 'undefined') _ctx = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document !== 'undefined') _ctx = document.createElement('canvas').getContext('2d');
    else throw new Error('text-measure: OffscreenCanvas 또는 DOM canvas가 필요합니다.');
    return _ctx;
  }
  // 폰트별·세그먼트별 폭 캐시 (2단 Map)
  const _caches = new Map();
  function widthOf(seg, font, letterSpacing) {
    let cache = _caches.get(font);
    if (!cache) { cache = new Map(); _caches.set(font, cache); }
    let w = cache.get(seg);
    if (w === undefined) {
      const ctx = getCtx();
      ctx.font = font;
      w = ctx.measureText(seg).width + (letterSpacing ? letterSpacing * [...seg].length : 0);
      cache.set(seg, w);
    }
    return w;
  }

  // ── 세그먼트화 (Intl.Segmenter word) + 구두점/CJK 병합 ──
  let _wordSeg = null;
  function wordSegmenter() {
    if (_wordSeg) return _wordSeg;
    _wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });
    return _wordSeg;
  }

  // 반환: [{ text, kind: 'text'|'space', word, cjk }]
  function segment(text, wordBreak) {
    // 1) 정규화 (white-space: normal)
    const norm = text.replace(/[ \t\n\r\f]+/g, ' ').replace(/^ | $/g, '');
    if (!norm) return [];
    // 2) Intl.Segmenter word granularity
    const raw = [];
    for (const s of wordSegmenter().segment(norm)) {
      const t = s.segment;
      raw.push({ text: t, kind: /^\s+$/.test(t) ? 'space' : 'text', word: !!(s.isWordLike), cjk: isCJK(t) });
    }
    // 3) 왼쪽-접착 구두점을 앞 text 세그먼트에 병합 (커닝 반영 + orphan 방지)
    const merged = [];
    for (const seg of raw) {
      const prev = merged[merged.length - 1];
      if (seg.kind === 'text' && !seg.word && prev && prev.kind === 'text' &&
          [...seg.text].every((c) => LEFT_STICKY.has(c))) {
        prev.text += seg.text;
        prev.cjk = prev.cjk || seg.cjk;
        continue;
      }
      merged.push({ ...seg });
    }
    // 3.5) keep-all: CJK 포함 연속 text run을 하나로 (dash/nbsp 뒤에서는 분리)
    if (wordBreak === 'keep-all') return mergeKeepAll(merged);
    return merged;
  }

  // keep-all: 연속 text 세그먼트 중 CJK를 포함한 run을 하나로 병합(내부 줄바꿈 금지).
  // 단, 앞 run이 dash(- ‐ – —)로 끝나면 거기서 끊어 break를 허용한다(pretext canContinueKeepAllTextRun).
  function mergeKeepAll(segs) {
    const out = [];
    let group = null; // { text, cjk, parts:[] }
    const endsDash = (t) => DASH_BREAK.has(t[t.length - 1]);
    const flush = () => {
      if (!group) return;
      if (group.cjk) out.push({ text: group.text, kind: 'text', word: true, cjk: true });
      else for (const s of group.parts) out.push(s);
      group = null;
    };
    for (const seg of segs) {
      if (seg.kind === 'text') {
        if (group && endsDash(group.text)) flush();   // dash 뒤에서는 run 종료 = 끊기 허용
        if (!group) group = { text: '', cjk: false, parts: [] };
        group.text += seg.text; group.cjk = group.cjk || seg.cjk; group.parts.push(seg);
        continue;
      }
      flush();       // 공백 만나면 run flush
      out.push(seg);
    }
    flush();
    return out;
  }

  // ── 줄바꿈 루프 (last-break-opportunity, 순수 산술) ──
  // 반환 lines: [{ text, width, lastWord, charCount }]
  function layout(segs, font, maxWidth, letterSpacing) {
    const fitLimit = maxWidth + 0.005; // 부동소수 여유(pretext lineFitEpsilon)
    const lines = [];
    let cur = '', lineW = 0, lastBreakLen = -1, lastBreakW = 0;
    const flush = () => {
      const text = cur.replace(/\s+$/u, '');
      if (text) {
        const words = text.split(/\s+/u).filter(Boolean);
        lines.push({ text, width: lastBreakW || lineW, lastWord: words[words.length - 1] || '', charCount: text.length });
      }
      cur = ''; lineW = 0; lastBreakLen = -1; lastBreakW = 0;
    };
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (cur === '' && seg.kind === 'space') continue; // 줄머리 공백 소거
      const w = widthOf(seg.text, font, letterSpacing);
      if (cur !== '' && lineW + w > fitLimit) {
        if (lastBreakLen >= 0) {
          // 마지막 break 기회에서 줄을 끊는다 — 그 지점 이후를 새 줄로
          const carry = cur.slice(lastBreakLen);
          const emit = cur.slice(0, lastBreakLen);
          const words = emit.replace(/\s+$/u, '').split(/\s+/u).filter(Boolean);
          if (emit.replace(/\s+$/u, '')) lines.push({ text: emit.replace(/\s+$/u, ''), width: lastBreakW, lastWord: words[words.length - 1] || '', charCount: emit.replace(/\s+$/u, '').length });
          cur = carry.replace(/^\s+/u, ''); lineW = measureRun(cur, font, letterSpacing);
          lastBreakLen = -1; lastBreakW = 0;
          i--; continue; // 현재 세그먼트를 새 줄에서 다시 시도
        }
        // 끊을 지점이 없음 → 이 줄을 그대로 내보내고 새 줄
        flush();
        i--; continue;
      }
      cur += seg.text; lineW += w;
      if (seg.kind === 'space') { lastBreakLen = cur.length; lastBreakW = lineW - w; }
    }
    flush();
    return lines;
  }
  function measureRun(s, font, letterSpacing) {
    // 이미 병합된 run의 대략 폭 — 캐시된 세그먼트가 아니라 전체 문자열 측정(짧아서 부담 없음)
    if (!s) return 0;
    const ctx = getCtx(); ctx.font = font;
    return ctx.measureText(s).width + (letterSpacing ? letterSpacing * [...s].length : 0);
  }

  // ── 한글 글자폭 (measuredCh 보정용, theory §3) ──
  function cjkCharWidth(font, letterSpacing) {
    return widthOf('가'.repeat(50), font, letterSpacing) / 50; // '가' 50개 평균
  }

  // ── 공개: 텍스트를 줄 단위로 측정 ──
  function measureLines(text, font, maxWidth, opts) {
    opts = opts || {};
    const segs = segment(text, opts.wordBreak);
    const lines = layout(segs, font, maxWidth, opts.letterSpacing || 0);
    let maxLineWidth = 0;
    for (const l of lines) if (l.width > maxLineWidth) maxLineWidth = l.width;
    return {
      lines,
      lineCount: lines.length,
      maxLineWidth,
      cjkCharWidth: cjkCharWidth(font, opts.letterSpacing || 0),
    };
  }

  return { measureLines, segment, isCJK, cjkCharWidth, widthOf };
});
