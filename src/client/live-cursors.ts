import type { CursorPosition } from "../domain/schemas";

const preferenceKey = "tabletop:live-cursors";
export function loadLiveCursors() {
  try {
    return localStorage.getItem(preferenceKey) !== "off";
  } catch {
    return true;
  }
}
export function saveLiveCursors(enabled: boolean) {
  try {
    localStorage.setItem(preferenceKey, enabled ? "on" : "off");
  } catch {
    // Cursor controls remain usable when storage is unavailable.
  }
}

export function createCursorPublisher(send: (position: CursorPosition | null) => void) {
  let pending: CursorPosition | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  let lastSent = -Infinity;
  const flush = () => {
    timer = undefined;
    lastSent = Date.now();
    visible = pending !== null;
    send(pending);
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
    if (visible) send(null);
    visible = false;
    lastSent = -Infinity;
  };
  return {
    update(position: CursorPosition | null) {
      if (!position) {
        clear();
        return;
      }
      pending = position;
      if (timer !== undefined) return;
      const remaining = 50 - (Date.now() - lastSent);
      if (remaining <= 0) flush();
      else timer = setTimeout(flush, remaining);
    },
    clear,
  };
}

export function cursorColor(memberId: string) {
  let hash = 0;
  for (const character of memberId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 75% 45%)`;
}
