import { Context, Effect, Layer } from "effect";
import { bindingCall } from "./effects";

type BucketBinding = Pick<R2Bucket, "put">;

const makeBucket = (bucket: BucketBinding) => ({
  put: Effect.fn("SnapshotBucket.put")(function* (
    key: string,
    bytes: string | Uint8Array,
    contentType: string,
  ) {
    yield* bindingCall("Corpus snapshot storage unavailable", () =>
      bucket.put(key, bytes, { httpMetadata: { contentType } }),
    );
  }),
});

export class SnapshotBucket extends Context.Service<
  SnapshotBucket,
  ReturnType<typeof makeBucket>
>()("ttrpg/corpus/SnapshotBucket") {}

export const snapshotBucketLayer = (bucket: BucketBinding) =>
  Layer.succeed(SnapshotBucket, makeBucket(bucket));
