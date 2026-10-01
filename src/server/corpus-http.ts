import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  CORPUS_API_VERSION,
  SystemInput,
  SourceInput,
  SaveEntriesCall,
  DeleteEntriesCall,
  type CorpusApi,
  type CorpusCall,
} from "../domain/corpus-rpc";
import { CorpusBinding, CurrentUser } from "./services";

const EntriesInput = Schema.Struct({ entries: SaveEntriesCall.fields.entries });
const DeleteInput = Schema.Struct({ ids: DeleteEntriesCall.fields.ids });
type Action = (
  corpus: CorpusApi,
  context: CorpusCall,
  body: unknown,
  sourceId: string,
) => Promise<unknown>;

/** Management for local dev and tests only (`corpus-admin`); the corpus has no public HTTP route. */
const corpusRoute = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  action: Action,
  schema?: Schema.ConstraintDecoder<unknown>,
) =>
  HttpRouter.route(
    method,
    `/api/corpus${path}`,
    Effect.gen(function* () {
      const corpus = yield* CorpusBinding;
      if (!corpus) return HttpServerResponse.jsonUnsafe({ error: "Not found" }, { status: 404 });
      const user = yield* CurrentUser;
      if (!user)
        return HttpServerResponse.jsonUnsafe({ error: "Sign in required" }, { status: 401 });
      const params = yield* HttpRouter.params;
      let body: unknown;
      if (schema) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const text = yield* request.text;
        if (new TextEncoder().encode(text).byteLength > 4 * 1024 * 1024)
          return HttpServerResponse.jsonUnsafe(
            { error: "Request must be at most 4 MB" },
            { status: 413 },
          );
        try {
          body = Schema.decodeUnknownSync(schema)(JSON.parse(text));
        } catch {
          return HttpServerResponse.jsonUnsafe({ error: "Invalid corpus data" }, { status: 400 });
        }
      }
      const context: CorpusCall = { apiVersion: CORPUS_API_VERSION, accountId: user.id };
      const result = yield* Effect.tryPromise({
        try: () => action(corpus, context, body, params.sourceId ?? ""),
        catch: (error) => (error instanceof Error ? error.message : "Corpus request failed"),
      }).pipe(
        Effect.match({
          onSuccess: (value) => HttpServerResponse.jsonUnsafe(value ?? null),
          onFailure: (message) =>
            HttpServerResponse.jsonUnsafe({ error: message }, { status: 400 }),
        }),
      );
      return result;
    }),
  );

export const CorpusRoutes = [
  corpusRoute("GET", "/systems", (corpus, call) => corpus.listSystems(call)),
  corpusRoute(
    "PUT",
    "/systems",
    (corpus, call, body) => corpus.saveSystem({ ...call, system: body as typeof SystemInput.Type }),
    SystemInput,
  ),
  corpusRoute("GET", "/sources", (corpus, call) => corpus.listSources(call)),
  corpusRoute(
    "POST",
    "/sources",
    (corpus, call, body) =>
      corpus.createSource({ ...call, source: body as typeof SourceInput.Type }),
    SourceInput,
  ),
  corpusRoute(
    "POST",
    "/sources/:sourceId/entries",
    (corpus, call, body, sourceId) =>
      corpus.saveEntries({ ...call, sourceId, ...(body as typeof EntriesInput.Type) }),
    EntriesInput,
  ),
  corpusRoute(
    "DELETE",
    "/sources/:sourceId/entries",
    (corpus, call, body, sourceId) =>
      corpus.deleteEntries({ ...call, sourceId, ...(body as typeof DeleteInput.Type) }),
    DeleteInput,
  ),
  corpusRoute("POST", "/sources/:sourceId/publish", (corpus, call, _body, sourceId) =>
    corpus.publish({ ...call, sourceId }),
  ),
];
