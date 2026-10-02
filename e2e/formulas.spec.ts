import type { SheetLayout } from "../src/domain/sheet-layout";
import { expect, test, type Table } from "./fixtures";

/*
 * Formulas: the editor suggests values by name, shows the value as you type
 * and names mistakes; the sheet shows where a computed number comes from, and
 * a formula that can't compute shows "?" instead of a quiet 0.
 */

const layout: SheetLayout = {
  system: "Test",
  name: "Formulas",
  derived: [
    { key: "str_mod", label: "STR mod", expr: "floor((@str - 10) / 2)" },
    { key: "loop_a", label: "Loop A", expr: "@loop_b + 1" },
    { key: "loop_b", label: "Loop B", expr: "@loop_a + 1" },
  ],
  pages: [
    {
      id: "main",
      title: "Main",
      blocks: [
        {
          id: "stats",
          type: "stats",
          items: [
            { key: "str", label: "Strength" },
            { key: "str_mod", label: "Modifier" },
            { key: "loop_a", label: "Looped" },
          ],
        },
        { id: "mighty", type: "heading", text: "Mighty", when: { expr: "@str >= 13" } },
        { id: "feeble", type: "heading", text: "Feeble", when: { expr: "@str < 8" } },
      ],
    },
  ],
};

const setUp = (table: Table) =>
  table.saveTemplate({ name: "Formulas", fields: [], stats: [], tickers: [], rolls: [], layout });

test("the formula editor suggests values, shows the result and names mistakes", async ({
  table,
}) => {
  await setUp(table);
  const page = table.dm.page;
  await page.goto(`/worlds/${table.worldId}/settings?section=templates`);
  await page.getByRole("combobox", { name: "Template" }).selectOption({ label: "Formulas" });
  const formula = page.getByRole("combobox", { name: "Derived values 1 Formula" });
  await expect(formula).toHaveValue("floor((@str - 10) / 2)");
  await formula.fill("");
  await formula.pressSequentially("max(@stre");
  const options = page.getByRole("listbox", { name: "Values to use" });
  await expect(options.getByRole("option").first()).toContainText("Strength");
  await formula.press("Enter");
  await expect(formula).toHaveValue("max(@str");
  await formula.pressSequentially(", 3)");
  // The preview sheet has no Strength yet, so the larger value is 3.
  await expect(page.getByRole("status").filter({ hasText: "= 3" })).toBeVisible();

  await formula.fill("2d6 + @str");
  await expect(formula).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Formulas can't roll dice" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Formula functions" }).first().click();
  await expect(page.getByRole("table", { name: "Formula functions" })).toContainText("step");

  // A block's "only show when" can be a formula, checked against the preview sheet.
  await page.locator(`[data-row="mighty"]`).click();
  const condition = page.getByRole("combobox", { name: "Only show when formula" });
  await expect(condition).toHaveValue("@str >= 13");
  await expect(page.getByRole("status").filter({ hasText: "doesn't apply" })).toBeVisible();
  await condition.fill("@str >= 13 and");
  await expect(condition).toHaveAttribute("aria-invalid", "true");
});

test("a computed value shows where it comes from, and a broken one shows why", async ({
  table,
}) => {
  const template = await setUp(table);
  await table.saveCharacter({
    name: "Brute",
    templateId: template.id,
    memberId: table.player.memberId,
    values: { str: 15 },
  });
  const page = table.player.page;
  await table.open(table.player);
  const sheet = page.locator("#world-tools");
  await expect(sheet.getByRole("heading", { name: "Brute" })).toBeVisible();
  await expect(sheet.getByText("Mighty", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Feeble", { exact: true })).toHaveCount(0);

  await sheet.getByRole("button", { name: "2", exact: true }).click();
  const note = sheet.getByRole("note");
  await expect(note).toContainText("floor((@str - 10) / 2)");
  await expect(note).toContainText("Strength");
  await expect(note).toContainText("15");

  const broken = sheet.getByRole("button", { name: "Formula problem: Refers to itself" });
  await expect(broken).toHaveText("?");
  await broken.click();
  await expect(sheet.getByRole("note")).toContainText("Refers to itself");
});
