# better-typo — 에이전트 가이드 (Codex 등 범용)

한글/CJK 웹 문서(HTML/MDX/Markdown)의 편집디자인 타이포그래피를 이론에 근거해 **실제로 개선**한다.
이 문서는 **Claude Code 외 에이전트(OpenAI Codex 등)** 가 이 스킬을 쓰는 방법을 설명한다.
Claude Code 사용자는 `SKILL.md`를 따른다 — 두 문서는 같은 코어(`scripts/*.mjs`, `resources/theory.md`)를 가리킨다.

## 핵심 원칙 (에이전트 무관)
- **단일 기준**: 모든 임계값·규칙·사전은 `resources/theory.md`가 유일 출처다. 근거는 `(theory §N)`로 인용한다.
- **역할 분리**: 되돌리기 어려운 바이트 변형은 **무의존성 Node 스크립트**가 하고, 문맥·미학 판단은 **에이전트(LLM)**가 한다. 에이전트는 free-hand로 파일을 고치지 않는다.
- **제안 → 승인 → 적용**: 승인 전에는 파일을 수정하지 않는다.
- **protected 불가침**: 코드·인라인코드·URL·태그·frontmatter·수식·MDX 표현식은 절대 변형하지 않는다(`segment.mjs`가 결정, `apply.mjs`가 재확인).

## 빠른 시작 — CLI 진입점 (에이전트 중립)
결정적(스크립트) 단계는 에이전트 없이 한 번에 돌릴 수 있다:
```bash
node .claude/skills/better-typo/scripts/run.mjs <파일|디렉터리...>          # 검출 → .better-typo/result.json + 요약
node .claude/skills/better-typo/scripts/run.mjs <파일...> --dry              # 적용 미리보기(파일 불변)
node .claude/skills/better-typo/scripts/run.mjs <파일...> --apply            # 저위험 결정적 항목 실제 적용
node .claude/skills/better-typo/scripts/run.mjs <파일...> --json             # result.json을 stdout으로(도구 연동)
```
`run.mjs`가 처리하는 것(안전·형태로 확정): 문장부호/공백 정리(§7), 숫자+단위·고정 복합어 glue(§1).
`run.mjs`가 **하지 않는 것**(에이전트 판단 필요, 아래 파이프라인): 줄내림·마지막 줄 한 단어(고아)·맞춤법·위계·measure·행간·CSS 제안.

## 전체 파이프라인
```
discover → segment → (render/probe) → detect → propose → DIFF → approve → apply → re-verify
```

### 1. Discover
대상 문서 수집: `.html/.htm/.md/.mdx` (node_modules·dist·build 등 제외). `run.mjs`의 discover가 동일 규칙.

### 2. Segment (안전 핵심)
```bash
node .claude/skills/better-typo/scripts/segment.mjs <file>   # prose/protected 스팬 JSON
```
protected 스팬은 이후 어떤 변형도 금지. 모든 수정은 prose 스팬 안에서만.

### 3. Render & probe — 실제 줄바꿈 측정 (에이전트별로 다름)
정적 소스만으론 브라우저가 *실제로* 어디서 줄을 끊는지 모른다. 렌더해서 측정하는 게 이상적이다.
- **브라우저 자동화가 가능한 에이전트**: 문서를 로컬 서버/`file://`로 열고, `scripts/lib/probe.js`의 함수 본문을 페이지에서 evaluate → 요소별 computed style + `measuredCh`(한글 글자폭 보정) + `lines[].lastWord`를 얻는다.
  - (Claude Code는 `mcp__playwright__browser_navigate` / `browser_evaluate`를 쓴다. Codex 등은 자체 브라우저 도구가 있으면 동일하게, 없으면 아래 폴백.)
- **브라우저가 없는 환경(정적 폴백)**: probe를 건너뛴다. 그러면 다음만 가능하다 — `run.mjs`의 결정적 항목(hygiene·glue)과 `cjk-break-css`(본문에 `word-break: keep-all` 누락 시 CSS 제안). **줄내림·마지막 줄 한 단어(고아) 판단은 생략**(실측이 없으므로). 이를 사용자에게 명시한다.

