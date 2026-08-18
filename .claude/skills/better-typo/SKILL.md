---
name: better-typo
description: 한글/CJK 웹 문서의 편집디자인 타이포그래피를 이론에 근거해 개선한다 — 줄내림(줄바꿈) 위치, 글줄 길이(measure), 행간, 위계, 자간, 문장부호, 맞춤법/오타. 수정안을 diff로 제안하고 승인 시 적용한다. 타이포 다듬기/줄내림 교정/편집디자인 패스/문서 퀄리티 개선 요청 시 사용.
---

# better-typo — 한글 편집 타이포그래피 개선 스킬

웹 문서(HTML/MDX/Markdown)의 편집디자인 퀄리티를 **실제로 개선**한다. 진단만 하지 않는다.
특히 한글 본문에서 인상을 좌우하는 **줄내림(줄바꿈) 위치** 같은 미세 디테일을 다듬는다.

## When to use
- "이 글/페이지 타이포 다듬어줘", "줄내림 정리해줘", "문서 퀄리티 올려줘", "편집디자인 패스"
- 자동생성 블로그·레포의 문서 전반을 이론에 따라 손볼 때

## Operating mode — 제안 → 승인 → 적용 (승인 전 수정 금지)
1. 분석 후 **파일별 통합 diff + 한글 근거**를 제시한다.
2. 사용자가 승인한 이슈 id만 `apply.mjs`로 적용한다.
3. 적용 후 재측정으로 개선을 확인한다.
**절대 승인 전에 파일을 Edit 하지 않는다.**

## Theory reference
모든 임계값·규칙은 `resources/theory.md`가 단일 출처다. 메시지에 항상 `(theory §N)`로 근거를 인용한다.

## Pipeline
```
discover → segment → (render/probe) → detect → propose → DIFF → approve → apply → re-verify
```

## Interactive studio (호출 시 옵션 — 사용자가 직접 다듬어 보기)
사용자가 **브라우저에서 자기 글을 직접 넣고 다듬는 과정을 보고 싶어 하면** `resources/studio.html`을 열어 제공한다. studio는 theory.md 규칙을 브라우저에서 재현한 **시연·탐색 도구**다(단일 기준은 theory.md이며, studio의 검출 규칙·단위 집합·오타 사전은 scripts와 동일하게 정렬돼 있다).

여는 법 (`file://`는 보안상 막히는 경우가 많으니 로컬 서버로):
```
# 스킬 디렉터리의 resources에서
python -m http.server 8799        # 또는: npx --yes serve -l 8799 .
# → 브라우저에서 http://localhost:8799/studio.html
```
사용법: 빈 캔버스에 글을 붙여넣고(줄바꿈으로 제목·소제목·본문·목록·인용·캡션 구분) **다듬기 시작**을 누르면 8단계(구조→위계→맞춤법→정리→AI 흔적→가독성→레이아웃→마무리 점검)로 다듬는 과정과 각 단계의 theory §근거를 보여준다. ‘예시 글 불러오기’로 데모 글을 채울 수도 있다. 문서의 한글 비율을 감지해 한글/라틴 기준(§3·§4)을 자동 분기하므로 영문 글에도 동작한다.

**중요**: studio는 시각적 탐색용이다. **실제 파일 바이트 변형은 studio가 하지 않는다** — 파일을 고치는 것은 언제나 아래 파이프라인(propose → DIFF → approve → `apply.mjs`)을 거친다.

### 1. Discover
`rg --files`로 대상 문서 수집:
```
rg --files | rg '\.(html?|mdx|md)$' | rg -v 'node_modules|\.next|dist|build|out'
```
사용자가 경로/글롭을 주면 그것을 우선한다.

### 2. Segment (안전 핵심 — 항상 먼저)
```
node scripts/segment.mjs <file>
```
prose/protected 스팬을 얻는다. **protected(코드·인라인코드·URL·태그·frontmatter·수식·MDX표현식)는 절대 건드리지 않는다.** 모든 후속 변형은 prose 스팬 안에서만.

