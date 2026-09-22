# Residuals

Open items that survived their slice's fix cycles, or can't be done by
agents. Revisit at S8 (hardening) or when they block a later slice.

| # | Slice | Item | Severity | Why parked |
|---|---|---|---|---|
| R1 | infra | ~~GitHub Pages not enabled~~ RESOLVED 2026-09-22: repo made public (user decision), Pages enabled, deploy green, live at https://janfredrics.github.io/pineapple-run/ | — | done |
| R2 | S0 | Real-phone stability/60fps verification of the spike (agents can only verify in desktop browser). Spike is live at https://janfredrics.github.io/pineapple-run/ | medium | Needs a human with a phone |
| R3 | S0 | ScoreBook eviction UX nuances: a just-played low-rated level can be evicted next; tie-break is "least recently improved" not "least recently played". | low | Cosmetic; revisit if score UX matters in S5 |
| R4 | S0 | `src/model/validate.ts:325` props limit is an inline `10_000` literal, not a named shared constant (no helper counterpart, so no drift risk today). | low | Cleanup; fold into S3 or S8 |
