import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { SaveCharacterInput, SaveTemplateInput } from "../src/domain/schemas";

type Theme = "rulebook" | "zine" | "fantasy";

type Seat = { api: APIRequestContext; page: Page; memberId: string; errors: string[] };

/**
 * A fresh world with a DM and one player, each signed in with their own
 * browser context. Accounts go through the dev-only Google route and a
 * password member, like the app's own flows.
 */
export type Table = {
  worldId: string;
  dm: Seat;
  player: Seat;
  saveTemplate: (input: SaveTemplateInput) => Promise<{ id: string }>;
  saveCharacter: (input: SaveCharacterInput) => Promise<{ id: string }>;
  /** Opens the world as this seat and waits for the live connection. */
  open: (seat: Seat) => Promise<void>;
};

const ok = async <T>(response: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> => {
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as T;
};

export const test = base.extend<{ theme: Theme; table: Table }>({
  theme: ["rulebook", { option: true }],
  table: async ({ browser, playwright, baseURL, theme }, use) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const dmApi = await playwright.request.newContext({ baseURL });
    await ok(
      await dmApi.post("/api/auth/google", {
        data: { email: `dm-${stamp}@example.test`, displayName: "Dana DM" },
      }),
    );
    const world = await ok<{ id: string }>(
      await dmApi.post("/api/worlds", { data: { name: `E2E ${stamp}` } }),
    );
    const members = await ok<{ id: string; role: string }[]>(
      await dmApi.get(`/api/worlds/${world.id}/members`),
    );
    const dmMemberId = members.find((item) => item.role === "dm")!.id;
    const member = await ok<{ id: string }>(
      await dmApi.post(`/api/worlds/${world.id}/members`, {
        data: {
          displayName: "Pat Player",
          role: "player",
          kind: "password",
          username: `pat${stamp}`,
          password: "correct horse battery",
        },
      }),
    );
    const playerApi = await playwright.request.newContext({ baseURL });
    await ok(
      await playerApi.post("/api/auth/login", {
        data: { username: `pat${stamp}`, password: "correct horse battery" },
      }),
    );

    const seat = async (api: APIRequestContext, memberId: string): Promise<Seat> => {
      const context = await browser.newContext({ storageState: await api.storageState() });
      await context.addInitScript((name) => localStorage.setItem("ttrpg.theme", name), theme);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      return { api, page, memberId, errors };
    };
    const dm = await seat(dmApi, dmMemberId);
    const player = await seat(playerApi, member.id);

    await use({
      worldId: world.id,
      dm,
      player,
      saveTemplate: async (input) =>
        ok(await dmApi.post(`/api/worlds/${world.id}/templates`, { data: input })),
      saveCharacter: async (input) =>
        ok(await dmApi.post(`/api/worlds/${world.id}/characters`, { data: input })),
      open: async ({ page }) => {
        await page.goto(`/worlds/${world.id}`);
        await expect(page.getByPlaceholder(/Speak, describe/)).toBeVisible();
        await expect(page.getByText(/Connecting…|Reconnecting…/)).toHaveCount(0);
      },
    });

    expect(dm.errors, "DM page errors").toEqual([]);
    expect(player.errors, "player page errors").toEqual([]);
    await dm.page.context().close();
    await player.page.context().close();
    await dmApi.dispose();
    await playerApi.dispose();
  },
});

export { expect };
