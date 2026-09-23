No defects found. **GL1 passes.**

Static review confirms:

- `initApplication` destroys only when `app.renderer` exists.
- A renderer-less failed init is not destroyed.
- Cleanup exceptions are caught, and the original init error is rethrown.
- `runPixi` and `builderPixi` both use the helper.
- Builder behavior is unchanged from its prior inline cleanup.
- The new test explicitly verifies destruction of each failed app and that only the third, live app remains.
- No double-destroy or new leak is apparent.
- Commit `50a4e54` touches no frozen files and introduces no relevant scope creep or security issue.

I have no Docker access and did not execute the suites; this verdict is based solely on static reading.
[exited with code 0]
