import type { TickerDefinition } from "./schemas";

export function trackerDisplay(def: Pick<TickerDefinition, "display" | "min" | "max">) {
  if (def.display && def.display !== "auto") return def.display;
  return def.max - def.min <= 12 ? "pips" : "bar";
}

export const trackerPips = (min: number, max: number) =>
  Array.from({ length: Math.max(0, max - min) }, (_, index) => min + index + 1);

export const trackerPipValue = (point: number, current: number) =>
  point === current ? point - 1 : point;
