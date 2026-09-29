import { layoutTrackers } from "./sheet-layout";
import type { SheetTemplate } from "./schemas";

/** What the server and client need to clamp and initialise a tracker value. */
export type TrackerDefinitionLike = {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
};

/**
 * Tracker definitions for a template: legacy `tickers` plus every tracker item in
 * its layout (layout wins on a shared key). Values live in `Character.tickers`
 * either way, so `ticker.set`, per-character maxima, and optimistic updates work
 * the same for both.
 */
export const trackerDefinitions = (
  template: Pick<SheetTemplate, "tickers" | "layout"> | undefined,
): TrackerDefinitionLike[] => {
  if (!template) return [];
  const byId = new Map<string, TrackerDefinitionLike>();
  for (const ticker of template.tickers)
    byId.set(ticker.id, {
      id: ticker.id,
      label: ticker.label,
      min: ticker.min,
      max: ticker.max,
      defaultValue: ticker.defaultValue,
    });
  if (template.layout)
    for (const item of layoutTrackers(template.layout))
      byId.set(item.key, {
        id: item.key,
        label: item.label,
        min: item.min,
        max: item.max,
        defaultValue: Math.max(item.min, Math.min(item.max, item.start ?? item.max)),
      });
  return [...byId.values()];
};
