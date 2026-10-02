import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * The options part: pick from DM-written choices into a field, a text block
 * or a checks block. Picks are hints shown beside the buttons and never block
 * anything; grants are one explicit "Tick given" button, never automatic.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Origins",
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "identity",
          type: "fields",
          columns: 1,
          items: [{ key: "background", label: "Background" }],
        },
        { id: "looks", type: "text", key: "looks", label: "Looks" },
        {
          id: "skills",
          type: "checks",
          key: "skills",
          label: "Skills",
          options: ["Sneak", "Climb", "Swim"],
        },
        {
          id: "drives",
          type: "checks",
          key: "drives",
          label: "Drives",
          options: ["Gold", "Glory"],
        },
      ],
    },
  ],
  builder: {
    steps: [
      {
        id: "background",
        title: "Background",
        parts: [
          {
            type: "options",
            key: "background",
            options: [{ label: "Urchin", note: "Street kid" }, { label: "Acolyte" }],
          },
        ],
      },
      {
        id: "skills",
        title: "Skills",
        parts: [
          {
            type: "options",
            key: "skills",
            options: [{ label: "Sneak" }, { label: "Climb" }, { label: "Swim" }],
            pick: 2,
            grants: ["Sneak"],
          },
        ],
      },
      {
        id: "drives",
        title: "Drives",
        // No options of its own: a checks target falls back to the block's.
        parts: [{ type: "options", key: "drives" }],
      },
      {
        id: "looks",
        title: "Looks",
        // A text target with no options offers nothing — and writes nothing.
        parts: [{ type: "options", key: "looks" }],
      },
    ],
  },
};

const valuesOf = async (table: Table, name: string) => {
  const response = await table.dm.api.get(`/api/worlds/${table.worldId}/characters`);
  const characters = (await response.json()) as {
    name: string;
    values: Record<string, unknown>;
  }[];
  return characters.find((character) => character.name === name)?.values;
};

test("a player picks options into a field and checks blocks; rendering alone writes nothing", async ({
  table,
}) => {
  const template = await table.saveTemplate({
    name: "Origins",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout,
  });
  await table.saveCharacter({
    name: "Nova",
    templateId: template.id,
    memberId: table.player.memberId,
    values: {},
  });
  const before = await valuesOf(table, "Nova");

  const page = table.player.page;
  await table.open(table.player);
  const tools = page.locator("#world-tools");
  await expect(tools.getByRole("heading", { name: "Nova" })).toBeVisible();
  await tools.getByRole("button", { name: "Builder" }).click();
  const builder = tools.getByRole("region", { name: "Character builder" });
  const steps = builder.getByRole("navigation", { name: "Builder steps" });

  // Rendering the parts writes nothing.
  const background = builder.getByRole("group", { name: "Background" });
  await expect(background.getByRole("button", { name: "Urchin" })).toBeVisible();
  await expect(background.getByText("Street kid")).toBeVisible();
  expect(await valuesOf(table, "Nova")).toEqual(before);

  // One click sets the field to that label; the choice shows as chosen.
  await background.getByRole("button", { name: "Urchin" }).click();
  await expect(background.getByText("Chosen: Urchin")).toBeVisible();
  await expect(background.getByRole("button", { name: "Urchin" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => valuesOf(table, "Nova")).toEqual({ ...before, background: "Urchin" });
  await background.getByRole("button", { name: "Acolyte" }).click();
  await expect.poll(() => valuesOf(table, "Nova")).toEqual({ ...before, background: "Acolyte" });

  // Checks options toggle; the pick count is a hint, never a gate.
  await steps.getByRole("button", { name: /Skills/ }).click();
  const skills = builder.getByRole("group", { name: "Skills" });
  await expect(skills.getByText("Picked 0 of 2")).toBeVisible();
  await expect(skills.getByText("Given: Sneak")).toBeVisible();
  await skills.getByRole("button", { name: "Tick given" }).click();
  await expect(skills.getByText("Picked 1 of 2")).toBeVisible();
  await skills.getByRole("button", { name: "Climb" }).click();
  await skills.getByRole("button", { name: "Swim" }).click();
  await expect(skills.getByText("Picked 3 of 2")).toBeVisible();
  await skills.getByRole("button", { name: "Sneak" }).click();
  await expect
    .poll(() => valuesOf(table, "Nova"))
    .toEqual({ ...before, background: "Acolyte", skills: ["Climb", "Swim"] });

  // A checks part with no options falls back to the block's own options.
  await steps.getByRole("button", { name: /Drives/ }).click();
  const drives = builder.getByRole("group", { name: "Drives" });
  await drives.getByRole("button", { name: "Gold" }).click();
  await expect
    .poll(() => valuesOf(table, "Nova"))
    .toEqual({ ...before, background: "Acolyte", skills: ["Climb", "Swim"], drives: ["Gold"] });

  // A text target with no options offers nothing to click.
  await steps.getByRole("button", { name: /Looks/ }).click();
  const looks = builder.getByRole("group", { name: "Looks" });
  await expect(looks).toBeVisible();
  await expect(looks.getByRole("button")).toHaveCount(0);

  await tools.getByRole("button", { name: "Done" }).click();
  await expect(builder).toHaveCount(0);
  expect(await valuesOf(table, "Nova")).toEqual({
    ...before,
    background: "Acolyte",
    skills: ["Climb", "Swim"],
    drives: ["Gold"],
  });
});

test("a DM adds an options part in the layout editor", async ({ table }) => {
  const template = await table.saveTemplate({
    name: "Origins",
    fields: [],
    stats: [],
    tickers: [],
    rolls: [],
    layout: {
      system: "Test",
      name: "Origins",
      pages: [
        {
          id: "main",
          title: "Main",
          blocks: [
            {
              id: "skills",
              type: "checks",
              key: "skills",
              label: "Skills",
              options: ["Sneak", "Climb"],
            },
          ],
        },
      ],
    },
  });
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Origins" });
  const steps = page.getByRole("group", { name: "Character builder steps" });
  await steps.getByRole("button", { name: "+ Add a step" }).click();
  const step = steps.getByRole("group", { name: "Step 1" });
  await step.getByLabel("Title").fill("Skills");
  await step
    .getByRole("combobox", { name: "Add to Step 1" })
    .selectOption({ label: "Pick from options" });
  await step.getByLabel("Target").selectOption({ label: "Skills (skills)" });
  await step.getByRole("button", { name: "+ Add", exact: true }).click();
  await step.getByLabel("Step 1 part 1 options 1 Label").fill("Sneak");
  await step.getByLabel("Step 1 part 1 options 1 Note").fill("Quiet feet");
  await step.getByLabel("Given (checks only, comma separated)").fill("Sneak");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect
    .poll(async () => {
      const response = await table.dm.api.get(`/api/worlds/${table.worldId}/templates`);
      const templates = (await response.json()) as {
        id: string;
        layout?: SheetLayout;
      }[];
      return templates.find((item) => item.id === template.id)?.layout?.builder?.steps[0];
    })
    .toEqual({
      id: "step-1",
      title: "Skills",
      parts: [
        {
          type: "options",
          key: "skills",
          options: [{ label: "Sneak", note: "Quiet feet" }],
          grants: ["Sneak"],
        },
      ],
    });
});
