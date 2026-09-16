import { useBeforeLeave } from "@solidjs/router";
import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { api } from "../client/api";
import { prepareBoardImage } from "../client/board-image";
import {
  MAX_BOARD_ELEMENTS,
  isElementVisible,
  screenToBoard,
  zoomAt,
  type BoardCamera,
  type BoardDocument,
  type BoardElement,
  type BoardSnapshot,
} from "../domain/board";
import { sx } from "../theme/sx";
import { boardStyles as b } from "./board.stylex";
import { styles } from "./styles.stylex";
import { Button, ErrorBanner, Field } from "./ui";

type Gesture = { pointerId: number; startX: number; startY: number; camera: BoardCamera } & (
  | { type: "pan" }
  | { type: "move"; element: BoardElement; node: HTMLElement; x: number; y: number }
);

export function MoodBoard(props: {
  worldId: string;
  isDm: boolean;
  snapshot: BoardSnapshot;
  onPublished: (board: BoardSnapshot) => void;
}) {
  const [document, setDocument] = createSignal<BoardDocument>(props.snapshot.document);
  const [revision, setRevision] = createSignal(props.snapshot.revision);
  const [dirty, setDirty] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [live, setLive] = createSignal(false);
  const [interacting, setInteracting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [camera, setCamera] = createSignal<BoardCamera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = createSignal({ width: 1000, height: 700 });
  const [past, setPast] = createSignal<BoardDocument[]>([]);
  const [future, setFuture] = createSignal<BoardDocument[]>([]);
  let viewport!: HTMLDivElement;
  let picker!: HTMLInputElement;
  let uploadKind: "background" | "element" = "element";
  let gesture: Gesture | undefined;
  let raf = 0;
  let disposed = false;
  useBeforeLeave((event) => {
    if (dirty() && !window.confirm("Leave without publishing your board changes?"))
      event.preventDefault();
  });
  const canEdit = () => props.isDm && editing() && !busy();
  const current = () => document().elements.find((item) => item.id === selected());
  const imageUrl = (id: string) => api.boardImageUrl(props.worldId, id);

  const adopt = (snapshot: BoardSnapshot) => {
    setDocument(snapshot.document);
    setRevision(snapshot.revision);
    setDirty(false);
    setPast([]);
    setFuture([]);
    setSelected(null);
    setError("");
  };
  createEffect(
    () => props.snapshot,
    (snapshot) => {
      if (!dirty() && !gesture && snapshot.revision > revision()) adopt(snapshot);
    },
  );
  const commit = (next: BoardDocument) => {
    // Upload completion commits while the busy signal is still settling.
    if (!props.isDm || !editing()) return;
    setPast((items) => [...items.slice(-49), document()]);
    setFuture([]);
    setDocument(next);
    setDirty(true);
  };
  const updateElement = (next: BoardElement) =>
    commit({
      ...document(),
      elements: document().elements.map((item) => (item.id === next.id ? next : item)),
    });
  const undo = () => {
    const previous = past().at(-1);
    if (!canEdit() || !previous) return;
    setFuture((items) => [...items, document()]);
    setPast((items) => items.slice(0, -1));
    setDocument(previous);
    setDirty(true);
  };
  const redo = () => {
    const next = future().at(-1);
    if (!canEdit() || !next) return;
    setPast((items) => [...items, document()]);
    setFuture((items) => items.slice(0, -1));
    setDocument(next);
    setDirty(true);
  };
  const remove = () => {
    if (!current()) return;
    commit({
      ...document(),
      elements: document().elements.filter((item) => item.id !== selected()),
    });
    setSelected(null);
  };
  const center = () => {
    const point = screenToBoard({ x: size().width / 2, y: size().height / 2 }, camera());
    return {
      x: Math.max(-99000, Math.min(99000, point.x)),
      y: Math.max(-99000, Math.min(99000, point.y)),
    };
  };
  const addText = () => {
    if (document().elements.length >= MAX_BOARD_ELEMENTS) return;
    const point = center();
    const element: BoardElement = {
      type: "text",
      id: crypto.randomUUID(),
      x: point.x - 120,
      y: point.y - 80,
      width: 240,
      height: 160,
      text: "A new chapter…",
    };
    commit({ ...document(), elements: [...document().elements, element] });
    setSelected(element.id);
  };
  const chooseImage = (kind: typeof uploadKind) => {
    uploadKind = kind;
    picker.click();
  };
  const upload = async (file: File) => {
    if (!canEdit()) return;
    const kind = uploadKind;
    if (kind === "element" && document().elements.length >= MAX_BOARD_ELEMENTS) return;
    setBusy(true);
    setError("");
    try {
      const image = await prepareBoardImage(file);
      const { assetId } = await api.uploadBoardImage(props.worldId, image.blob);
      if (disposed) return;
      setBusy(false);
      if (kind === "background") commit({ ...document(), background: assetId });
      else {
        const point = center();
        const scale = Math.min(1, 400 / Math.max(image.width, image.height));
        const width = Math.max(24, image.width * scale),
          height = Math.max(24, image.height * scale);
        const element: BoardElement = {
          type: "image",
          id: crypto.randomUUID(),
          assetId,
          label: (file.name || "Pasted image").slice(0, 200),
          x: point.x - width / 2,
          y: point.y - height / 2,
          width,
          height,
        };
        commit({ ...document(), elements: [...document().elements, element] });
        setSelected(element.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload image");
    } finally {
      setBusy(false);
      if (!disposed) picker.value = "";
    }
  };
  const publish = async () => {
    if (!props.isDm || busy() || gesture || !dirty()) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.publishBoard(props.worldId, {
        revision: revision(),
        document: document(),
      });
      if (disposed) return;
      if (props.snapshot.revision > saved.revision) adopt(props.snapshot);
      else {
        setRevision(saved.revision);
        setDirty(false);
      }
      props.onPublished(saved);
    } catch (err) {
      // Keep the draft and stop automatic retries until the DM resolves the error.
      setLive(false);
      setError(err instanceof Error ? err.message : "Could not publish board");
    } finally {
      setBusy(false);
    }
  };
  createEffect(
    () => ({
      live: live(),
      dirty: dirty(),
      busy: busy(),
      interacting: interacting(),
      document: document(),
    }),
    (state) => {
      if (!props.isDm || !state.live || !state.dirty || state.busy || state.interacting) return;
      const timer = setTimeout(() => void publish(), 600);
      onCleanup(() => clearTimeout(timer));
    },
  );
  const fit = () => {
    const elements = document().elements;
    if (!elements.length) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const x = Math.min(...elements.map((item) => item.x)),
      y = Math.min(...elements.map((item) => item.y));
    const right = Math.max(...elements.map((item) => item.x + item.width)),
      bottom = Math.max(...elements.map((item) => item.y + item.height));
    const zoom = Math.max(
      0.1,
      Math.min(1, (size().width - 80) / (right - x), (size().height - 160) / (bottom - y)),
    );
    setCamera({
      x: (size().width - (right - x) * zoom) / 2 - x * zoom,
      y: (size().height - (bottom - y) * zoom) / 2 - y * zoom,
      zoom,
    });
  };
  const paintGesture = () => {
    raf = 0;
    if (gesture?.type === "move")
      gesture.node.style.transform = `translate3d(${gesture.x}px, ${gesture.y}px, 0)`;
  };
  const start = (event: PointerEvent) => {
    if (gesture || (event.button !== 0 && event.button !== 1)) return;
    setInteracting(true);
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-board-element]")
        : null;
    const element = document().elements.find((item) => item.id === target?.dataset.boardElement);
    const common = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera: camera(),
    };
    if (canEdit() && element && target && event.button === 0 && !event.altKey) {
      setSelected(element.id);
      gesture = { ...common, type: "move", element, node: target, x: element.x, y: element.y };
    } else {
      setSelected(null);
      gesture = { ...common, type: "pan" };
    }
    viewport.focus();
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX,
      dy = event.clientY - gesture.startY;
    if (gesture.type === "pan")
      setCamera({ ...gesture.camera, x: gesture.camera.x + dx, y: gesture.camera.y + dy });
    else {
      gesture.x = Math.max(-100000, Math.min(100000, gesture.element.x + dx / gesture.camera.zoom));
      gesture.y = Math.max(-100000, Math.min(100000, gesture.element.y + dy / gesture.camera.zoom));
      if (!raf) raf = requestAnimationFrame(paintGesture);
    }
  };
  const finish = (event: PointerEvent, cancel = false) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!cancel) move(event);
    cancelAnimationFrame(raf);
    raf = 0;
    const ended = gesture;
    gesture = undefined;
    setInteracting(false);
    if (ended.type === "move") {
      ended.node.style.transform = `translate3d(${ended.element.x}px, ${ended.element.y}px, 0)`;
      if (!cancel && (ended.x !== ended.element.x || ended.y !== ended.element.y))
        updateElement({ ...ended.element, x: ended.x, y: ended.y });
    }
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
    // Apply a publication that arrived while this viewer was panning.
    if (!dirty() && props.snapshot.revision > revision()) adopt(props.snapshot);
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (gesture) return;
    const rect = viewport.getBoundingClientRect();
    setCamera((prev) =>
      zoomAt(
        prev,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        prev.zoom * Math.exp(-event.deltaY * 0.002),
      ),
    );
  };
  const paste = (event: ClipboardEvent) => {
    if (!canEdit()) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    )
      return;
    const file = Array.from(event.clipboardData?.items ?? [])
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    uploadKind = "element";
    void upload(file);
  };
  onSettled(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    viewport.addEventListener("wheel", wheel, { passive: false });
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("paste", paste);
    onCleanup(() => {
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("paste", paste);
    });
  });
  onCleanup(() => {
    disposed = true;
    cancelAnimationFrame(raf);
  });

  return (
    <section {...sx(b.board)} aria-label="Mood board">
      <Show when={document().background}>
        {(assetId) => (
          <img
            {...sx(b.background)}
            src={imageUrl(assetId())}
            alt="Scene background"
            decoding="async"
          />
        )}
      </Show>
      <div
        ref={(element) => {
          viewport = element;
        }}
        {...sx(b.viewport)}
        tabindex={0}
        role="region"
        aria-label="Board canvas. Drag to pan, scroll to zoom. In edit mode, drag elements to move them."
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSelected(null);
            return;
          }
          if (!canEdit()) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
            return;
          }
          if (["Delete", "Backspace"].includes(event.key)) {
            event.preventDefault();
            remove();
            return;
          }
          const item = current(),
            step = event.shiftKey ? 10 : 1;
          if (item && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            updateElement({
              ...item,
              x: Math.max(
                -100000,
                Math.min(
                  100000,
                  item.x +
                    (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
                ),
              ),
              y: Math.max(
                -100000,
                Math.min(
                  100000,
                  item.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
                ),
              ),
            });
          }
        }}
      >
        <div
          {...sx(b.scene)}
          style={{
            transform: `translate3d(${camera().x}px, ${camera().y}px, 0) scale(${camera().zoom})`,
          }}
        >
          <For
            each={document().elements.filter(
              (item) => item.id === selected() || isElementVisible(item, camera(), size()),
            )}
          >
            {(item) => (
              <button
                type="button"
                {...sx(b.element, selected() === item.id && b.selected)}
                data-board-element={item.id}
                style={{
                  transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                }}
                tabindex={canEdit() ? 0 : -1}
                aria-label={item.type === "image" ? item.label : item.text}
                onFocus={() => {
                  if (canEdit()) setSelected(item.id);
                }}
              >
                {item.type === "image" ? (
                  <img
                    {...sx(b.image)}
                    src={imageUrl(item.assetId)}
                    alt={item.label}
                    draggable={false}
                    decoding="async"
                  />
                ) : (
                  <div {...sx(b.text)}>{item.text}</div>
                )}
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={!document().background && !document().elements.length}>
        <div {...sx(b.hint)}>
          <strong>Set the scene</strong>
          <p>
            {props.isDm
              ? "Edit the board to add a mood image, pictures, and story notes. Publish when you’re ready to share."
              : "Your DM’s scene will appear here."}
          </p>
        </div>
      </Show>
      <Show when={editing() && props.isDm && current()}>
        {(item) => (
          <div {...sx(b.inspector)}>
            <strong>Selected {item().type}</strong>
            <Show when={item().type === "text"}>
              <Field label="Text">
                <textarea
                  {...sx(styles.textarea)}
                  maxlength={2000}
                  disabled={busy()}
                  value={
                    item().type === "text"
                      ? (item() as Extract<BoardElement, { type: "text" }>).text
                      : ""
                  }
                  onChange={(event) => {
                    const value = item();
                    if (value.type === "text")
                      updateElement({ ...value, text: event.currentTarget.value });
                  }}
                />
              </Field>
            </Show>
            <For each={["width", "height"] as const}>
              {(dimension) => (
                <Field label={dimension === "width" ? "Width" : "Height"}>
                  <input
                    {...sx(styles.input)}
                    type="number"
                    min={24}
                    max={8000}
                    value={item()[dimension]}
                    disabled={busy()}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value))
                        updateElement({
                          ...item(),
                          [dimension]: Math.max(24, Math.min(8000, value)),
                        });
                    }}
                  />
                </Field>
              )}
            </For>
            <div {...sx(styles.rowWrap)}>
              <Button
                small
                disabled={busy()}
                onClick={() =>
                  commit({
                    ...document(),
                    elements: [
                      ...document().elements.filter((element) => element.id !== item().id),
                      item(),
                    ],
                  })
                }
              >
                Bring to front
              </Button>
              <Button small variant="danger" disabled={busy()} onClick={remove}>
                Delete
              </Button>
              <Button small onClick={() => setSelected(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Show>
      <div {...sx(b.toolbar)}>
        <Button
          small
          onClick={() =>
            setCamera((prev) =>
              zoomAt(prev, { x: size().width / 2, y: size().height / 2 }, prev.zoom / 1.2),
            )
          }
        >
          −
        </Button>
        <span {...sx(b.status)}>{Math.round(camera().zoom * 100)}%</span>
        <Button
          small
          onClick={() =>
            setCamera((prev) =>
              zoomAt(prev, { x: size().width / 2, y: size().height / 2 }, prev.zoom * 1.2),
            )
          }
        >
          +
        </Button>
        <Button small onClick={fit}>
          Fit board
        </Button>
        <Show when={props.isDm}>
          <Button
            small
            disabled={busy()}
            onClick={() => {
              setEditing(!editing());
              setSelected(null);
            }}
          >
            {editing() ? "View board" : "Edit board"}
          </Button>
          <Show when={editing()}>
            <label {...sx(styles.row, b.status)}>
              <input
                type="checkbox"
                checked={live()}
                disabled={busy()}
                onChange={(event) => setLive(event.currentTarget.checked)}
              />
              Live sharing
            </label>
            <input
              ref={(element) => {
                picker = element;
              }}
              {...sx(b.hidden)}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button small disabled={busy()} onClick={() => chooseImage("background")}>
              Background
            </Button>
            <Show when={document().background}>
              <Button
                small
                disabled={busy()}
                onClick={() => commit({ ...document(), background: null })}
              >
                Clear background
              </Button>
            </Show>
            <Button
              small
              disabled={busy() || document().elements.length >= MAX_BOARD_ELEMENTS}
              onClick={() => chooseImage("element")}
            >
              Add image
            </Button>
            <Button
              small
              disabled={busy() || document().elements.length >= MAX_BOARD_ELEMENTS}
              onClick={addText}
            >
              Add text
            </Button>
            <Button small disabled={busy() || !past().length} onClick={undo}>
              Undo
            </Button>
            <Button small disabled={busy() || !future().length} onClick={redo}>
              Redo
            </Button>
            <Button
              small
              variant="primary"
              disabled={busy() || interacting() || !dirty()}
              onClick={() => void publish()}
            >
              Publish
            </Button>
            <Show when={dirty()}>
              <Button
                small
                disabled={busy()}
                onClick={() => {
                  if (window.confirm("Discard your draft and load the published board?"))
                    adopt(props.snapshot);
                }}
              >
                Discard draft
              </Button>
            </Show>
          </Show>
          <span {...sx(b.status)} role="status">
            {busy()
              ? "Saving…"
              : dirty()
                ? live()
                  ? "Sharing…"
                  : "Unpublished changes"
                : live()
                  ? "Live sharing"
                  : "Shared board"}
          </span>
          <Show when={dirty() && props.snapshot.revision > revision()}>
            <span {...sx(b.status)}>
              A newer board was published. Discard this draft to load it.
            </span>
          </Show>
        </Show>
        <ErrorBanner message={error()} />
      </div>
    </section>
  );
}