### 3. (선택) Render & probe — 실제 줄바꿈 위치 측정
정적 소스만으론 브라우저가 *실제로* 어디서 줄을 끊는지 모른다. 가능하면 렌더해서 측정한다.
- `mcp__playwright__browser_navigate` 로 URL / dev-server / `file://<절대경로>` 열기
- `mcp__playwright__browser_evaluate` 에 `scripts/lib/probe.js` 본문을 `function`으로 전달
- 반환: 요소별 computed style + `measuredCh`(한글 글자폭 보정) + `lines[]`(각 시각적 줄의 `lastWord`)
- **측정은 Canvas `measureText` 기반**(theory §3) — `getBoundingClientRect`·글자별 `Range`의 레이아웃 reflow 없이 잰다. `Intl.Segmenter`+왼쪽-접착 구두점 병합+keep-all CJK run 병합+last-break 줄바꿈(`chenglou/pretext` 방식). 코어 로직은 `scripts/lib/text-measure.js`가 단일 기준. 실측 대비 줄 수 ≈95%.
- Playwright 불가 시: 정적 폴백 — `cjk-break-css`(keep-all 누락)와 숫자+단위 glue만, 고아 탐지는 생략.

### 4. Detect
- **결정적(스크립트)** — 형태로 확정되는 안전한 것만:
  - `node scripts/hygiene.mjs <file>` → 문장부호/공백 + **기계적 띄어쓰기**: 이중공백·부호 앞/뒤 띄어쓰기(`다.특히`→`다. 특히`)·둥근 따옴표·말줄임표·날짜+말 (theory §7~§8 안전 부분집합). 괄호는 교정하지 않음 — 여는 괄호는 앞말에 붙임(국립국어원), 닫는 괄호 뒤는 조사/새 어절 문맥 판단(§8 LLM)
  - probe 결과를 `evaluateMeasurements()`(`scripts/measure.mjs`)에 넣어 measure/line-height/type-scale/letter-spacing 이슈
  - `findAtomicSpaces()`(`scripts/lib/unit-rules.mjs`)로 숫자+단위 등 원자 단위 glue 후보
- **판단(LLM = 너)** — 문맥·미학이 필요한 것:
  - `cjk-line-break`: probe의 `lines[].lastWord`를 보고, 줄 끝에서 어절/의미 단위가 부자연스럽게 끊겼는지 판단. glue할 공백의 소스 오프셋을 골라 `insert-nbsp` fix 작성.
  - `orphan-widow`: 마지막 줄 글자수 ≤4(theory §2)면 직전 공백을 nbsp로. 사용자 메시지에는 "마지막 줄 한 단어" 표현을 쓴다(고아/orphan은 이론 용어). **단, 본문에 `text-wrap: pretty`가 적용됐고 지원 브라우저면 이 nbsp 제안을 보류**한다(§13-1 중복 회피) — 확신 없으면 nbsp 유지.
  - `css-text-modern`(theory §13): 최신 CSS Text 기능을 `css-rule`로 제안. **§13-1(채택)** — 본문에 `text-wrap: pretty`, 제목(h1~h3)에 `text-wrap: balance`, 혼합 문서에 `text-autospace: normal`(Baseline 2025-11) 누락 시 제안(전부 폴백 안전). `balance` 줄 제한은 브라우저별로 다르고(Chromium 6·Firefox 10줄), `pretty`는 성능 비용이 있어 긴 본문에만. `text-autospace`는 명세상 기본 동작 `insert`가 기존 공백을 보존해 §1 nbsp와 겹치지 않는다(`replace`는 nbsp를 대체해 glue를 풀 수 있으므로 금지). **다만 현재 구현은 `normal`뿐** — Chrome 151에서 세부 값은 전부 미지원이라 `normal`만 제안한다. **§13-2(진보적 향상)** — `text-spacing-trim`(§7 CJK 구두점, 값은 `normal` — `trim-start`는 반대 동작이고 OpenType `halt`/`chws` 없는 폰트에선 비활성)·`text-box-trim`+`text-box-edge`(§10·§6 세로 리듬)·`hanging-punctuation`(한국어 본문엔 `allow-end`, Safari 한정)은 **반드시 `@supports (속성: 값)`로 감싸** 제안하고 미지원 폴백(현행 유지)을 근거에 명기. **게이트는 실제 쓸 문법과 같아야 한다** — `text-box` 단축을 쓰면 `@supports (text-box: trim-both cap alphabetic)`로 물어야 longhand만 아는 엔진에서 무시되지 않는다. `text-box-trim`은 `text-box-edge` 없이는 지원 브라우저에서도 무효이므로 항상 함께 제안하고, **상속되지 않으므로 `:root`가 아니라 대상 요소에 직접** 건다(상속되는 `text-spacing-trim`과 다름). 전부 자동 삽입 금지 — 사람이 위치 승인.
  - `hierarchy`(theory §5·§6·§9): 구조 역할 분류는 **§5 판별표**(제목·부제·소제목·본문·목록·참고 목록·인용·캡션 — 제목 ≈80자 이하, 소제목은 종결어미 없이 끝나는 ≈60자 이하 줄, "참고 자료" 뒤는 참고 목록) 기준. 역할별 type-scale·웨이트·**명도 램프** 제안 — **단일 폰트가 기본**이며 폰트 페어링은 질감 대비가 필요할 때만 쓰는 선택 수단(§9).
  - `paragraph-rhythm`(§10): 단락 간 세로 여백 운율 + 표제부/본문 분리 여백. `layout-image`(§11): 본문 약 1,000자당 1곳(최대 4곳), 섹션 전환점(소제목 앞) 우선으로 이미지 영역 위치/비율 제안(자동 삽입 금지).
  - `spelling`: prose를 읽고 **문맥 의존 띄어쓰기**(의존명사·보조용언·합성어)·오타·맞춤법 교정안(`text-replace`). 한글 맞춤법·국립국어원 기준. 미래 날짜 등 사실 의심은 *교정이 아니라 질문*으로.
  - `cjk-break-css`: 본문에 `word-break: keep-all` 없으면 CSS 제안.

