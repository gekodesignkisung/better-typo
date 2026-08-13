# better-typo

한글/CJK 웹 문서의 **편집디자인 퀄리티**를 이론에 근거해 실제로 개선하는 **에이전트 스킬**.
Claude Code와 OpenAI Codex 등 범용 에이전트가 같은 코어(스크립트·이론)를 공유해 동일하게 동작한다.

> 진단 리포트가 아니라, 실제로 문서를 고친다. 특히 한글 본문에서 같은 글의 인상을 좌우하는
> **줄내림(줄바꿈) 위치** 같은 미세하고 디테일한 부분을 다듬는다.

## 왜 만드는가

웹페이지의 문서 퀄리티는 아주 미세한 부분에서 결정된다. 한글/CJK는 영어와 달리 단어 경계 개념이
약해서 브라우저가 임의 지점에서 줄을 끊는다. 의미 단위(어절·구문)로 줄이 끊기면 깔끔하고, 조사 앞이나
명사 중간에서 끊기면 지저분해 보인다. `better-typo`는 이런 줄내림을 비롯해 글줄 길이(measure), 행간,
위계, 자간, 문장부호, 맞춤법/오타, 그리고 **AI 글 특유의 흔적**(양옆 공백 엠대시·산문 화살표 등)까지
편집디자인 이론에 따라 진단하고 **수정안을 제안 → 승인 시 적용**한다. 새 글뿐 아니라 **이미 서식이 있는
기존 페이지를 개선**할 때도, 원본의 태그·폰트 같은 조판 의도를 읽어 역할 분류에 반영한다.

## 동작 모드

```
discover → segment → (render/probe) → detect → propose → DIFF → approve → apply → re-verify
```

승인 전에는 절대 파일을 수정하지 않는다. 모든 변경은 통합 diff와 한글 근거 설명으로 먼저 제시된다.

## 설계 원칙

되돌리기 어려운 바이트 변형은 LLM이 직접 하지 않는다. LLM은 “어디를 어떻게 고칠지” 구조화된 제안만
만들고, 무의존성 Node 스크립트가 정확하고 멱등하게 적용한다.

| | 담당 |
|---|---|
| prose/protected 분리, 문장부호 정규화, measure·행간 산술, 멱등 적용 | **스크립트** (결정적) |
| 의미 단위 줄내림 판단, 고아/과부, 한글 맞춤법, 위계 결정 | **LLM 에이전트** (판단) |

## 설치 · 사용 (에이전트별)

이 레포의 `.claude/skills/better-typo/`를 사용하려는 프로젝트로 복사한다. 코어(`scripts/*.mjs`,
`resources/theory.md`)는 **에이전트 중립**이라 어디서든 같은 로직으로 동작한다.

- **Claude Code**: `.claude/skills/`에 두고 `/better-typo`로 호출 → `SKILL.md`를 따른다.
- **OpenAI Codex**: repo skill로 쓰려면 `.agents/skills/better-typo/SKILL.md`를 함께 둔다.
  Codex는 `$better-typo` 또는 description 매칭으로 이 wrapper를 발견하고, 실제 절차는
  `.claude/skills/better-typo/AGENTS.md`를 따른다.
- **다른 에이전트**: 같은 폴더의 `AGENTS.md`를 읽고 동일 파이프라인을 따른다.
  브라우저 자동화가 없으면 probe(실측 줄바꿈)를 건너뛰고 결정적 항목만 적용한다(정적 폴백).
- **에이전트 없이(사람·CI)**: CLI 진입점으로 결정적 교정을 바로 돌린다.
  ```bash
  node .claude/skills/better-typo/scripts/run.mjs <파일|디렉터리...>          # 검출 → .better-typo/result.json + 요약
  node .claude/skills/better-typo/scripts/run.mjs <파일...> --dry             # 적용 미리보기(파일 불변)
  node .claude/skills/better-typo/scripts/run.mjs <파일...> --apply           # 저위험 결정적 항목 적용
  ```
  줄내림·마지막 줄 한 단어·맞춤법·위계 등 판단이 필요한 항목은 에이전트 파이프라인이 맡는다.

