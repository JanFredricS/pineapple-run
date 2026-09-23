# S8 check: Pages cache headers & load budget (2026-09-23, plan owner)

- Cache headers: GitHub Pages serves everything with `cache-control: max-age=600`
  (fixed, not configurable). Acceptable: the S5 service worker precaches the
  whole deploy under a content-digest cache, so repeat visits bypass HTTP
  caching entirely; the 10-min TTL only affects the SW update probe cadence.
- Load budget (<3 s on 4G): total dist 1.6 MB raw; JS+wasm 1.34 MB raw.
  Compressed transfer measured live: shell 608 B gz, largest chunk
  (attach) 71 KB gz, Box2D wasm 407 KB. Worst-case first visit is well
  under ~700 KB compressed → comfortably inside a 3 s 4G budget.
- Remaining S8 items (touch sizing, builder gestures, 60 fps on mid-range
  hardware, texture memory on-device) need a human with a phone (R2).
