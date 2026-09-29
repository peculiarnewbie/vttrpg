import type { Character, CharacterValue } from "../domain/schemas";
import type { TrackerDefinitionLike } from "../domain/trackers-definitions";

type PendingUpdate =
  | { kind: "tracker"; key: string; value: number; requestId: string }
  | { kind: "value"; key: string; value: CharacterValue; requestId: string }
  | { kind: "pref"; key: string; value: string | null };

type Updates = {
  character: Character;
  pending: Map<string, PendingUpdate>;
  requests: Map<string, number>;
  lastAcknowledged: number;
};

// Keep later edits visible while earlier absolute targets are acknowledged.
export function createCharacterUpdates() {
  const characters = new Map<string, Updates>();
  let sequence = 0;
  const apply = (character: Character, updates: Updates): Character => {
    let tickers = { ...character.tickers };
    let values = { ...character.values };
    let layoutPrefs: Record<string, string> | undefined = character.layoutPrefs;
    for (const update of updates.pending.values()) {
      switch (update.kind) {
        case "tracker":
          tickers = { ...tickers, [update.key]: update.value };
          break;
        case "value":
          values = { ...values, [update.key]: update.value };
          break;
        case "pref":
          layoutPrefs = { ...layoutPrefs, [update.key]: update.value ?? "" };
          if (update.value === null) delete layoutPrefs[update.key];
          break;
      }
    }
    return { ...character, tickers, values, layoutPrefs };
  };
  const stage = (character: Character, update: PendingUpdate): Character => {
    const updates = characters.get(character.id) ?? {
      character,
      pending: new Map<string, PendingUpdate>(),
      requests: new Map<string, number>(),
      lastAcknowledged: 0,
    };
    updates.pending.set(`${update.kind}:${update.key}`, update);
    if (update.kind !== "pref") updates.requests.set(update.requestId, ++sequence);
    characters.set(character.id, updates);
    return apply(character, updates);
  };
  return {
    stageTracker(
      character: Character,
      definition: TrackerDefinitionLike,
      value: number,
      requestId: string,
    ) {
      return stage(character, {
        kind: "tracker",
        key: definition.id,
        value: Math.max(
          definition.min,
          Math.min(character.tickerMax?.[definition.id] ?? definition.max, value),
        ),
        requestId,
      });
    },
    stageValue(character: Character, key: string, value: CharacterValue, requestId: string) {
      return stage(character, { kind: "value", key, value, requestId });
    },
    stagePref(character: Character, blockId: string, variant: string | null) {
      return stage(character, { kind: "pref", key: blockId, value: variant });
    },
    reconcile(character: Character, requestId?: string) {
      const updates = characters.get(character.id);
      if (!updates) return character;
      const acknowledged = requestId === undefined ? undefined : updates.requests.get(requestId);
      const stale = acknowledged !== undefined && acknowledged < updates.lastAcknowledged;
      if (!stale) updates.character = character;
      if (acknowledged !== undefined && requestId !== undefined) {
        updates.lastAcknowledged = Math.max(updates.lastAcknowledged, acknowledged);
        updates.requests.delete(requestId);
      }
      for (const [key, update] of updates.pending) {
        if (update.kind === "pref") {
          // Pref frames have no request id; the server echoes the chosen variant.
          if (!stale && (character.layoutPrefs?.[update.key] ?? null) === update.value)
            updates.pending.delete(key);
        } else if (update.requestId === requestId) updates.pending.delete(key);
      }
      const result = apply(updates.character, updates);
      if (!updates.pending.size && !updates.requests.size) characters.delete(character.id);
      return result;
    },
    reset() {
      const confirmed = [...characters.values()].map((updates) => updates.character);
      characters.clear();
      return confirmed;
    },
  };
}
