# Delivery process

How slices from PLAN.md get implemented and verified.

## Per-slice loop

1. **Implement** — a Claude Opus agent (fresh context) implements the slice
   from PLAN.md + the research docs. Parallel-safe slices run concurrently in
   isolated worktrees; blocking slices (S0, S6) run alone on main.
2. **Audit** — fresh-context review via the tender-analysis harness:
   `codex-audit.sh sol-medium <slice-brief> <diff>` (read-only sandbox).
   Cross-family rule: implementer is Claude, auditor is Codex — a re-audit
   must not swap to the implementer's family.
3. **Fix cycles (max 2)** — audit findings go back to the implementer agent;
   re-audit after each fix round.
4. **Fresh-context fixer** — if findings survive 2 fix cycles, a NEW Opus
   agent (fresh context, no attachment to the original implementation) gets
   the findings + diff and fixes them. One round.
5. **Residuals** — anything still open after the fixer is written to
   RESIDUALS.md (finding, slice, severity, why it's parked) and work
   continues. Residuals are revisited at S8 (hardening) or when they block a
   later slice.

## Concurrency

- S0 first, alone (it freezes the contracts everything else mocks against).
- S1–S5 concurrently after S0 passes audit.
- S7 concurrent with S6. S8 after S6/S7. S9 last.
- Contract changes after S0 are stop-the-line: pause dependent slices,
  amend the contract + mocks, resume.

## CI / hosting

- `.github/workflows/deploy.yml`: on every push/PR — `npm test` + Vite build;
  on main — deploy to GitHub Pages (falls back to `site/` placeholder until
  the app scaffold exists).
- Pages requires the repo to be public or the account to have GitHub Pro;
  see RESIDUALS.md if not yet enabled.
