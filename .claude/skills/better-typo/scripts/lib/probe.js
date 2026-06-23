// probe.js — Playwright browser_evaluate 에 넘기는 인페이지 측정 함수.
// Node로 실행하지 않는다. 이 파일의 본문(IIFE 반환값)을 browser_evaluate에 전달한다.
//
// 하는 일 (theory §1,§3,§4):
//   1. 본문/제목 텍스트 요소를 골라 computed style 수집
//   2. 한글 글자폭을 실제 측정해 measuredCh(줄당 글자수) 보정
//   3. Range.getClientRects()로 각 시각적 줄의 "마지막 단어"를 실측
//      → 줄 끝에서 끊긴 단어를 알아내 나쁜 줄내림/고아 판단의 근거로
//
// 반환:
//   {
//     elements: [{ selector, role, tag, fontSizePx, lineHeightPx, letterSpacingPx,
//                  measuredCh, isCJK, wordBreak, overflowWrap,
//                  lines: [{ text, lastWord, charCount }] }],
//   }
//
// browser_evaluate 사용 예:
//   const code = readFileSync('lib/probe.js','utf8')
//   await browser_evaluate({ function: code })

() => {
  const TEXT_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'DT', 'TD', 'TH', 'DIV', 'SECTION', 'ARTICLE']);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const SKIP = 'svg, math, .katex, .sr-only, script, style, code, pre';

  const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯]/u;

  // 한글 글자폭 측정 (theory §3: '0' 기준 ch는 한글에 부정확)
  function cjkCharWidth(style) {
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    span.style.font = style.font;
    span.style.letterSpacing = style.letterSpacing;
    span.textContent = '가'.repeat(50);
    document.body.appendChild(span);
    const w = span.offsetWidth / 50;
    span.remove();
    return w;
  }

  // Range로 각 시각적 줄의 마지막 단어 추출 (theory §1: 실제 줄바꿈 위치)
  function visualLines(el) {
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length);
    if (!node) return [];
    const text = node.textContent;
    const range = document.createRange();
    const lines = [];
    let lineStart = 0;
    let prevTop = null;
    for (let i = 1; i <= text.length; i++) {
      range.setStart(node, i - 1);
      range.setEnd(node, i);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      if (prevTop !== null && rect.top - prevTop > 1) {
        // 줄바꿈 발생: [lineStart, i-1) 가 한 줄
        pushLine(text, lineStart, i - 1, lines);
        lineStart = i - 1;
      }
      prevTop = rect.top;
    }
    pushLine(text, lineStart, text.length, lines);
    return lines;
  }

  function pushLine(text, a, b, lines) {
    const seg = text.slice(a, b).replace(/\s+$/u, '');
    if (!seg) return;
    const words = seg.split(/\s+/u).filter(Boolean);
    lines.push({ text: seg, lastWord: words[words.length - 1] ?? '', charCount: seg.length });
  }

  function cssSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/u)[0] : '';
    const sibs = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
    const idx = sibs.indexOf(el);
    return `${tag}${cls}${sibs.length > 1 ? `:nth-of-type(${idx + 1})` : ''}`;
  }

  const out = { elements: [] };
  const all = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,dd,dt,td,th')];
  for (const el of all) {
    if (el.closest(SKIP) && !HEADING_TAGS.has(el.tagName)) continue;
    const txt = (el.textContent || '').trim();
    if (txt.length < 12) continue;

    const style = getComputedStyle(el);
    const fontSizePx = parseFloat(style.fontSize) || 0;
    const lineHeightPx = style.lineHeight === 'normal' ? fontSizePx * 1.2 : parseFloat(style.lineHeight) || 0;
    const letterSpacingPx = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0;
    const isCJK = CJK_RE.test(txt);
    const role = HEADING_TAGS.has(el.tagName) ? 'heading' : 'body';

    const rect = el.getBoundingClientRect();
    const charW = isCJK ? cjkCharWidth(style) : (parseFloat(style.fontSize) * 0.5);
    const measuredCh = charW > 0 ? rect.width / charW : null;

    out.elements.push({
      selector: cssSelector(el),
      role,
      tag: el.tagName,
      fontSizePx,
      lineHeightPx,
      letterSpacingPx,
      measuredCh,
      isCJK,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap || style.wordWrap,
      lines: role === 'body' ? visualLines(el) : [],
    });
  }
  return out;
}
