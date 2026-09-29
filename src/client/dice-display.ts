import { createSignal } from "solid-js";

const preferenceKey = "ttrpg:dice-display";

export function loadDiceTotals() {
  try {
    return localStorage.getItem(preferenceKey) !== "hide-total";
  } catch {
    return true;
  }
}

const [showDiceTotals, updateDiceTotals] = createSignal(loadDiceTotals());
export { showDiceTotals };

export function setShowDiceTotals(show: boolean) {
  updateDiceTotals(show);
  try {
    localStorage.setItem(preferenceKey, show ? "show-total" : "hide-total");
  } catch {
    // The preference still works for this session when storage is unavailable.
  }
}