### 5. Propose — 이슈를 result.json으로
모든 이슈를 `scripts/lib/issues.mjs`의 `makeIssue()` 형태로 모아 `buildResult()`로 감싸 `.better-typo/result.json`에 저장.

### 6. DIFF
파일별로 적용 시 모습을 통합 diff로 보여주고, 각 변경에 한글 한 줄 근거(`theory §N`)를 단다. CSS 이슈는 어떤 파일/셀렉터에 넣을지 함께 제시.

### 7. Apply (승인 후)
```
node scripts/apply.mjs .better-typo/result.json <승인한 id...>      # id 생략 시 전부
node scripts/apply.mjs .better-typo/result.json --dry               # 미리보기
```
`apply.mjs`는 멱등(이미 nbsp/wbr면 skip)·안전(prose 밖 거부·before 불일치 skip)하게 바이트를 고친다. **css-rule은 자동 적용 안 함** — 사람이 위치를 정한 뒤 Edit로 직접 반영.

**적용 순서 — 출판 워크플로우와 동일 (교정→판형→조판→마감)**:
1. **교정** — 글자 수를 바꾸는 카테고리(`spelling`·`punctuation-hygiene`)를 먼저 적용해 텍스트를 확정한다.
2. **판형** — 승인된 `css-rule` 전부(keep-all·measure·행간·type-scale·자간)를 반영한다. 폭·글자 크기·자간 변경은 모두 줄바꿈 위치를 움직이므로, 폭 종속 교정보다 반드시 먼저다 (theory §1 적용 순서 근거).
3. **조판** — 재프로브 → 그 측정으로 `cjk-line-break`·`orphan-widow` fix를 산출·적용한다.
4. **마감** — 재검증. hygiene 재검출이 **0건이 될 때까지 재적용**한다 — 겹침 해소가 한 지점당 한 교정만 남기므로 겹친 교정은 다음 실행에서 수렴한다(멱등이라 반복 안전).

순서를 지키지 않으면 뒤의 텍스트·판형 변경이 앞의 줄바꿈 측정을 무효화해 한 단어 줄이 재발한다.

### 8. Re-verify
3번 프로브를 다시 돌려 `lines[].lastWord` before/after를 비교한다. 줄 끝 분리 해소·고아 해소·measure/행간 개선을 **측정으로** 확인.

### 9. (선택) 런타임 자동보정 안내 — 모든 화면 폭에서 유지
위 교정은 **한 폭에서만** 맞다. 실제 독자는 화면 폭·폰트·확대율이 제각각이라, 좁은 폰에서는
줄바꿈이 달라져 고아·글루가 그 화면에서 다시 어긋난다. **반응형 페이지**를 다룰 때는 사용자에게
`resources/better-typo.js`(런타임 스크립트)를 **페이지에 넣도록 안내**한다 — 로드·리사이즈 때마다
그 화면의 실제 폭으로 Canvas 재측정해 §1(숫자+단위 glue)·§2(마지막 줄 한 단어)를 실시간 보정한다.

