import { useBeforeLeave } from "@solidjs/router";
import { For, Show, createEffect, createSignal, onCleanup, onSettled } from "solid-js";
import { api } from "../client/api";
import { prepareBoardImage } from "../client/board-image";
import {
  clampCoordinate,
  boardFontSize,
  pinchCamera,
  resizeElement,
  resizeHandles,
  touchPair,
  wheelZoomFactor,
  type Point,
  type ResizeHandle,
} from "../client/board-geometry";
import {
  MAX_BOARD_ELEMENTS,
  normalizeBoard,
  orderedBoardElements,
  orderBoardElement,
  type SceneList,
  boardViewport,
  fitBoardRect,
  type BoardFocusRect,
  isElementVisible,
  screenToBoard,
  zoomAt,
  type BoardCamera,
  type BoardDocument,
  type BoardElement,
  type BoardSnapshot,
} from "../domain/board";
import type { BoardFocus, CursorPosition, LiveCursor } from "../domain/schemas";
import { createCursorPublisher, cursorColor } from "../client/live-cursors";
import { sx } from "../theme/sx";
import { boardStyles as b } from "./board.stylex";
import { styles } from "./styles.stylex";
import { BoardScenes } from "./board-scenes";
import { BoardLayers } from "./board-layers";
import { Button, ErrorBanner } from "./ui";

type SingleGesture = {
  pointerId: number;
  start: Point;
  camera: BoardCamera;
  moved: boolean;
  threshold: number;
} & (
  | { type: "pan" }
  | { type: "move"; element: BoardElement; next: BoardElement }
  | { type: "resize"; element: BoardElement; next: BoardElement; handle: ResizeHandle }
);
type Gesture =
  | SingleGesture
  | {
      type: "pinch";
      camera: BoardCamera;
      initial: ReturnType<typeof touchPair>;
    };

