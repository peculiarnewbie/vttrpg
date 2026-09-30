import type { APIResponse } from "@playwright/test";
import type { CompendiumEntry, IndexDelta, EntryBodies } from "../src/domain/compendium";
import { expect, test, type Table } from "./fixtures";

const read = async <T>(response: APIResponse): Promise<T> => {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
};

/** Invented fixture content only; the library is published through the table's trusted RPC. */
const library = async (table: Table) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const sourceId = `e2e-${stamp}`;
  const name = `Test library ${stamp}`;
  await read(
    await table.dm.api.put("/api/corpus/systems", {
      data: {
        id: `system-${stamp}`,
        name: "Test system",
        entryTypes: [
          {
            id: "corpus-item",
            name: "Library item",
            fields: [{ key: "damage", label: "Damage", kind: "dice" }],
          },
        ],
      },
    }),
  );
  await read(
    await table.dm.api.post("/api/corpus/sources", {
      data: {
        id: sourceId,
        systemId: `system-${stamp}`,
        name,
        visibility: "public",
        licence: {
          id: "cc-by-sa-4.0",
          name: "CC BY-SA 4.0",
          attribution: "Original test text by the Tabletop contributors",
          shareAlike: true,
        },
      },
    }),
  );
  const entries = await read<CompendiumEntry[]>(
    await table.dm.api.post(`/api/corpus/sources/${sourceId}/entries`, {
      data: {
        entries: [
          {
            typeId: "corpus-item",
            name: "Lantern Pike",
            tags: ["gear"],
            body: "A lantern hangs from this invented pike.",
            fields: { damage: "d6" },
            visibility: "public",
          },
          {
            typeId: "corpus-item",
            name: "Hidden Almanac",
            tags: [],
            body: "Private invented notes.",
            fields: { damage: "d4" },
            visibility: "dm",
          },
        ],
      },
    }),
  );
  await read(await table.dm.api.post(`/api/corpus/sources/${sourceId}/publish`));
  const item = entries[0];
  return {
    sourceId,
    name,
    item,
    hidden: entries[1],
    update: async () => {
      await read(
        await table.dm.api.post(`/api/corpus/sources/${sourceId}/entries`, {
          data: {
            entries: [
              {
                id: item.id,
                typeId: item.typeId,
                name: item.name,
                tags: item.tags,
                body: "The new version of the invented pike.",
                fields: { damage: "d8" },
                visibility: "public",
              },
            ],
          },
        }),
      );
      await read(await table.dm.api.post(`/api/corpus/sources/${sourceId}/publish`));
    },
  };
};

test("libraries enable as pinned versions and show an explicit update summary", async ({
  table,
}) => {
  const source = await library(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=libraries`);
  await expect(page.getByRole("tab", { name: "Libraries" })).toBeVisible();
  const card = page.getByRole("region", { name: source.name, exact: true });
  await card.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(card.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(card.getByRole("checkbox", { name: "Follow latest" })).not.toBeChecked();
  const index = await read<IndexDelta>(
    await table.player.api.get(`/api/worlds/${table.worldId}/compendium/index`),
  );
  expect(index.upserts.some((row) => row.id === source.item.id)).toBe(true);
  expect(JSON.stringify(index)).not.toContain(source.hidden.id);
  await source.update();
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(card.getByText("Update available · version 2")).toBeVisible();
  await expect(card.getByText("0 added · 1 changed · 0 removed")).toBeVisible();
  const bodies = () =>
    table.player.api.post(`/api/worlds/${table.worldId}/compendium/bodies`, {
      data: { ids: [source.item.id] },
    });
  expect((await read<EntryBodies>(await bodies())).entries[0].sourceVersion).toBe(1);
  await card.getByRole("button", { name: "Apply update" }).click();
  await expect(card.getByText("Version 2", { exact: true })).toBeVisible();
  const entry = (await read<EntryBodies>(await bodies())).entries[0];
  expect(entry.fields.damage).toBe("d8");
  expect(entry.licence?.shareAlike).toBe(true);
});

test("table overrides survive followed updates and blocked entries can be restored", async ({
  table,
}) => {
  const source = await library(table);
  await read(
    await table.dm.api.put(`/api/worlds/${table.worldId}/libraries/${source.sourceId}`, {
      data: {},
    }),
  );
  const page = table.dm.page;
  await table.open(table.dm);
  await page.getByRole("tab", { name: "Compendium" }).click();
  const tools = page.locator("#world-tools");
  await tools.getByRole("listitem").filter({ hasText: "Lantern Pike" }).click();
  await tools.getByRole("button", { name: "Table override", exact: true }).click();
  const editor = tools.getByRole("group", { name: "Table override Library item" });
  await editor.getByLabel("Name", { exact: true }).fill("Table Pike");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tools.getByRole("heading", { name: "Table Pike", exact: true })).toBeVisible();
  await expect(tools.getByText(/CC BY-SA 4.0/)).toBeVisible();
  await source.update();
  await page.goto(`/worlds/${table.worldId}/settings?section=libraries`);
  const card = page.getByRole("region", { name: source.name, exact: true });
  await card.getByRole("checkbox", { name: "Follow latest" }).check();
  await expect(card.getByText("Version 2", { exact: true })).toBeVisible();
  const bodies = await read<EntryBodies>(
    await table.player.api.post(`/api/worlds/${table.worldId}/compendium/bodies`, {
      data: { ids: [source.item.id] },
    }),
  );
  expect(bodies.entries[0].name).toBe("Table Pike");
  expect(bodies.entries[0].fields.damage).toBe("d8");
  await table.open(table.dm);
  await page.getByRole("tab", { name: "Compendium" }).click();
  await tools.getByRole("listitem").filter({ hasText: "Table Pike" }).click();
  await tools.getByRole("button", { name: "Block in this world" }).click();
  await expect(tools.getByRole("listitem").filter({ hasText: "Table Pike" })).toHaveCount(0);
  const index = await read<IndexDelta>(
    await table.player.api.get(`/api/worlds/${table.worldId}/compendium/index`),
  );
  expect(index.upserts.some((row) => row.id === source.item.id)).toBe(false);
  await page.goto(`/worlds/${table.worldId}/settings?section=libraries`);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Blocked entries" })).toHaveCount(0);
  const restored = await read<EntryBodies>(
    await table.player.api.post(`/api/worlds/${table.worldId}/compendium/bodies`, {
      data: { ids: [source.item.id] },
    }),
  );
  expect(restored.entries[0].name).toBe("Table Pike");
});
