# Light review record: D-017 stay-in-place navigation (2026-10-29)
*Kept by the review-loop skill. Safe to delete this folder once the work is done.*

Reporting on **coherence** (does the code do what D-017 says, without breaking
what worked). Merit, meaning whether the behavior feels right, is for Frank to judge in use.

| Step | Who | Result |
| --- | --- | --- |
| Plan | claude-8048 | PLAN.md, committed 92ac5e2 before any reader saw it |
| Critic | Codex gpt-6-luna, read-only | 1 HIGH, 2 MEDIUM (critic-codex-gpt-6-luna.md) |
| Blind solver | Claude Opus 5.5 Plan agent, given only the problem and D-017 | Independent design with 5 extra findings (solver-claude-plan-agent.md) |
| Decisions | Frank | Completed tasks leave Inbox/project views; deleted project opens Today with a message; fix the sort-reload bug here |
| Build | claude-8048 | d0e5d3c (sort fix), 43ca40f (D-017) |
| Fix auditor | Codex gpt-6-luna, read-only, given the diff and the one decline | No findings; the decline holds (fix-auditor-codex-gpt-6-luna.md) |

Taken: everything in PLAN.md "Revision 1". The sync-reset HIGH was found
independently by both peers (tier 1); the rest were checked against the code.

Declined: explicit replacement on detail `C` (solver), because completed tasks now
leave Inbox and project views. The fix auditor agreed.

Not done: no use against the real Todoist account, which would write to live data.
Use was through the browser suites, in demo mode and against a fake Todoist upstream.

Believed, and wrong: "Bulk actions, `T`/`Shift+T`/`C`/`D`, `M`, recurring
completions and sync deltas all go through the same render path, so they need
no special code." Sync deltas did not: `reconcileTaskSelection` reset the
cursor before render.

Tests: typecheck; 322 unit tests; browser suites 21 + 4 + 8 checks, all passing with
Playwright's Chromium (the system Chrome 152 crashes mid-suite on main as well).
