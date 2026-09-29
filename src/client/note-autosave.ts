export type NoteSaveStatus = "saved" | "pending" | "saving" | "error";

export function createNoteAutosave(options: {
  save: () => Promise<void>;
  onStatus: (status: NoteSaveStatus, error?: unknown) => void;
  delay?: number;
}) {
  let revision = 0;
  let savedRevision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | undefined;
  const pending = () => revision !== savedRevision;
  const flush = (): Promise<boolean> => {
    clearTimeout(timer);
    if (running) return running;
    if (!pending()) return Promise.resolve(true);
    running = (async () => {
      while (pending()) {
        const savingRevision = revision;
        options.onStatus("saving");
        try {
          await options.save();
          savedRevision = savingRevision;
        } catch (error) {
          options.onStatus("error", error);
          return false;
        }
      }
      options.onStatus("saved");
      return true;
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
  return {
    pending,
    flush,
    changed() {
      revision++;
      options.onStatus(running ? "saving" : "pending");
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), options.delay ?? 800);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
