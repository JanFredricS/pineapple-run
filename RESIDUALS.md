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
| R8 | S3 | An unsplittable imported span (no provably-straight cut anywhere) stays ONE chain regardless of maxChunks; memory bounded by validate's caps (100k pts/span, 200k total, 2000 spans), not by the chunk cap. | low | Bounded by input validation; note for S8 perf pass |
| R9 | S3 | Chunk extent lookup is a linear scan of recorded overhang pieces per body window. | low | Tiny in practice; revisit if profiling flags it |
| R10 | S3 | "Concave seams harmless" / "duplicate chain contacts harmful" Box2D claims rest on the fixer's measurements, not engine source (not in node_modules). | low | Behaviour pinned by physics comparison tests |
| R11 | S3 | Any chain split (even exact seams) can diverge cm-scale from a single chain in chaotic scenarios (bounces/tumbles); grows smoothly, not a catch. Physics comparison tests use non-amplifying scenarios. | low | Inherent to chunked chains; documented |
| R12 | S7 | Audio resume recovery is capped at 3 timed retries (250ms/1s/3s); after that recovery is gesture-only. A failed gesture resume while still visible waits for the NEXT gesture rather than auto-retrying. | low | Deliberate: no resume() without user interaction behind it |
| R13 | S7 | importScan tokenizer misclassifies a regex literal appearing directly after `)` or `]` as division (documented in the scanner). No such pattern exists in src/audio; scanner self-tests pin behaviour. | low | Documented limitation; revisit only if scan scope widens |
| R14 | S6 | Debris that comes to rest INSIDE the loaded terrain window persists until the cart moves away; bounded by cart part count, so not a growth risk. Long-run device profiling (frame time, WASM heap, GC over 10+ min) deferred to S8. | low | Headless test pins bounded body counts; timing needs a device |
| R15 | S6 | A destroyed run/build attempt's "Loading…" root lingers until its pending loaders settle (then removed). Cleanup of a partially-failed Pixi init is best-effort (teardown errors caught+logged). | low | Cosmetic / defensive path; fake-DOM coverage only, live check in S6V |
| R16 | S6V | No contact-event SFX (bounce/impact sounds): the physics layer exposes no contact event stream to hook audio to. | low | Needs a physics-layer event surface; consider at S8/S9 |
| R17 | S6V | Saved/share-code cart designs are not re-checked against the build area, so an oversized circle could bypass the builder's clamp. | low | Builder drag is clamped; add load-time validation at S8 |
| R18 | S6V | Dev-only window.__prAudio handle is not cleared on teardown (DEV builds only). | low | Cosmetic dev affordance |
| R19 | S6T | Pineapple-wheel friction (~0.3 to stop wheel-lock) and real shock joint limits (V-sag on washboard teeth) both need additions to the frozen engine.ts wrapper (friction callback, joint limit API). | medium | Engine wrapper frozen through S6T; open it deliberately at S8 |
| R20 | S6T | Shortcut risk (losing cargo on a fast pool jump) is real but chaotic, so unasserted; minimal cart delivers only 1-3; no M-key mute shortcut; endless opening worst dull stretch 17.9 s vs the 20 s rule. | low | Playfeel margins; revisit if playtests complain |
