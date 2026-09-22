/**
 * S3 terrain public API.
 *
 *  chunks.ts        LevelDef spans -> fixed-width chunks (seam-free cuts), TerrainSource,
 *                   ChunkLifecycleListener (renderer mirror contract)
 *  streaming.ts     body-aware retention window as pure functions
 *  runtime.ts       TerrainStreamer: chunks -> physics chain bodies (+ listeners)
 *  generator.ts     seeded procedural generator: generateBlock / generateLevel /
 *                   ProceduralChunkSource (endless)
 *  originalCourse.ts  port of the recovered 2008 course
 *  prng.ts, noise.ts, slope.ts  building blocks
 */

export * from './chunks';
export * from './streaming';
export * from './runtime';
export * from './generator';
export * from './originalCourse';
export { normalizeSeed, type TerrainSeed } from './prng';
export { clampSlopes, maxSlopeViolation, type SlopeLimits } from './slope';
export { loadOriginalCourse } from './levels';
