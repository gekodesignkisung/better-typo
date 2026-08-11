---
name: better-typo
description: 한글/CJK 웹 문서의 편집디자인 타이포그래피를 개선한다. 줄내림, 글줄 길이, 행간, 위계, 자간, 문장부호, 맞춤법/오타를 점검하고 수정안을 diff로 제안한 뒤 승인된 항목만 적용할 때 사용.
---

# better-typo for Codex

이 파일은 Codex가 발견하는 repo skill 진입점이다. 실제 코어는 기존 Claude Code 스킬과 공유한다.

## 사용 절차

1. 먼저 `.claude/skills/better-typo/AGENTS.md`를 끝까지 읽고 따른다.
2. 스크립트는 repo root 기준으로 `.claude/skills/better-typo/scripts/` 아래 파일을 실행한다.
3. 이론·임계값·사전은 `.claude/skills/better-typo/resources/theory.md`만 단일 기준으로 삼는다.
4. 브라우저 자동화가 가능하면 Codex의 현재 도구로 probe를 수행한다. 불가능하면 `AGENTS.md`의 정적 폴백을 따른다.
5. 승인 전에는 대상 문서를 직접 수정하지 않는다. 결정적 항목 적용도 먼저 diff 또는 dry-run 결과를 제시한다.

## 빠른 명령

```bash
node .claude/skills/better-typo/scripts/run.mjs <file|dir...>
node .claude/skills/better-typo/scripts/run.mjs <file|dir...> --dry
node .claude/skills/better-typo/scripts/apply.mjs .better-typo/result.json <approved-id...>
```

## 주의

- `.claude/skills/better-typo/SKILL.md`는 Claude Code용 진입점이다.
- `.claude/skills/better-typo/AGENTS.md`는 Codex 등 범용 에이전트용 상세 가이드다.
- 이 파일은 Codex 스킬 발견을 위한 얇은 wrapper이며, 코어 로직을 중복하지 않는다.
