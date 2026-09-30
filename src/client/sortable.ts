/** Move one item to `to`, an index in the list as it is once the item is taken out. */
export const moveIndex = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
};

/**
 * Where a dragged item lands: the number of other items whose middle is above
 * the pointer. `spans` are the vertical extents of every item, the dragged one
 * included (it is skipped).
 */
export const dropIndex = (
  spans: readonly { top: number; bottom: number }[],
  from: number,
  y: number,
) => spans.filter((span, index) => index !== from && (span.top + span.bottom) / 2 < y).length;
