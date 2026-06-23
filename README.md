# better-typo

한글/CJK 웹 문서의 **편집디자인 퀄리티**를 이론에 근거해 실제로 개선하는 Claude Code 스킬.

> 진단 리포트가 아니라, 실제로 문서를 고친다. 특히 한글 본문에서 같은 글의 인상을 좌우하는
> **줄내림(줄바꿈) 위치** 같은 미세하고 디테일한 부분을 다듬는다.

## 왜 만드는가

웹페이지의 문서 퀄리티는 아주 미세한 부분에서 결정된다. 한글/CJK는 영어와 달리 단어 경계 개념이
약해서 브라우저가 임의 지점에서 줄을 끊는다. 의미 단위(어절·구문)로 줄이 끊기면 깔끔하고, 조사 앞이나
명사 중간에서 끊기면 지저분해 보인다. `better-typo`는 이런 줄내림을 비롯해 글줄 길이(measure), 행간,
위계, 자간, 문장부호, 맞춤법/오타까지 편집디자인 이론에 따라 진단하고 **수정안을 제안 → 승인 시 적용**한다.

## 동작 모드

```
discover → segment → (render/probe) → detect → propose → DIFF → approve → apply → re-verify
```

승인 전에는 절대 파일을 수정하지 않는다. 모든 변경은 통합 diff와 한글 근거 설명으로 먼저 제시된다.

## 설계 원칙

되돌리기 어려운 바이트 변형은 LLM이 직접 하지 않는다. LLM은 "어디를 어떻게 고칠지" 구조화된 제안만
만들고, 무의존성 Node 스크립트가 정확하고 멱등하게 적용한다.

| | 담당 |
|---|---|
| prose/protected 분리, 문장부호 정규화, measure·행간 산술, 멱등 적용 | **스크립트** (결정적) |
| 의미 단위 줄내림 판단, 고아/과부, 한글 맞춤법, 위계 결정 | **LLM 에이전트** (판단) |

## 설치

이 레포의 `.claude/skills/better-typo/`를 사용하려는 프로젝트의 `.claude/skills/`로 복사하거나,
전역 스킬 디렉터리에 둔다. Claude Code에서 `/better-typo`로 호출한다.

## 구조

```
better-typo/
├── README.md
└── .claude/skills/better-typo/
    ├── SKILL.md                # 오케스트레이터
    ├── scripts/
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
        └── sample.html         # before/after 검증 픽스처
```

## 이론

모든 임계값과 규칙은 [theory.md](.claude/skills/better-typo/resources/theory.md)에 문서화되어 있다.
스크립트와 LLM은 동일한 숫자를 인용한다.

## 라이선스

MIT
