export type WorldPanels = { chat: boolean; tools: boolean };
const key = (worldId: string) => `tabletop:panels:${worldId}`;
export function loadWorldPanels(worldId: string): WorldPanels {
  const fallback = { chat: window.innerWidth > 700, tools: window.innerWidth > 1100 };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key(worldId)) ?? "null");
    if (
      saved &&
      typeof saved === "object" &&
      "chat" in saved &&
      "tools" in saved &&
      typeof saved.chat === "boolean" &&
      typeof saved.tools === "boolean"
    ) {
      return {
        chat: saved.chat,
        tools: window.innerWidth <= 700 && saved.chat ? false : saved.tools,
      };
    }
  } catch {
    /* Storage may be unavailable; keep the controls usable. */
  }
  return fallback;
}
export function saveWorldPanels(worldId: string, panels: WorldPanels) {
  try {
    localStorage.setItem(key(worldId), JSON.stringify(panels));
  } catch {
    /* Preferences are best effort. */
  }
}
