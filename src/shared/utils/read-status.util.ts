/**
 * Derive a story's read status from its progress percentage and an optional
 * explicit completion flag.
 *
 * Single source of truth shared by the guest controller and story service so
 * the rule can't silently diverge between call sites.
 *
 * - `done`    – explicitly completed, or progress has reached 100%
 * - `reading` – some progress (> 0) but not finished
 * - `null`    – no meaningful progress yet
 */
export const deriveReadStatus = (
  progress: number | null | undefined,
  completed?: boolean,
): 'done' | 'reading' | null => {
  if (completed === true || (progress != null && progress >= 100)) {
    return 'done';
  }
  if (progress == null || progress <= 0) {
    return null;
  }
  return 'reading';
};