```html
<script src="better-typo.js" defer></script>   <!-- article/main/.prose 안 본문을 자동 보정 -->
```
- 대상 변경: `<script>window.BETTER_TYPO_ROOT = '.article-body';</script>` 를 먼저 둔다.
- 안전: 코드·URL·contenteditable은 안 건드리고, 삽입하는 건 nbsp뿐(원문 글자 불변). 리사이즈 왕복에도 멱등.
- 측정은 Canvas라 reflow 없음(theory §3). **자동 삽입하지 말고** — 파일을 어디에 둘지·`<script>`를 어디 넣을지는 사람이 정하도록 diff/안내로만 제안한다.
- 정적(비반응형) 문서면 이 단계는 불필요 — 8번까지의 빌드 타임 교정으로 충분하다.

## How to detect bad Korean line breaks (핵심)
probe가 각 시각적 줄의 마지막 단어를 준다. 다음이면 나쁜 줄내림:
- 줄 끝 단어가 숫자이고 다음 줄 시작이 단위 (`2026` | `년`) → `findAtomicSpaces`가 잡음
- 줄 끝이 명사, 다음 줄이 조사로 시작 → 명사+조사 분리
- 줄 끝이 고정 복합어의 앞부분 (`Claude` | `Code`)
- 마지막 줄 글자수 ≤ 4 → 고아
각 경우, 해당 공백의 **소스 오프셋**을 찾아 `insert-nbsp` fix를 만든다. (렌더 인덱스 ≠ 소스 오프셋이므로, prose 청크에서 해당 단어 쌍을 다시 찾아 오프셋 확정.)

## Issue shape & categories
`makeIssue({ category, severity, file, message, fix?, evidence? })`
- category: `cjk-line-break` `orphan-widow` `measure` `line-height` `type-scale` `letter-spacing` `value-contrast` `font-pairing` `paragraph-rhythm` `layout-image` `punctuation-hygiene` `cjk-break-css` `css-text-modern` `spelling`
- fix.kind: `text-replace`(range) | `insert-nbsp`(at) | `insert-wbr`(at) | `css-rule`(cssTarget)
- before/after는 diff·멱등성 확인용. 자세한 형태는 README / 플랜 참조.

## Fix authoring rules
- LLM은 **구조화된 fix만** 만든다. 바이트 변형은 `apply.mjs`가 한다 (절대 free-hand Edit 금지).
- 멱등: 같은 지점 재실행이 중복 삽입을 만들면 안 됨 → at은 공백 위치, apply가 NBSP 여부 확인.
- 파일 타입별 프리미티브: `.md`/`.html`은 `&nbsp;`(U+00A0)·`<wbr>`; `.mdx` JSX 컨텍스트는 `{" "}`·`<wbr/>`, 속성 안 금지.
- 과도한 glue 금지(좁은 뷰포트 overflow) — 이론상 정당한 단위만.

## Spellcheck (맞춤법/오타)
외부 API 없이 네가 직접 prose를 읽고 교정. 오류 교정에 한정하고 문체 리라이팅은 사용자 요청 시에만.

## Risks / guardrails (theory 가드레일 준수)
- protected 영역 절대 변형 금지 (segment가 결정, apply가 재확인).
- CSS는 silent 수정 아님 — 대상 파일·셀렉터 제안 후 사람이 승인.
- 본문(≥12자 텍스트 요소)만 줄내림 대상, 제목은 자간/스케일로 별도.

## Verification
`resources/sample.html`로 before/after:
1. `file://` 로 열어 probe → 줄별 lastWord/measuredCh/행간 기록 (나쁜 항목 검출 기대)
2. 제안 적용
3. 재측정 → (a) 글루 단위 줄 끝 분리 해소 (b) 고아 해소 (c) measuredCh 25–45 (d) 본문 행간 ≥1.5 (e) 이중공백 제거 (f) `2026 년`→`2026 년` glue, 날짜 의심 플래그

## Automation hook (트리거는 범위 밖)
코어는 `(파일 집합) → (이슈, 제안) + 적용`의 순수 절차. 주기 실행 시 코어 불변, 호출만 다름.
- 무인 실행: `--auto-apply punctuation-hygiene,cjk-line-break` 같이 **저위험 카테고리만** 자동 적용,
  판단 카테고리(spelling/type-scale/css)는 `result.json`/PR로 남겨 사람 검토.
- 기존 `/loop`·`/schedule`이 이 스킬을 glob 전체에 돌리도록 래핑하면 됨.

## 응답 언어
사용자 언어(한국어)로 설명한다.