### 4. Detect
- **결정적(스크립트)**: `node .claude/skills/better-typo/scripts/hygiene.mjs <file>` (문장부호/공백 — 괄호는 교정하지 않음: 여는 괄호는 앞말에 붙임(국립국어원), 닫는 괄호 뒤는 §8 문맥 판단), `findAtomicSpaces()`(`scripts/lib/unit-rules.mjs`, 숫자+단위 glue). probe가 있으면 `evaluateMeasurements()`(`scripts/measure.mjs`)로 measure/line-height/type-scale/letter-spacing.
- **판단(에이전트)**: theory 참조로 아래를 만든다.
  - `cjk-line-break`: probe `lines[].lastWord`를 보고 줄 끝 어절/의미 단위가 부자연스럽게 끊겼으면 glue 공백의 **소스 오프셋**을 골라 `insert-nbsp` fix.
  - `orphan-widow`: 마지막 줄 글자수 ≤4(§2)면 직전 공백을 nbsp로. 사용자에겐 "마지막 줄 한 단어"로 표현(고아/orphan은 이론 용어).
  - `hierarchy`(§5·§6·§9): §5 판별표(제목·부제·소제목·본문·목록·참고 목록·인용·캡션)로 역할 분류 → type-scale·웨이트·명도 램프 제안. **단일 폰트가 기본**, 폰트 페어링은 선택.
  - `paragraph-rhythm`(§10), `layout-image`(§11), `spelling`(§8, 오타 사전·의존명사 '수'·문맥 띄어쓰기 — 미래 날짜 등 사실 의심은 *질문*으로), `cjk-break-css`.

### 5·6. Propose → DIFF
이슈를 `scripts/lib/issues.mjs`의 `makeIssue()` 형태로 모아 `buildResult()`로 감싸 `.better-typo/result.json`에 저장. 파일별 통합 diff + 각 변경에 `(theory §N)` 한 줄 근거를 사용자에게 제시. CSS 이슈는 대상 파일·셀렉터를 함께 제안.

### 7. Apply (승인 후)
```bash
node .claude/skills/better-typo/scripts/apply.mjs .better-typo/result.json <승인한 id...>   # id 생략 시 전부
node .claude/skills/better-typo/scripts/apply.mjs .better-typo/result.json --dry            # 미리보기
```
`apply.mjs`는 멱등(이미 nbsp/wbr면 skip)·안전(prose 밖 거부·before 불일치 skip). **css-rule은 자동 적용 안 함** — 사람이 위치를 정한 뒤 반영.

**적용 순서 (교정→조판→마감)**: 글자 수를 바꾸는 카테고리(`spelling`·`punctuation-hygiene`)를 **먼저** 적용해 텍스트를 확정 → 재프로브 → 그 측정으로 `cjk-line-break`·`orphan-widow` 산출·적용. 순서를 어기면 뒤 텍스트 변경이 앞 줄바꿈 측정을 무효화한다.

### 8. Re-verify
probe를 다시 돌려(가능 환경) before/after 비교. 줄 끝 분리·마지막 줄 한 단어 해소, measure/행간 개선을 측정으로 확인. 정적 환경이면 `run.mjs`로 hygiene 재검출 0건(멱등)만 확인.

## fix 형식
`makeIssue({ category, severity, file, message, fix?, evidence? })`
- category: `cjk-line-break` `orphan-widow` `measure` `line-height` `type-scale` `letter-spacing` `value-contrast` `font-pairing` `paragraph-rhythm` `layout-image` `punctuation-hygiene` `cjk-break-css` `spelling`
- fix.kind: `text-replace`(range) | `insert-nbsp`(at) | `insert-wbr`(at) | `css-rule`(cssTarget)
- 파일 타입별 프리미티브: `.md`/`.html`은 `&nbsp;`(U+00A0)·`<wbr>`; `.mdx` JSX는 `{" "}`·`<wbr/>`(속성 안 금지).

## 시각 확인 (선택) — studio.html
`resources/studio.html`은 theory 규칙을 브라우저에서 재현한 시연 도구다. 로컬 서버로 열어 사용자가 직접 글을 넣고 다듬는 과정을 볼 수 있다(파일은 안 고침):
```bash
cd .claude/skills/better-typo/resources && python -m http.server 8799   # → http://localhost:8799/studio.html
```

## 응답 언어
사용자 언어로 설명한다(한국어 문서면 한국어).
