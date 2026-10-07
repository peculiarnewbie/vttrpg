import * as stylex from "@stylexjs/stylex";
import { Show, createSignal } from "solid-js";
import { ApiError } from "../client/api";
import { downloadWorld, readBackup, uploadPending } from "../client/world-backup";
import type { ExportFile } from "../domain/world-export";
import { colors, skin } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { styles } from "./styles.stylex";
import { Button, ErrorBanner } from "./ui";

/*
 * World settings → Backup: download the world as one file, and finish an
 * import whose images didn't all arrive. Starting a world from a backup is on
 * the worlds page, since it makes a new world.
 */
export function WorldBackup(props: {
  worldId: string;
  worldName: string;
  pending: readonly ExportFile[];
  onPending: (pending: readonly ExportFile[]) => void;
}) {
  const [chat, setChat] = createSignal(true);
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const busy = () => progress() !== null;

  const run = async (action: () => Promise<void>) => {
    setError("");
    setNotice("");
    setProgress({ done: 0, total: 0 });
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again.");
    } finally {
      setProgress(null);
    }
  };
  const report = (done: number, total: number) => setProgress({ done, total });

  const download = () =>
    run(() => downloadWorld(props.worldId, props.worldName, { chat: chat() }, report));
  const resume = (file: File) =>
    run(async () => {
      const backup = await readBackup(file);
      const missing = await uploadPending(props.worldId, backup, props.pending, report);
      const left = props.pending.filter((item) => missing.includes(item.path));
      props.onPending(left);
      setNotice(
        left.length
          ? `${left.length} ${left.length === 1 ? "file isn't" : "files aren't"} in that backup.`
          : "The import is finished.",
      );
    });

  return (
    <div {...sx(styles.col)}>
      <p {...sx(t.intro)}>
        A backup is one file with everything in this world that you can see: sheet templates,
        characters, the board's scenes and images, notes, chat and your compendium. Libraries are
        saved by name and version, not their text. Players' private notes and private rolls aren't
        included.
      </p>
      <ErrorBanner message={error()} />
      <Show when={notice()}>
        <div {...sx(t.notice)} role="status">
          {notice()}
        </div>
      </Show>

      <Show when={props.pending.length}>
        <div {...sx(t.warning)} role="status">
          <span {...sx(styles.spacer)}>
            This world's import isn't finished: {props.pending.length}{" "}
            {props.pending.length === 1 ? "file" : "files"} from the backup haven't been uploaded.
          </span>
          <label {...sx(styles.button, styles.buttonSmall)}>
            Choose the backup file
            <input
              type="file"
              accept=".zip,application/zip"
              hidden
              disabled={busy()}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void resume(file);
              }}
            />
          </label>
        </div>
      </Show>

      <h3 {...sx(styles.h3)}>Download a backup</h3>
      <label {...sx(styles.checkboxRow)}>
        <input
          type="checkbox"
          checked={chat()}
          disabled={busy()}
          onChange={(event) => setChat(event.currentTarget.checked)}
        />
        Include chat
      </label>
      <div {...sx(styles.row)}>
        <Button variant="primary" small disabled={busy()} onClick={() => void download()}>
          Download backup
        </Button>
        <Show when={progress()}>
          {(current) => (
            <span {...sx(styles.muted)} role="status">
              {current().total
                ? `${current().done} of ${current().total} files…`
                : "Preparing the backup…"}
            </span>
          )}
        </Show>
      </div>
      <p {...sx(styles.muted)}>
        To start a new world from a backup, use “New world from backup” on the worlds page.
        Importing never changes an existing world.
      </p>
    </div>
  );
}

const hair = { borderWidth: "1px", borderStyle: "solid", borderColor: colors.border } as const;

const t = stylex.create({
  intro: { margin: 0, maxWidth: "70ch", color: colors.textMuted, fontSize: "14px" },
  notice: {
    padding: "8px 10px",
    ...hair,
    borderColor: colors.success,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.successMuted,
    color: colors.text,
    fontSize: "13px",
  },
  warning: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    ...hair,
    borderColor: colors.danger,
    borderRadius: skin.controlRadius,
    backgroundColor: colors.dangerMuted,
    color: colors.text,
    fontSize: "13px",
  },
});
