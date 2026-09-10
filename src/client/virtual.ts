import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import { createEffect, createSignal, onCleanup, onSettled, type Accessor } from "solid-js";

type Options = {
  count: Accessor<number>;
  getScrollElement: Accessor<Element | undefined>;
  estimateSize: (index: number) => number;
  overscan?: number;
};

/**
 * Minimal Solid binding for `@tanstack/virtual-core`. The published
 * `@tanstack/solid-virtual` targets Solid 1.x (`solid-js/store`,
 * `createComputed`), which no longer exist in Solid 2.
 */
export function createVirtualizer(options: Options) {
  const [virtualItems, setVirtualItems] = createSignal<VirtualItem[]>([]);
  const [totalSize, setTotalSize] = createSignal(0);

  const buildOptions = (): VirtualizerOptions<Element, Element> => ({
    count: options.count(),
    getScrollElement: () => (options.getScrollElement() as Element | undefined) ?? null,
    estimateSize: options.estimateSize,
    overscan: options.overscan ?? 8,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: (instance) => {
      setVirtualItems(instance.getVirtualItems());
      setTotalSize(instance.getTotalSize());
    },
  });

  const instance = new Virtualizer(buildOptions());

  onSettled(() => {
    const cleanup = instance._didMount();
    instance._willUpdate();
    setVirtualItems(instance.getVirtualItems());
    setTotalSize(instance.getTotalSize());
    onCleanup(cleanup);
  });

  createEffect(
    () => ({ count: options.count(), scroll: options.getScrollElement() }),
    () => {
      instance.setOptions(buildOptions());
      instance._willUpdate();
      setVirtualItems(instance.getVirtualItems());
      setTotalSize(instance.getTotalSize());
    },
  );

  return {
    getVirtualItems: () => virtualItems(),
    getTotalSize: () => totalSize(),
    measureElement: (element: Element | null) => instance.measureElement(element),
    scrollToIndex: (index: number, scrollOptions?: { align?: "start" | "center" | "end" }) =>
      instance.scrollToIndex(index, scrollOptions),
  };
}
