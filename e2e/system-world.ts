import { gameSystemNamed } from "../src/domain/systems/index";
import { expect, type Table } from "./fixtures";

/*
 * A world with a shipped system's sheets and entry types as world copies, and
 * not its library — so a builder spec writes its own made-up entries and sees
 * only those, whether or not the library is published in local dev state.
 * Setting a system up through the UI is covered by systems.spec.ts.
 */
export const setUpSystemSheets = async (table: Table, systemName: string) => {
  const { system } = gameSystemNamed(systemName)!;
  // A type can refer to types put after it; retry until every type is in.
  let pending = [...system.entryTypes];
  while (pending.length) {
    const failed: typeof pending = [];
    for (const type of pending) {
      const response = await table.dm.api.put(
        `/api/worlds/${table.worldId}/compendium/types/${type.id}`,
        { data: type },
      );
      if (!response.ok()) failed.push(type);
    }
    expect(
      failed.length,
      `entry types not accepted: ${failed.map((type) => type.id)}`,
    ).toBeLessThan(pending.length);
    pending = failed;
  }
  const templates: { id: string; name: string }[] = [];
  for (const layout of system.layouts ?? []) {
    const name = `${system.name} — ${layout.name}`;
    const { id } = await table.saveTemplate({
      name,
      fields: [],
      stats: [],
      tickers: [],
      rolls: [],
      layout,
    });
    templates.push({ id, name });
  }
  return templates;
};
