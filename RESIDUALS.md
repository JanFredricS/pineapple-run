# Residuals

Open items that survived their slice's fix cycles, or can't be done by
agents. Revisit at S8 (hardening) or when they block a later slice.

| # | Slice | Item | Severity | Why parked |
|---|---|---|---|---|
| R1 | infra | ~~GitHub Pages not enabled~~ RESOLVED 2026-09-22: repo made public (user decision), Pages enabled, deploy green, live at https://janfredrics.github.io/pineapple-run/ | — | done |
| R2 | S0 | Real-phone stability/60fps verification of the spike (agents can only verify in desktop browser). Spike is live at https://janfredrics.github.io/pineapple-run/ | medium | Needs a human with a phone |
| R3 | S0 | ScoreBook eviction UX nuances: a just-played low-rated level can be evicted next; tie-break is "least recently improved" not "least recently played". | low | Cosmetic; revisit if score UX matters in S5 |
| R4 | S0 | `src/model/validate.ts:325` props limit is an inline `10_000` literal, not a named shared constant (no helper counterpart, so no drift risk today). | low | Cleanup; fold into S3 or S8 |
| R5 | S4 | Same-revision, same-structure new world is only re-drawn if the source calls `resetSource()` (documented in scene.ts; the styleguide and any S6 world switch must call it — INTEGRATION.md item 11 area). | low | Documented contract; verify call sites at S6 |
| R6 | S4 | Terrain join tolerance is coordinate-scaled for float32 transforms; beyond ~21 km real gaps under ~1 cm can be visually joined (physics unaffected). Stated bound in terrainMesh.ts. | low | Beyond practical endless distances; revisit at S9 if runs go further |
| R7 | S4 | Renderer signature memory is O(serialized manifest); bounded only because validated levels cap terrain at 200k points — `SceneManifest` itself has no renderer-enforced bound. | low | All in-repo sources are validated; note for S8 |
