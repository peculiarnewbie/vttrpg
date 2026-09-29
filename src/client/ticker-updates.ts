import type { Character, TickerDefinition } from "../domain/schemas";

// Keep later clicks visible while earlier absolute targets are acknowledged.
export function createTickerUpdates() {
  const pending = new Map<string, Map<string, { value: number; requestId: string }>>();
  const confirmed = new Map<string, Character>();
  const apply = (character: Character): Character => {
    const tickers = { ...character.tickers };
    for (const [id, update] of pending.get(character.id) ?? []) tickers[id] = update.value;
    return { ...character, tickers };
  };
  return {
    stage(character: Character, definition: TickerDefinition, value: number, requestId: string) {
      if (!confirmed.has(character.id)) confirmed.set(character.id, character);
      const updates = pending.get(character.id) ?? new Map();
      updates.set(definition.id, {
        value: Math.max(
          definition.min,
          Math.min(character.tickerMax?.[definition.id] ?? definition.max, value),
        ),
        requestId,
      });
      pending.set(character.id, updates);
      return apply(character);
    },
    reconcile(character: Character, requestId?: string) {
      const updates = pending.get(character.id);
      for (const [id, update] of updates ?? []) {
        if (update.requestId === requestId) updates?.delete(id);
      }
      if (updates?.size) confirmed.set(character.id, character);
      else {
        pending.delete(character.id);
        confirmed.delete(character.id);
      }
      return apply(character);
    },
    reset() {
      const characters = [...confirmed.values()];
      pending.clear();
      confirmed.clear();
      return characters;
    },
  };
}