export function MoodBoard(props: {
  worldId: string;
  isDm: boolean;
  snapshot: BoardSnapshot;
  sceneList: SceneList;
  onSceneList: (list: SceneList) => void;
  focus: BoardFocus | null;
  onFocus: (rect: BoardFocusRect, sceneId: string) => void;
  onPublished: (board: BoardSnapshot) => void;
  cursors: readonly LiveCursor[];
  cursorsEnabled: boolean;
  onCursor: (position: CursorPosition | null) => void;
}) {
  const [document, setDocument] = createSignal<BoardDocument>(
    normalizeBoard(props.snapshot.document),
  );
  const [sceneId, setSceneId] = createSignal(props.snapshot.sceneId ?? "");
  const [published, setPublished] = createSignal(props.snapshot);
  const [layerId, setLayerId] = createSignal("");
  const layers = () => normalizeBoard(document()).layers;
  const selectedLayer = () => layers().find((layer) => layer.id === layerId()) ?? layers().at(-1)!;
  const layerFor = (item: BoardElement) =>
    layers().find((layer) => layer.id === item.layerId) ?? layers()[0];
  const isLiveScene = () => sceneId() === props.sceneList.activeSceneId;
  const sceneName = () =>
    props.sceneList.scenes.find((scene) => scene.id === sceneId())?.name ??
    published().sceneName ??
    "Scene";
  const [revision, setRevision] = createSignal(props.snapshot.revision);
  const [dirty, setDirty] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [live, setLive] = createSignal(false);
  const [interacting, setInteracting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal<string | null>(null);
  const [camera, setCamera] = createSignal<BoardCamera>({ x: 0, y: 0, zoom: 1 });
  const [followDm, setFollowDm] = createSignal(false);
  const [pendingFocus, setPendingFocus] = createSignal<BoardFocus | null>(null);
  const [highlight, setHighlight] = createSignal<BoardFocusRect | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let cameraRaf = 0;
  const stopCameraAnimation = () => cancelAnimationFrame(cameraRaf);
  const showFocus = (rect: BoardFocusRect) => {
    clearTimeout(highlightTimer);
    setHighlight({ ...rect });
    highlightTimer = setTimeout(() => setHighlight(null), 2400);
  };
  createEffect(
    () => props.worldId,
    (worldId) => {
      try {
        setFollowDm(localStorage.getItem(`ttrpg:follow-dm:${worldId}`) === "on");
      } catch {
        setFollowDm(false);
      }
    },
  );
  const toggleFollowDm = () => {
    const enabled = !followDm();
    setFollowDm(enabled);
    try {
      localStorage.setItem(`ttrpg:follow-dm:${props.worldId}`, enabled ? "on" : "off");
    } catch {
      // Following remains usable when storage is unavailable.
    }
    const pending = pendingFocus();
    if (enabled && pending) goToFocus(pending.rect);
  };
  const [pointer, setPointer] = createSignal<Point | null>(null);
  const cursorPublisher = createCursorPublisher((position) => props.onCursor(position));
  createEffect(
    () => ({ point: pointer(), camera: camera(), enabled: props.cursorsEnabled && isLiveScene() }),
    ({ point, camera, enabled }) => {
      const position = point && enabled ? screenToBoard(point, camera) : null;
      cursorPublisher.update(
        position && {
          x: clampCoordinate(position.x),
          y: clampCoordinate(position.y),
        },
      );
    },
  );
  const [size, setSize] = createSignal({ width: 1000, height: 700 });
  const [past, setPast] = createSignal<BoardDocument[]>([]);
  const [future, setFuture] = createSignal<BoardDocument[]>([]);
  const [tool, setTool] = createSignal<"select" | "hand">("select");
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [preview, setPreview] = createSignal<BoardElement | null>(null);
  const [textEdit, setTextEdit] = createSignal<{ id: string; initial: string } | null>(null);
  const pointers = new Map<number, Point>();
  let textSession: { id: string; initial: string } | undefined;
  let textDraft = "";
  let lastTap: { id: string; time: number; point: Point } | undefined;
  let viewport!: HTMLDivElement;
  let picker!: HTMLInputElement;
  let uploadKind: "background" | "element" = "element";
  let gesture: Gesture | undefined;
  let raf = 0;
  let disposed = false;
  useBeforeLeave((event) => {
    const hasTextChange = textSession && textDraft !== textSession.initial;
    finishText();
    if (
      (dirty() || hasTextChange) &&
      !window.confirm("Leave without publishing your board changes?")
    )
      event.preventDefault();
  });
  const canEdit = () => props.isDm && editing() && !busy();
  const current = () =>
    document().elements.find((item) => item.id === selected() && !layerFor(item).locked);
  const selectionBounds = () => preview() ?? current();
  const imageUrl = (id: string) => api.boardImageUrl(props.worldId, id);

  const adopt = (snapshot: BoardSnapshot) => {
    textSession = undefined;
    setDocument(normalizeBoard(snapshot.document));
    setSceneId(snapshot.sceneId ?? sceneId());
    setPublished(snapshot);
    setRevision(snapshot.revision);
    setDirty(false);
    setPast([]);
    setFuture([]);
    setSelected(null);
    setTextEdit(null);
    setError("");
  };
  const openScene = async (load: () => Promise<BoardSnapshot>) => {
    if (busy()) return;
    const hasTextChange = textSession && textDraft !== textSession.initial;
    finishText();
    if (
      (dirty() || hasTextChange) &&
      !window.confirm("Discard unpublished changes and open this scene?")
    )
      return;
    cancelGesture();
    setBusy(true);
    try {
      const snapshot = await load();
      if (disposed) return;
      const incoming = props.snapshot;
      adopt(
        incoming.sceneId === snapshot.sceneId && incoming.revision > snapshot.revision
          ? incoming
          : snapshot,
      );
      setLayerId("");
      setPendingFocus(null);
      setHighlight(null);
      fit();
    } finally {
      setBusy(false);
    }
  };
  createEffect(
    () => ({
      snapshot: props.snapshot,
      dirty: dirty(),
      interacting: interacting(),
      textEdit: textEdit(),
      busy: busy(),
    }),
    ({ snapshot, dirty, interacting, textEdit, busy }) => {
      if (snapshot.sceneId !== sceneId()) {
        if (!props.isDm || !sceneId()) {
          cancelGesture();
          adopt(snapshot);
          setPendingFocus(null);
          setHighlight(null);
          fit();
        }
        return;
      }
      if (snapshot.revision >= published().revision) setPublished(snapshot);
      if (!dirty && !interacting && !textEdit && !busy && snapshot.revision > revision())
        adopt(snapshot);
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
  const finishText = (cancel = false) => {
    const edit = textSession;
    if (!edit) return;
    // Blur may fire before Solid flushes the editor's removal. Finalize once.
    textSession = undefined;
    const element = document().elements.find((item) => item.id === edit.id);
    setTextEdit(null);
    if (!cancel && element?.type === "text" && textDraft !== element.text)
      updateElement({ ...element, text: textDraft });
  };
  const editText = (element = current()) => {
    if (!canEdit() || element?.type !== "text") return;
    textDraft = element.text;
    textSession = { id: element.id, initial: element.text };
    setTextEdit(textSession);
  };
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
    if (!canEdit() || !current()) return;
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
    if (selectedLayer().locked || document().elements.length >= MAX_BOARD_ELEMENTS) return;
    const point = center();
    const element: BoardElement = {
      type: "text",
      layerId: selectedLayer().id,
      id: crypto.randomUUID(),
      x: point.x - 120,
      y: point.y - 80,
      width: 240,
      height: 160,
      text: "A new chapter…",
    };
    commit({ ...document(), elements: [...document().elements, element] });
    setSelected(element.id);
    editText(element);
  };
  const chooseImage = (kind: typeof uploadKind) => {
    uploadKind = kind;
    picker.click();
  };
  const upload = async (file: File) => {
    if (!canEdit()) return;
    const kind = uploadKind;
    if (
      kind === "element" &&
      (selectedLayer().locked || document().elements.length >= MAX_BOARD_ELEMENTS)
    )
      return;
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
          layerId: selectedLayer().id,
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
    if (!props.isDm || busy() || gesture || textEdit() || !dirty()) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.publishScene(props.worldId, sceneId(), {
        revision: revision(),
        document: document(),
      });
      if (disposed) return;
      if (published().revision > saved.revision) adopt(published());
      else {
        setRevision(saved.revision);
        setDirty(false);
      }
      if (saved.revision >= published().revision) setPublished(saved);
      props.onPublished(published());
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
      live: live() && isLiveScene(),
      dirty: dirty(),
      busy: busy(),
      interacting: interacting(),
      textEdit: textEdit(),
      document: document(),
    }),
    (state) => {
      if (
        !props.isDm ||
        !state.live ||
        !state.dirty ||
        state.busy ||
        state.interacting ||
        state.textEdit
      )
        return;
      const timer = setTimeout(() => void publish(), 600);
      onCleanup(() => clearTimeout(timer));
    },
  );
  const fit = () => {
    if (gesture) return;
    stopCameraAnimation();
    const elements = document().elements;
    if (!elements.length) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const x = Math.min(...elements.map((item) => item.x)),
      y = Math.min(...elements.map((item) => item.y));
    const right = Math.max(...elements.map((item) => item.x + item.width)),
      bottom = Math.max(...elements.map((item) => item.y + item.height));
    setCamera(fitBoardRect({ x, y, width: right - x, height: bottom - y }, size()));
  };
  const goToFocus = (rect: BoardFocusRect) => {
    cancelGesture();
    stopCameraAnimation();
    setPendingFocus(null);
    showFocus(rect);
    const initial = camera();
    const target = fitBoardRect(rect, size());
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCamera(target);
      return;
    }
    const started = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 350);
      const eased = 1 - (1 - progress) ** 3;
      setCamera({
        x: initial.x + (target.x - initial.x) * eased,
        y: initial.y + (target.y - initial.y) * eased,
        zoom: initial.zoom + (target.zoom - initial.zoom) * eased,
      });
      if (progress < 1) cameraRaf = requestAnimationFrame(animate);
    };
    cameraRaf = requestAnimationFrame(animate);
  };
  const sendFocus = (rect = boardViewport(camera(), size())) => {
    if (!props.isDm || !isLiveScene() || rect.width <= 0 || rect.height <= 0) return;
    props.onFocus(rect, sceneId());
    showFocus(rect);
  };
  createEffect(
    () => props.focus,
    (focus) => {
      if (!focus || !isLiveScene() || (focus.sceneId && focus.sceneId !== sceneId())) return;
      showFocus(focus.rect);
      if (!props.isDm && followDm()) goToFocus(focus.rect);
      else setPendingFocus(focus);
    },
  );

  const paintGesture = () => {
    raf = 0;
    if (gesture?.type === "move" || gesture?.type === "resize") setPreview(gesture.next);
  };
  const localPoint = (event: PointerEvent): Point => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pair = () => {
    const [first, second] = pointers.values();
    return first && second ? touchPair([first, second]) : undefined;
  };
  const clearPreview = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    setPreview(null);
  };
  const cancelGesture = () => {
    const ids = [...pointers.keys()];
    gesture = undefined;
    pointers.clear();
    clearPreview();
    lastTap = undefined;
    setInteracting(false);
    for (const id of ids) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  };
  const start = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    stopCameraAnimation();
    finishText();
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    setInteracting(true);
    const touches = pair();
    if (touches) {
      // A second finger means navigation; abandon any uncommitted object drag.
      clearPreview();
      lastTap = undefined;
      gesture = { type: "pinch", camera: camera(), initial: touches };
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const id = target?.closest<HTMLElement>("[data-board-element]")?.dataset.boardElement;
    const element = document().elements.find((item) => item.id === id);
    const handle = resizeHandles.find(
      (item) => item.id === target?.closest<HTMLElement>("[data-resize]")?.dataset.resize,
    );
    const common = {
      pointerId: event.pointerId,
      start: point,
      camera: camera(),
      moved: false,
      threshold: event.pointerType === "touch" ? 8 : 3,
    };
    const navigating = tool() === "hand" || spaceHeld() || event.button === 1 || event.altKey;
    if (canEdit() && !navigating && handle && current()) {
      const selectedElement = current()!;
      gesture = {
        ...common,
        type: "resize",
        element: selectedElement,
        next: selectedElement,
        handle: handle.id,
      };
    } else if (canEdit() && !navigating && element && !layerFor(element).locked) {
      setSelected(element.id);
      gesture = { ...common, type: "move", element, next: element };
    } else {
      if (!navigating) setSelected(null);
      gesture = { ...common, type: "pan" };
    }
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (gesture.type === "pinch") {
      const touches = pair();
      if (touches)
        setCamera(
          pinchCamera({ camera: gesture.camera, initial: gesture.initial, current: touches }),
        );
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const dx = point.x - gesture.start.x,
      dy = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < gesture.threshold) return;
    gesture.moved = true;
    lastTap = undefined;
    if (gesture.type === "pan") {
      setCamera({ ...gesture.camera, x: gesture.camera.x + dx, y: gesture.camera.y + dy });
      return;
    }
    const delta = { x: dx / gesture.camera.zoom, y: dy / gesture.camera.zoom };
    gesture.next =
      gesture.type === "resize"
        ? resizeElement({
            element: gesture.element,
            handle: gesture.handle,
            delta,
            unlockImageRatio: event.shiftKey,
          })
        : {
            ...gesture.element,
            x: clampCoordinate(gesture.element.x + delta.x),
            y: clampCoordinate(gesture.element.y + delta.y),
          };
    if (!raf) raf = requestAnimationFrame(paintGesture);
  };
  const finish = (event: PointerEvent, cancel = false) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    if (cancel) {
      cancelGesture();
      return;
    }
    move(event);
    const ended = gesture;
    pointers.delete(event.pointerId);
    gesture = undefined;
    clearPreview();
    if (ended.type === "pinch") {
      const touches = pair();
      if (touches) gesture = { type: "pinch", camera: camera(), initial: touches };
      else {
        const [remaining] = pointers;
        // Continue with one finger as a pan, never as an object drag or tap.
        if (remaining)
          gesture = {
            type: "pan",
            pointerId: remaining[0],
            start: remaining[1],
            camera: camera(),
            moved: true,
            threshold: 0,
          };
      }
    } else if (ended.type === "move" || ended.type === "resize") {
      if (ended.moved) {
        const next = ended.next;
        if (
          next.x !== ended.element.x ||
          next.y !== ended.element.y ||
          next.width !== ended.element.width ||
          next.height !== ended.element.height
        )
          updateElement(next);
      } else if (ended.type === "move") {
        const point = localPoint(event);
        if (
          lastTap?.id === ended.element.id &&
          event.timeStamp - lastTap.time < 350 &&
          Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < 24
        ) {
          lastTap = undefined;
          editText(ended.element);
        } else lastTap = { id: ended.element.id, time: event.timeStamp, point };
      }
    } else lastTap = undefined;
    setInteracting(!!gesture);
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
  };
  const changeZoom = (zoom: number) => {
    stopCameraAnimation();
    if (gesture) return;
    setCamera((previous) => zoomAt(previous, { x: size().width / 2, y: size().height / 2 }, zoom));
  };
  const wheel = (event: WheelEvent) => {
    if (event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    stopCameraAnimation();
    if (gesture) return;
    const rect = viewport.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size().height : 1;
    const dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      setCamera((prev) =>
        zoomAt(
          prev,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          prev.zoom * wheelZoomFactor(event.deltaY, event.deltaMode, size().height),
        ),
      );
    } else {
      setCamera((prev) => ({
        ...prev,
        x: prev.x - (event.shiftKey ? dy : dx),
        y: prev.y - (event.shiftKey ? 0 : dy),
      }));
    }
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (event.key === "Escape") {
      cancelGesture();
      setSelected(null);
      return;
    }
    if (gesture) return;
    if (["+", "=", "-", "0", "1"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "1") fit();
      else changeZoom(event.key === "0" ? 1 : camera().zoom * (event.key === "-" ? 1 / 1.2 : 1.2));
      return;
    }
    if (!canEdit()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      editText();
      return;
    }
    if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      remove();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === "h") setTool("hand");
      if (event.key.toLowerCase() === "v") setTool("select");
    }
    const item = current(),
      step = event.shiftKey ? 10 : 1;
    if (item && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      updateElement({
        ...item,
        x: clampCoordinate(
          item.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
        ),
        y: clampCoordinate(
          item.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
        ),
      });
    }
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
      if (dirty() || (textEdit() && textDraft !== textEdit()?.initial)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("paste", paste);
    const releaseSpace = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const blur = () => {
      setPointer(null);
      cursorPublisher.clear();
      setSpaceHeld(false);
      cancelGesture();
    };
    window.addEventListener("keyup", releaseSpace);
    window.addEventListener("blur", blur);
    onCleanup(() => {
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keyup", releaseSpace);
      window.removeEventListener("blur", blur);
    });
  });
  onCleanup(() => {
    disposed = true;
    stopCameraAnimation();
    clearTimeout(highlightTimer);
    cursorPublisher.clear();
    cancelAnimationFrame(raf);
  });

  return (
    <section {...sx(b.board)} aria-label="Mood board">
      <Show when={props.isDm}>
        <aside {...sx(b.scenePanels)} aria-label="Scene and layer controls">
          <Show
            when={
              props.sceneList.scenes.length > 0 &&
              !props.sceneList.scenes.some((scene) => scene.id === sceneId())
            }
          >
            <p {...sx(b.status)} role="alert">
              This scene was deleted in another tab. Open another scene to continue.
            </p>
          </Show>
          <p {...sx(b.status)} role="status">
            {sceneName()} · {isLiveScene() ? "LIVE" : "PRIVATE PREP — players see another scene"}
          </p>
          <BoardScenes
            worldId={props.worldId}
            scenes={props.sceneList.scenes}
            activeId={props.sceneList.activeSceneId}
            selectedId={sceneId()}
            busy={busy() || interacting()}
            onOpen={openScene}
            onList={props.onSceneList}
          />
          <Show when={editing()}>
            <BoardLayers
              document={document()}
              selectedId={selectedLayer().id}
              busy={busy() || interacting()}
              onSelect={setLayerId}
              onChange={(next) => {
                finishText();
                commit(next);
                setSelected(null);
              }}
            />
          </Show>
        </aside>
      </Show>
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
        aria-label="Board canvas. Pinch to zoom, drag empty space to pan. Select an element to move or resize it."
        aria-describedby="board-help"
        style={{
          cursor:
            spaceHeld() || tool() === "hand" || !canEdit()
              ? interacting()
                ? "grabbing"
                : "grab"
              : "default",
        }}
        onPointerDown={start}
        onPointerMove={(event) => {
          if (event.isPrimary) setPointer(localPoint(event));
          move(event);
        }}
        onPointerLeave={() => setPointer(null)}
        onPointerUp={(event) => {
          finish(event);
          if (event.pointerType === "touch") setPointer(null);
        }}
        onPointerCancel={(event) => {
          setPointer(null);
          finish(event, true);
        }}
        onLostPointerCapture={(event) => finish(event, true)}
        onKeyDown={keyDown}
      >
        <div
          {...sx(b.scene)}
          style={{
            transform: `translate3d(${camera().x}px, ${camera().y}px, 0) scale(${camera().zoom})`,
          }}
        >
          <For
            each={orderedBoardElements(document()).filter(
              (item) =>
                (!layerFor(item).hidden || (props.isDm && editing())) &&
                (item.id === selected() || isElementVisible(item, camera(), size())),
            )}
          >
            {(item) => {
              const bounds = () => (selected() === item.id && preview() ? preview()! : item);
              return (
                <div
                  role="button"
                  {...sx(b.element)}
                  data-board-element={item.id}
                  style={{
                    transform: `translate3d(${bounds().x}px, ${bounds().y}px, 0)`,
                    width: `${bounds().width}px`,
                    height: `${bounds().height}px`,
                    "pointer-events": layerFor(item).locked ? "none" : "auto",
                    opacity: layerFor(item).hidden ? 0.4 : 1,
                    visibility: textEdit()?.id === item.id ? "hidden" : "visible",
                    cursor: canEdit() && tool() === "select" && !spaceHeld() ? "move" : "inherit",
                  }}
                  tabindex={canEdit() && !layerFor(item).locked ? 0 : -1}
                  aria-label={item.type === "image" ? item.label : item.text || "Empty text"}
                  aria-pressed={selected() === item.id ? "true" : "false"}
                  onFocus={() => {
                    if (canEdit() && !layerFor(item).locked) setSelected(item.id);
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
                    <div {...sx(b.text)} style={{ "font-size": `${boardFontSize(bounds())}px` }}>
                      {item.text}
                    </div>
                  )}
                </div>
              );
            }}
          </For>
          <Show when={textEdit()}>
            {(edit) => {
              const item = () => document().elements.find((element) => element.id === edit().id)!;
              return (
                <textarea
                  ref={(node) => {
                    queueMicrotask(() => {
                      if (node.isConnected) {
                        node.focus({ preventScroll: true });
                        node.select();
                      }
                    });
                  }}
                  {...sx(b.element, b.text, b.textEditor)}
                  aria-label="Edit board text"
                  maxlength={2000}
                  value={edit().initial}
                  style={{
                    transform: `translate3d(${item().x}px, ${item().y}px, 0)`,
                    width: `${item().width}px`,
                    height: `${item().height}px`,
                    "font-size": `${boardFontSize(item())}px`,
                  }}
                  onInput={(event) => {
                    textDraft = event.currentTarget.value;
                  }}
                  onBlur={() => finishText()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.isComposing) return;
                    if (
                      event.key === "Escape" ||
                      (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                    ) {
                      event.preventDefault();
                      finishText(event.key === "Escape");
                      viewport.focus({ preventScroll: true });
                    }
                  }}
                />
              );
            }}
          </Show>
        </div>
        <Show when={highlight()} keyed>
          {(rect) => (
            <div
              aria-hidden="true"
              {...sx(b.focusOutline)}
              style={{
                left: `${rect.x * camera().zoom + camera().x}px`,
                top: `${rect.y * camera().zoom + camera().y}px`,
                width: `${rect.width * camera().zoom}px`,
                height: `${rect.height * camera().zoom}px`,
              }}
            />
          )}
        </Show>
        <For each={props.cursorsEnabled && isLiveScene() ? props.cursors : []}>
          {(cursor) => (
            <Show when={cursor.position}>
              {(position) => (
                <div
                  {...sx(b.remoteCursor)}
                  aria-hidden="true"
                  style={{
                    transform: `translate3d(${position().x * camera().zoom + camera().x}px, ${position().y * camera().zoom + camera().y}px, 0)`,
                  }}
                >
                  <svg
                    width="22"
                    height="27"
                    viewBox="0 0 22 27"
                    fill={cursorColor(cursor.memberId)}
                  >
                    <path
                      d="M2 2 L19 16 L11 17 L7 24 Z"
                      stroke="white"
                      stroke-width="2"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span
                    {...sx(b.cursorName)}
                    style={{ "border-left-color": cursorColor(cursor.memberId) }}
                  >
                    {cursor.displayName}
                  </span>
                </div>
              )}
            </Show>
          )}
        </For>
        <Show when={canEdit() && !textEdit() && selectionBounds()}>
          {(bounds) => (
            <div
              {...sx(b.selection)}
              style={{
                left: `${bounds().x * camera().zoom + camera().x}px`,
                top: `${bounds().y * camera().zoom + camera().y}px`,
                width: `${bounds().width * camera().zoom}px`,
                height: `${bounds().height * camera().zoom}px`,
              }}
            >
              <For each={resizeHandles}>
                {(handle) => (
                  <Show
                    when={
                      handle.id.length === 2 ||
                      (bounds().width * camera().zoom > 80 && bounds().height * camera().zoom > 80)
                    }
                  >
                    <button
                      type="button"
                      {...sx(b.resizeHandle)}
                      aria-label={`Resize ${handle.label}`}
                      data-resize={handle.id}
                      style={{
                        left: `${handle.x * 100}%`,
                        top: `${handle.y * 100}%`,
                        cursor: `${handle.id}-resize`,
                      }}
                      onKeyDown={(event) => {
                        const item = current();
                        if (
                          !item ||
                          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const step = event.shiftKey ? 10 : 1;
                        updateElement(
                          resizeElement({
                            element: item,
                            handle: handle.id,
                            delta: {
                              x:
                                event.key === "ArrowLeft"
                                  ? -step
                                  : event.key === "ArrowRight"
                                    ? step
                                    : 0,
                              y:
                                event.key === "ArrowUp"
                                  ? -step
                                  : event.key === "ArrowDown"
                                    ? step
                                    : 0,
                            },
                          }),
                        );
                      }}
                    >
                      <span {...sx(b.handleDot)} />
                    </button>
                  </Show>
                )}
              </For>
            </div>
          )}
        </Show>
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
        <div {...sx(b.objectActions)} role="group" aria-label="Selected element actions">
          <Show when={current()?.type === "text"}>
            <Show
              when={textEdit()}
              fallback={
                <Button small disabled={busy()} onClick={() => editText()}>
                  Edit text
                </Button>
              }
            >
              <button
                type="button"
                {...sx(b.control)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  finishText();
                  viewport.focus({ preventScroll: true });
                }}
              >
                Done editing
              </button>
            </Show>
          </Show>
          <Button
            small
            disabled={busy()}
            onClick={() => {
              const item = current();
              if (item) commit(orderBoardElement(document(), item.id, "front"));
            }}
          >
            Bring to front
          </Button>
          <Button
            small
            disabled={busy()}
            onClick={() => {
              const item = current();
              if (item) commit(orderBoardElement(document(), item.id, "back"));
            }}
          >
            Send to back
          </Button>
          <label>
            Move to layer
            <select
              {...sx(b.control)}
              aria-label="Move to layer"
              disabled={busy()}
              value={current()?.layerId ?? ""}
              onChange={(event) => {
                const item = current();
                if (item) {
                  updateElement({ ...item, layerId: event.currentTarget.value });
                  setSelected(null);
                }
              }}
            >
              <For each={layers()}>
                {(layer) => (
                  <option value={layer.id}>
                    {layer.name}
                    {layer.hidden ? " (hidden)" : ""}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Button small variant="danger" disabled={busy()} onClick={remove}>
            Delete
          </Button>
        </div>
      </Show>
      <div {...sx(b.navigation)} role="group" aria-label="Board navigation">
        <button
          type="button"
          {...sx(b.control)}
          aria-label="Zoom out"
          title="Zoom out (−)"
          disabled={camera().zoom <= 0.1}
          onClick={() => changeZoom(camera().zoom / 1.2)}
        >
          −
        </button>
        <button
          type="button"
          {...sx(b.control, b.zoomValue)}
          aria-label="Reset zoom to 100%"
          title="Reset zoom (0)"
          onClick={() => changeZoom(1)}
        >
          {Math.round(camera().zoom * 100)}%
        </button>
        <button
          type="button"
          {...sx(b.control)}
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={camera().zoom >= 4}
          onClick={() => changeZoom(camera().zoom * 1.2)}
        >
          +
        </button>
        <button type="button" {...sx(b.control)} onClick={fit} title="Fit board (1)">
          Fit
        </button>
      </div>
      <p id="board-help" {...sx(b.help)}>
        Pinch or Ctrl/⌘ + scroll to zoom · Drag empty space to pan · Double-click text to edit
      </p>
      <Show when={pendingFocus()}>
        {(focus) => (
          <div {...sx(b.focusPrompt)} role="status">
            <span>{focus().from} is pointing here</span>
            <Button small onClick={() => goToFocus(focus().rect)}>
              Go
            </Button>
            <Button small variant="ghost" onClick={() => setPendingFocus(null)}>
              Dismiss
            </Button>
          </div>
        )}
      </Show>
      <div {...sx(b.toolbar)} role="group" aria-label="Board tools">
        <Show
          when={props.isDm}
          fallback={
            <button
              type="button"
              {...sx(b.control, followDm() && b.activeControl)}
              aria-pressed={followDm() ? "true" : "false"}
              onClick={toggleFollowDm}
            >
              Follow DM
            </button>
          }
        >
          <Button small disabled={!isLiveScene()} onClick={() => sendFocus()}>
            Look here
          </Button>
          <Show when={selectionBounds()}>
            {(rect) => (
              <Button
                small
                disabled={!isLiveScene() || !!(current() && layerFor(current()!).hidden)}
                onClick={() =>
                  sendFocus({
                    x: rect().x - 40,
                    y: rect().y - 40,
                    width: rect().width + 80,
                    height: rect().height + 80,
                  })
                }
              >
                Look at selection
              </Button>
            )}
          </Show>
        </Show>
        <Show when={props.isDm}>
          <Button
            small
            disabled={busy()}
            onClick={() => {
              finishText();
              setEditing(!editing());
              setTool("select");
              setSelected(null);
            }}
          >
            {editing() ? "View board" : "Edit board"}
          </Button>
          <Show when={editing()}>
            <button
              type="button"
              {...sx(b.control, tool() === "select" && b.activeControl)}
              aria-pressed={tool() === "select" ? "true" : "false"}
              title="Select (V)"
              onClick={() => setTool("select")}
            >
              Select
            </button>
            <button
              type="button"
              {...sx(b.control, tool() === "hand" && b.activeControl)}
              aria-pressed={tool() === "hand" ? "true" : "false"}
              title="Hand (H), or hold Space"
              onClick={() => setTool("hand")}
            >
              Hand
            </button>
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
              disabled={
                busy() || selectedLayer().locked || document().elements.length >= MAX_BOARD_ELEMENTS
              }
              onClick={() => chooseImage("element")}
            >
              Add image
            </Button>
            <Button
              small
              disabled={
                busy() || selectedLayer().locked || document().elements.length >= MAX_BOARD_ELEMENTS
              }
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
          </Show>
        </Show>
      </div>
      <Show when={props.isDm}>
        <div {...sx(b.sharing)}>
          <Show when={editing()}>
            <label {...sx(styles.row, b.status)}>
              <input
                type="checkbox"
                checked={live()}
                disabled={busy() || !isLiveScene()}
                onChange={(event) => setLive(event.currentTarget.checked)}
              />
              Live sharing{!isLiveScene() ? " (paused in prep)" : ""}
            </label>
            <Button
              small
              variant="primary"
              disabled={busy() || interacting() || (!dirty() && !textEdit())}
              onClick={() => {
                finishText();
                queueMicrotask(() => void publish());
              }}
            >
              {isLiveScene() ? "Publish" : "Save privately"}
            </Button>
            <Show when={dirty()}>
              <Button
                small
                disabled={busy()}
                onClick={() =>
                  void openScene(() => api.getScene(props.worldId, sceneId())).catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "Could not load scene"),
                  )
                }
              >
                Discard draft
              </Button>
            </Show>
          </Show>
          <span {...sx(b.status)} role="status">
            {busy()
              ? "Saving…"
              : dirty()
                ? live() && isLiveScene()
                  ? "Sharing…"
                  : "Unpublished changes"
                : !isLiveScene()
                  ? "Private scene"
                  : live()
                    ? "Live sharing"
                    : "Shared board"}
          </span>
          <Show
            when={
              dirty() &&
              Math.max(
                published().revision,
                props.sceneList.scenes.find((scene) => scene.id === sceneId())?.revision ?? 0,
              ) > revision()
            }
          >
            <span {...sx(b.status)}>
              A newer board was published. Discard this draft to load it.
            </span>
          </Show>
          <ErrorBanner message={error()} />
        </div>
      </Show>
    </section>
  );
}
