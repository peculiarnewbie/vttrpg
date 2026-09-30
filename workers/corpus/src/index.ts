export { CorpusEntrypoint } from "./entrypoint";
export { SourceDO } from "./source-do";

/** Only the table's trusted service binding reaches corpus RPC methods. */
export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
