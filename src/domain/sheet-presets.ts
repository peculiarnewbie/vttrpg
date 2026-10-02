import type { SheetLayout } from "./sheet-layout";
import { gameSystems } from "./systems";

/*
 * Premade layouts, built only from generic blocks: every layout of every
 * system the app ships (see systems/). A system can ship several arrangements
 * of the same values (Classic, Compact…); they double as the proof that the
 * block set is expressive enough (see /lab/systems).
 */

export { bastionlandClassic, bastionlandCompact } from "./systems/bastionland-sheet";
export { bladesInTheDark } from "./systems/blades-sheet";
export { mothership } from "./systems/mothership-sheet";

export const presets: SheetLayout[] = gameSystems.flatMap((item) => [
  ...(item.system.layouts ?? []),
]);
