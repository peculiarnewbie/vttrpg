import type { CorpusEntrypoint } from "../../workers/corpus/src/entrypoint";
import { featureFlags } from "../domain/flags";

/** Optional until the independently deployed corpus is bound to the table. */
export type CorpusBindings = {
  CORPUS?: Service<CorpusEntrypoint>;
  CORPUS_BUCKET?: R2Bucket;
  FLAGS?: string;
};

export const corpusEnabled = (env: CorpusBindings): boolean =>
  featureFlags(env.FLAGS).corpus && !!env.CORPUS && !!env.CORPUS_BUCKET;
