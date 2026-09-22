**The plan is not ready for parallel implementation.** The stack choices are coherent, but several gameplay rules and cross-slice contracts remain undefined.

This was a read-only review of `PLAN.md` and the three supporting research documents. **I have no Docker access and cannot execute the suites.** Findings below concern the plan; they do not establish runtime failures or confirmed security vulnerabilities.

### High severity

1. **S0 freezes data schemas, but not the interfaces required for parallel work.**  
   [PLAN.md:64](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:64), Architecture / S0–S5.  
   `CartDesign` and `LevelDef` do not specify runtime commands/events, physics snapshots for rendering, coordinate transforms, resource ownership, or lifecycle methods. Responsibility also overlaps: S1 owns drive controls and goal counting; S5 owns HUD, Release flow, and scoring; `run/` already lists scoring.  
   **Failure scenario:** S1 finalizes a run on a sensor event while S5 independently controls timer/results transitions. Both slices work standalone but require incompatible changes during S6. S0 needs explicit interfaces, ownership, and mock implementations for these seams.

2. **Endless mode has no playable rules beyond terrain generation.**  
   [PLAN.md:103](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:103), S3 / S5 / S6.  
   The only defined ending requires a blender, and the only score depends on delivery and time. Endless mode defines neither a goal alternative nor distance scoring, cargo-loss termination, checkpoint behavior, or best-score identity.  
   **Failure scenario:** a player travels indefinitely without reaching results; after 115 seconds the existing efficiency formula yields zero regardless of progress. Define endless run lifecycle and scoring before freezing the schemas.

3. **Fixed stepping alone does not establish fair scoring.**  
   [PLAN.md:39](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:39), Core mechanics / S0 / S5.  
   The plan says fixed stepping fixes wall-clock unfairness, but does not define whether `seconds` measures simulation or wall time, how accumulated time is handled, or what happens when the app is hidden.  
   **Failure scenario:** a phone suspends rendering during an app switch while the scoring clock continues. The same simulated run receives a worse score. Define the clock, pause policy, catch-up limit, and Release timing together.

4. **Attachment semantics are insufficient to make builder output agree with physics.**  
   [PLAN.md:84](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:84), S1 / S2.  
   Overlap preview and compound construction belong to different slices, without a shared geometry rule. The plan omits powered-wheel anchor selection, shock endpoint resolution, ambiguous overlaps, and behavior after deleting an attached part. The research explicitly describes wheel-center attachment and shock snapping within 10 px (`research/coconut-run-mechanics.md:45–48`).  
   **Failure scenario:** the builder previews a shock attached to a wheel, but S1 resolves its endpoint to the overlapping chassis, producing a different suspension. Freeze attachment and geometry semantics, including valid/invalid cases, in S0.

5. **Endless terrain eviction has no relationship to live bodies or reverse driving.**  
   [PLAN.md:103](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:103), S3.  
   “Destroy behind” specifies neither the tracking reference nor retention rules. Cargo and disconnected cart bodies can remain behind the camera, and reverse driving is explicitly supported.  
   **Failure scenario:** advancing the leading body removes terrain under trailing pineapples; reversing then reaches unloaded ground. Define retention, regeneration, out-of-range body handling, and matching renderer cleanup.

### Medium severity

6. **S0’s “small” stability gate depends on work assigned to S1.**  
   [PLAN.md:73](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:73), S0 / S1.  
   The blocking spike requires a functioning chassis, powered-wheel assembly, cargo, and terrain before the slice implementing compound construction and driving starts. The plan does not distinguish reusable production work from temporary spike code.  
   **Failure scenario:** S0 validates a hand-built compound body, but S1’s actual `CartDesign` conversion produces different mass or joint anchors; the earlier stability gate does not cover the shipped construction path. Move the necessary production assembly into S0 or explicitly require revalidation after S1.

7. **The level contract does not specify how gaps are represented.**  
   [PLAN.md:99](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:99), S3 / S6.  
   Terrain is described as a height profile and chain shapes, while the kitchen level explicitly requires gaps. No disconnected terrain spans or equivalent collision representation are specified.  
   **Failure scenario:** S3 connects adjacent profile points across a desired gap, creating an invisible bridge; S4 may also draw a continuous surface. Require discontinuities in both the level schema and map-builder editing model.

8. **Import and persistence handling stops at “versioned JSON.”**  
   [PLAN.md:95](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:95), S0 / S2 / S3 / S5.  
   No slice owns runtime validation, supported-version handling, migration/rejection, corrupt saves, or storage failures. Geometry limits and valid joint references are also unspecified.  
   **Failure scenario:** an imported level contains duplicate terrain points or a cart references a deleted part; the invalid design reaches physics construction. An older saved cart can similarly stop loading after a schema change. Define validation and recoverable error behavior before these consumers diverge.

9. **Mobile input cancellation and gesture arbitration are missing.**  
   [PLAN.md:91](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:91), S1 / S2 / S8.  
   The plan names touch buttons, drawing, pinch zoom, and pan, but not cancellation, focus loss, simultaneous controls, or transitions between drawing and multitouch gestures.  
   **Failure scenario:** a second finger starts zooming while the first is drawing, accidentally committing a large part; a canceled drive gesture leaves torque applied. Specify gesture ownership and clear input state on cancellation, blur, and phase changes.

10. **There is no regression strategy for the highest-risk behavior.**  
    [PLAN.md:87](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:87), S1 / S8.  
    A harness page and device performance pass are useful, but no automated assertions or repeatable acceptance scenarios are assigned for compound connectivity, attachment resolution, scoring boundaries, serialization, terrain seams, or retry cleanup.  
    **Failure scenario:** a welding change preserves the example cart but breaks a valid chain of overlapping parts, and every stated acceptance check still passes. Assign these checks to their owning slices and include them in integration acceptance.

11. **The mechanics table silently changes recovered cargo behavior.**  
    [PLAN.md:34](/Users/janfredricsandvik/dev/pineapple-run/PLAN.md:34), Core mechanics.  
    The table is labeled “from the original,” but adds rolling resistance and describes “ellipse-ish circles.” The recovered specification says free circles with minimal damping (`research/coconut-run-mechanics.md:127–129`); rolling resistance is a proposed improvement in the stack research, not recovered behavior.  
    **Failure scenario:** appreciable rolling resistance keeps cargo in a shallow cart that would spill in the original, changing the intended challenge. Mark this as an intentional deviation, specify the coefficient, and distinguish sprite appearance from collision shape.

The compound-body approach, physics isolation, early deployed device spike, and keeping bead-ocean work optional are sound. I found no basis to reject the locked stack or claim a confirmed security issue from this plan alone.
[exited with code 0]