## 구조

```
better-typo/
├── README.md
├── .agents/skills/better-typo/
│   └── SKILL.md                # Codex repo skill 진입점 (wrapper)
└── .claude/skills/better-typo/
    ├── SKILL.md                # Claude Code 오케스트레이터
    ├── AGENTS.md               # Codex 등 범용 에이전트 가이드 (같은 코어)
    ├── scripts/
    │   ├── run.mjs             # 에이전트 중립 CLI 진입점 (discover→detect→dry/apply)
    │   ├── segment.mjs         # prose/protected 토크나이저 (안전 핵심)
    │   ├── measure.mjs         # measure/line-height/type-scale 산술
    │   ├── hygiene.mjs         # 문장부호·공백 정규화
    │   ├── apply.mjs           # 승인된 제안 멱등 적용
    │   └── lib/
    │       ├── issues.mjs      # TypoIssue 팩토리·정렬·IO
    │       ├── probe.js        # Playwright 인페이지 줄바꿈 측정 문자열
    │       └── unit-rules.mjs  # 조사·숫자+단위·고유명사 원자 단위
    └── resources/
        ├── theory.md           # 이론·임계값 단일 진실 소스
        ├── studio.html         # 호출 시 여는 인터랙티브 스튜디오
        └── sample.html         # before/after 검증 픽스처
```

## 인터랙티브 스튜디오

브라우저에서 직접 글을 넣고 다듬는 과정을 보고 싶으면 스튜디오를 연다. theory.md
규칙을 브라우저에서 재현한 **시연·탐색 도구**로, 스크립트 파이프라인과 동일한 단위 집합·오타
사전·검출 규칙을 따른다(단일 기준은 theory.md).

**바로 열기 (GitHub Pages)** — 설치 없이 브라우저에서:

> **https://corca-ai.github.io/better-typo/**

(루트 `index.html`은 `resources/studio.html`로 리다이렉트만 한다 — 단일 사본 원칙.
`main`에 푸시하면 배포본도 자동 갱신된다.)

로컬에서 열려면:

```bash
cd .claude/skills/better-typo/resources
python -m http.server 8799      # 또는: npx --yes serve -l 8799 .
# → http://localhost:8799/studio.html
```

캔버스에 글을 붙여넣고 **교정 시작**을 누르면 7단계(구조 분석 → 위계 → 맞춤법·오타 → 정리 →
가독성 → 레이아웃 → 마무리 점검)로 다듬는 과정과 각 단계의 theory §근거가 표시된다.

- **붙여넣기 서식 유지**: 워드·노션·웹에서 복사한 글의 제목 크기·굵기·목록·인용을 그대로 보여
  주고(이미지·스크립트는 제거), 그 서식 의도를 역할 분류에 반영한다. 마크다운 마커가 없어도
  `<h1>`·`<li>`·큰 굵은 폰트만으로 제목·목록·소제목을 알아본다.
- **언어 자동 분기**: 문서의 한글 비율을 감지해 영문 글에는 라틴 기준(§3·§4)으로 자동 전환.
- **결과 복사**: 교정이 끝나면 완성본을 **마크다운으로 복사**할 수 있다.

스튜디오는 **시각적 탐색용**이며, 실제 파일 변형은 항상 `apply.mjs` 파이프라인(propose → DIFF →
approve)을 거친다.

## 이론

모든 임계값과 규칙은 [theory.md](.claude/skills/better-typo/resources/theory.md)에 문서화된 **단일
진실 소스**다(§1 줄내림 ~ §11 레이아웃, §12 AI 글 흔적 보정). 스크립트·LLM·스튜디오가 모두 동일한
숫자·단위 집합·오타 사전을 인용한다.

## 라이선스

MIT
