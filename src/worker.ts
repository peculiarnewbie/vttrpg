import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { getMembership, getSessionUser, getWorld, toAuthUser, toWorldMember } from "./server/db";
import { Api, SESSION_COOKIE_NAME } from "./server/http";
import {
  Bucket,
  CurrentUser,
  D1,
  WorldNamespace,
  CorpusBinding,
  Features,
  Forbidden,
  NotFound,
  Unauthorized,
  Unavailable,
} from "./server/services";
import { fromReply } from "./server/reply";
import {
  CorpusClient,
  corpusClient,
  corpusAdminEnabled,
  corpusEnabled,
  type CorpusBindings,
} from "./server/corpus-env";
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
const workerIO = <A>(action: () => Promise<A>) =>
  Effect.tryPromise({ try: action, catch: (cause) => cause }).pipe(
    Effect.catch((cause) =>
      Effect.logError(cause).pipe(
        Effect.andThen(Effect.fail(new Unavailable({ message: "World service unavailable" }))),
      ),
    ),
  );
const resolveUser = (request: Request, env: Env) =>
  Effect.gen(function* () {
    const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
    if (!token) return null;
    const row = yield* getSessionUser(env.DB, token);
    return row ? toAuthUser(row) : null;
  });
const handleWebSocket = (request: Request, env: Env, worldId: string) =>
  Effect.gen(function* () {
    const user = yield* resolveUser(request, env);
    if (!user) return yield* new Unauthorized({ message: "Sign in required" });
    const world = yield* getWorld(env.DB, worldId);
    if (!world) return yield* new NotFound({ message: "World not found" });
    const membershipRow = yield* getMembership(env.DB, worldId, user.id);
    if (!membershipRow) return yield* new Forbidden({ message: "Forbidden" });
    const member = toWorldMember(membershipRow);
    const stub = (env.WORLDS as DurableObjectNamespace<WorldDO>).getByName(world.do_name);
    yield* fromReply(() =>
      stub.setCorpusAccount(
        { memberId: member.id, role: member.role, displayName: member.displayName },
        world.owner_user_id,
      ),
    );
    const headers = new Headers(request.headers);
    headers.set("x-ttrpg-member-id", member.id);
    headers.set("x-ttrpg-member-name", member.displayName);
    headers.set("x-ttrpg-role", member.role);
    headers.delete("Cookie");
    return yield* workerIO(() => stub.fetch(new Request(request.url, { method: "GET", headers })));
  });

export default {
  fetch(request: Request, env: Env & CorpusBindings): Promise<Response> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/")) {
          const wsMatch = /^\/api\/worlds\/([^/]+)\/ws$/.exec(url.pathname);
          if (wsMatch && request.headers.get("Upgrade")?.toLowerCase() === "websocket")
            return yield* handleWebSocket(request, env, wsMatch[1]);
          const user = yield* resolveUser(request, env);
          const context = Context.empty().pipe(
            Context.add(D1, env.DB),
            Context.add(Bucket, env.BUCKET),
            Context.add(WorldNamespace, env.WORLDS),
            Context.add(CurrentUser, user),
            Context.add(CorpusBinding, corpusAdminEnabled(env) ? (env.CORPUS ?? null) : null),
            Context.add(
              CorpusClient,
              corpusClient(corpusAdminEnabled(env) ? env.CORPUS : undefined),
            ),
            Context.add(Features, { corpus: corpusEnabled(env) }),
          );
          return yield* workerIO(() => handler(request, context));
        }
        const response = yield* workerIO(() => env.ASSETS.fetch(request));
        return response.status === 404
          ? yield* workerIO(() => env.ASSETS.fetch(new Request(new URL("/index.html", url.origin))))
          : response;
      }).pipe(
        Effect.catchTag("Unauthorized", (error) =>
          Effect.succeed(new Response(error.message, { status: 401 })),
        ),
        Effect.catchTag("NotFound", (error) =>
          Effect.succeed(new Response(error.message, { status: 404 })),
        ),
        Effect.catchTag("Forbidden", (error) =>
          Effect.succeed(new Response(error.message, { status: 403 })),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(cause).pipe(
            Effect.as(new Response("World service unavailable", { status: 503 })),
          ),
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env & CorpusBindings>;
