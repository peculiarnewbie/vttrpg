import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

/*
 * A DM downloads a world as one file and starts a new world from it
 * (docs/world-export.md). The copy's characters are the DM's until the DM
 * hands them to a member with Played by.
 */

// A 1×1 PNG, so the restored picture really renders.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a backup becomes a new world, and the DM hands its characters back out", async ({
  table,
}) => {
  const { api } = table.dm;
  const templates = (await (await api.get(`/api/worlds/${table.worldId}/templates`)).json()) as {
    id: string;
  }[];
  const wren = await table.saveCharacter({
    name: "Wren",
    templateId: templates[0]!.id,
    memberId: table.player.memberId,
    values: {},
  });
  const avatar = await api.post(`/api/worlds/${table.worldId}/characters/${wren.id}/avatar`, {
    headers: { "content-type": "image/png" },
    data: png,
  });
  expect(avatar.ok(), await avatar.text()).toBe(true);
  const note = await api.put(`/api/worlds/${table.worldId}/notes/lore`, {
    data: { title: "Old roads", content: "The north road floods in spring.", visibility: "dm" },
  });
  expect(note.ok(), await note.text()).toBe(true);

  // Download from settings → Backup.
  const { page } = table.dm;
  await page.goto(`/worlds/${table.worldId}/settings?section=backup`);
  await expect(page.getByRole("checkbox", { name: "Include chat" })).toBeChecked();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.ttrpg\.zip$/);
  const file = await download.path();

  // Restore it as a new world from the worlds page.
  await page.goto("/dashboard");
  await page
    .locator("label", { hasText: "New world from backup" })
    .locator("input")
    .setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/zip",
      buffer: await readFile(file),
    });
  await expect(page).not.toHaveURL(new RegExp(`/worlds/${table.worldId}`));
  await page.waitForURL(/\/worlds\/[^/]+$/);
  const copyId = new URL(page.url()).pathname.split("/").pop()!;
  expect(copyId).not.toBe(table.worldId);
  await expect(page.getByText(/Connecting…|Reconnecting…/)).toHaveCount(0);

  const copy = (await (await api.get(`/api/worlds/${copyId}/notes`)).json()) as {
    title: string;
  }[];
  expect(copy.map((item) => item.title)).toEqual(["Old roads"]);

  // A player joins the copy; the DM hands Wren to them.
  const joined = await api.post(`/api/worlds/${copyId}/members`, {
    data: {
      displayName: "Robin",
      role: "player",
      kind: "password",
      username: `robin${Date.now()}`,
      password: "correct horse battery",
    },
  });
  expect(joined.ok(), await joined.text()).toBe(true);
  const robin = (await joined.json()) as { id: string };
  await page.reload();
  await page.getByRole("tab", { name: "Characters" }).click();
  const tools = page.locator("#world-tools");
  // The only character opens straight to its sheet.
  await expect(tools.getByRole("heading", { name: "Wren" })).toBeVisible();
  await expect(tools.getByText("(was Pat Player)")).toBeVisible();
  await expect(tools.locator("img[src*='/avatar']")).toHaveJSProperty("naturalWidth", 1);
  const playedBy = tools.getByRole("combobox", { name: "Played by" });
  await playedBy.selectOption({ label: "Robin" });
  await expect(tools.getByText("(was Pat Player)")).toHaveCount(0);
  await expect
    .poll(async () => {
      const response = await api.get(`/api/worlds/${copyId}/characters`);
      const [character] = (await response.json()) as {
        memberId: string;
        formerPlayer?: string;
      }[];
      return character && { memberId: character.memberId, formerPlayer: character.formerPlayer };
    })
    .toEqual({ memberId: robin.id, formerPlayer: undefined });
});
