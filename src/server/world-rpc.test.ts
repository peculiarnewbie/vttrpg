// @vitest-environment node
import { readFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTabletop, type Tabletop } from "../test/miniflare";

let tabletop: Tabletop;
beforeAll(async () => {
  tabletop = await startTabletop({
    plugins: [
      {
        name: "world-rpc-failures",
        setup(build) {
          build.onLoad({ filter: /\/world-do\.ts$/ }, async ({ path }) => {
            const source = await readFile(path, "utf8");
            return {
              loader: "ts",
              contents:
                'import { Conflict } from "./services";\n' +
                source.replace(
                  "return yield* world.state(caller);",
                  `if (caller.displayName === "Conflict") return yield* new Conflict({ message: "World revision changed" });
             if (caller.displayName === "Unavailable") return yield* new Unavailable({ message: "World storage unavailable" });
             return yield* world.state(caller);`,
                ),
            };
          });
        },
      },
    ],
  });
}, 30000);
afterAll(async () => {
  await tabletop?.dispose();
});

it.each([
  { name: "Conflict", status: 409, message: "World revision changed" },
  { name: "Unavailable", status: 503, message: "World storage unavailable" },
])("maps a DO $name reply to HTTP $status", async ({ name, status, message }) => {
  const cookie = await tabletop.signin(`${name.toLowerCase()}@example.test`, name);
  const created = await tabletop.call("/worlds", {
    method: "POST",
    cookie,
    body: { name: "RPC test" },
  });
  expect(created.status).toBe(201);
  const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
    await created.json(),
  );
  const response = await tabletop.call(`/worlds/${id}`, { cookie });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
});
