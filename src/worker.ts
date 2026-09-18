import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { getMembership, getSessionUser, getWorld, toAuthUser, toWorldMember } from "./server/db";
import { Api, SESSION_COOKIE_NAME } from "./server/http";
import { Bucket, CurrentUser, D1, WorldNamespace } from "./server/services";
import { WorldDO } from "./server/world-do";

export { WorldDO };

const appLayer = Layer.merge(HttpRouter.layer, Api);
const { handler } = HttpRouter.toWebHandler(appLayer);

const readCookie = (header: string | null, name: string) => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};

const resolveUser = async (request: Request, env: Env) => {
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;
  const row = await Effect.runPromise(getSessionUser(env.DB, token));
  return row ? toAuthUser(row) : null;
};

const handleWebSocket = async (request: Request, env: Env, worldId: string) => {
  const user = await resolveUser(request, env);
  if (!user) return new Response("Sign in required", { status: 401 });
  const world = await Effect.runPromise(getWorld(env.DB, worldId));
  if (!world) return new Response("World not found", { status: 404 });
  const membershipRow = await Effect.runPromise(getMembership(env.DB, worldId, user.id));
  if (!membershipRow) return new Response("Forbidden", { status: 403 });
  const member = toWorldMember(membershipRow);

  const headers = new Headers(request.headers);
  headers.set("x-ttrpg-member-id", member.id);
  headers.set("x-ttrpg-member-name", member.displayName);
  headers.set("x-ttrpg-role", member.role);
  headers.delete("Cookie");

  const stub = env.WORLDS.getByName(world.do_name);
  return stub.fetch(new Request(request.url, { method: "GET", headers }));
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const wsMatch = /^\/api\/worlds\/([^/]+)\/ws$/.exec(url.pathname);
      if (wsMatch && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        return handleWebSocket(request, env, wsMatch[1]);
      }

      const user = await resolveUser(request, env);
      const context = Context.empty().pipe(
        Context.add(D1, env.DB),
        Context.add(Bucket, env.BUCKET),
        Context.add(WorldNamespace, env.WORLDS),
        Context.add(CurrentUser, user),
      );
      return handler(request, context);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
    }
    return assetResponse;
  },
} satisfies ExportedHandler<Env>;
