# Review Patterns

Curated patterns for PR comments, reviewer feedback, and final summaries. Add entries through `session-knowledge-curator`.

## Current Patterns

### Track every actionable comment to closure

- Learning: PR comment triage should map each actionable review thread to a concrete fix, validation evidence, and final summary response. GitHub thread resolution may remain manual even when code changes address the comment.
- Why it matters: It separates implementation completeness from GitHub UI thread state and produces reviewer-ready summaries.
- Source: Current session PR comment resolution workflow.
- Applies to: `pr-comment-triage`, `release-scribe`, `chief-engineer`.
- Status: verified.

### Scope-deferred reviewer suggestions need an explicit rationale reply

- Learning: When declining a reviewer suggestion (e.g., "extract these helpers into the shared module"), reply on the thread with the scope rationale (broadening the PR, requiring additional phase coverage, risking other suites) and confirm the in-scope fix that was applied. Do not silently skip a non-blocking suggestion.
- Why it matters: PR #9161 closed a reviewer thread about helper extraction by accepting the in-scope flakiness fix and explicitly deferring the cross-suite refactor with rationale. This kept the PR focused while leaving an auditable trail for the suggestion.
- Source: Azure/LogicAppsUX#9161 helper-extraction review thread; session `35f3ecef-6086-4148-9b2c-d57123f7c5e6`.
- Applies to: `pr-comment-triage`, `release-scribe`, `pr-orchestrator`, `chief-engineer`.
- Status: verified.
