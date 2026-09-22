/**
 * Shipped level JSON, loaded through model/validate (S0 contract 5: nothing
 * reaches physics unvalidated).
 */

import type { LevelDef } from '../model/level';
import { validateLevelDef } from '../model/validate';
import originalCourseJson from '../../levels/original-course.json';

export function loadOriginalCourse(): LevelDef {
  const r = validateLevelDef(originalCourseJson);
  if (!r.ok) throw new Error(`levels/original-course.json failed validation: ${r.error.message}`);
  return r.value;
}
