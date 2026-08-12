// 원자 단위 규칙 — 줄 끝에서 끊기면 안 되는 패턴.
// theory.md §1 (한글/CJK 줄내림)의 코드화.
//
// 이 규칙들은 "여기 공백은 끊기면 안 된다"를 표시할 뿐, 실제 삽입은 apply.mjs가 한다.
// LLM은 이 규칙으로 잡히지 않는 의미 단위(고유명사 구 등)를 추가로 판단한다.

// 흔한 조사 (어절 끝에 붙는다 — 앞 명사와 분리 금지의 참고용)
export const PARTICLES = [
  '은', '는', '이', '가', '을', '를', '의', '에', '에서', '으로', '로',
  '와', '과', '도', '만', '까지', '부터', '처럼', '보다', '에게', '한테',
  '이라', '라고', '이고', '고', '며', '면서', '든지', '나', '이나',
];

// 숫자에 붙는 단위 — "2026 년" 같은 분리 방지.
// theory.md §1 단위 집합과 동일하게 유지(단일 기준).
// 주의: '개월'·'시간'처럼 긴 단위를 짧은 단위(`개`·`시`)보다 앞에 둬야
//       정규식 교대(|)에서 먼저 매칭되어 부분 매칭 오탐을 피한다.
export const NUMBER_UNITS = [
  '개월', '시간', '페이지',
  '년', '월', '일', '시', '분', '초',
  '개', '명', '번', '차', '회', '점', '위', '배', '쪽',
  '원', '달러', '%',
  'px', 'em', 'rem', 'pt', 'kg', 'g', 'mm', 'cm', 'km', 'm', 'ml', 'L',
  '주',
];

// 숫자 + 단위 사이 공백을 잡는 정규식 (전역, 멀티라인).
// 숫자는 천단위 쉼표 포함 다자릿수 허용(`1,000 원`). 단위 뒤에 글자가 붙으면
// 더 긴 단어의 앞부분일 수 있어(`50 미터법` 등) 경계로 거른다.
// 개행은 제외([^\S\r\n]) — 줄을 넘어간 숫자|단위를 글루하면 소스의 줄 구조가 바뀐다.
export const NUMBER_UNIT_RE = new RegExp(
  `(\\d[\\d,]*)[^\\S\\r\\n]+(${NUMBER_UNITS.map(escapeRe).join('|')})(?![A-Za-z가-힣])`,
  'gu',
);

// 끊기면 어색한 고정 복합어 (확장 가능) — 사용자/LLM이 추가
export const FIXED_PHRASES = [
  'Claude Code',
  '디자인 토큰',
  '편집 디자인',
  '오픈 소스',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * 텍스트에서 "끊기면 안 되는 공백"의 오프셋 목록을 반환 (숫자+단위 한정, 결정적).
 * 반환: [{ at, before, kind }] — at은 공백 시작 오프셋, before는 매칭된 원문.
 */
export function findAtomicSpaces(text) {
  const hits = [];
  for (const m of text.matchAll(NUMBER_UNIT_RE)) {
    const full = m[0];
    const spaceIdx = m.index + m[1].length; // 숫자 그룹 바로 뒤 = 첫 공백 위치 (탭 등에도 안전)
    hits.push({ at: spaceIdx, before: full, kind: 'number-unit' });
  }
  for (const phrase of FIXED_PHRASES) {
    let from = 0;
    let idx;
    while ((idx = text.indexOf(phrase, from)) !== -1) {
      const spaceIdx = idx + phrase.indexOf(' ');
      if (phrase.includes(' ')) {
        hits.push({ at: spaceIdx, before: phrase, kind: 'fixed-phrase' });
      }
      from = idx + phrase.length;
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}
