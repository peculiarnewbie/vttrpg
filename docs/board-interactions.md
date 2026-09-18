# Board interaction reference

The board's navigation, selection handles, and inline text editing were reviewed
against Excalidraw commit `c0ad61c6743aef7623e641cd1460d757cc6cacf3`.
This is a behavioral reference; the renderer remains Solid and the saved board
schema remains compatible with existing worlds.

Relevant source:

- [Wheel handling](https://github.com/excalidraw/excalidraw/blob/c0ad61c6743aef7623e641cd1460d757cc6cacf3/packages/excalidraw/components/App.wheel.ts): wheel panning and cursor-anchored modifier/trackpad zoom.
- [Pointer and touch handling](https://github.com/excalidraw/excalidraw/blob/c0ad61c6743aef7623e641cd1460d757cc6cacf3/packages/excalidraw/components/App.tsx): track multiple pointers, separate gestures from taps, and use the midpoint and distance between fingers for navigation.
- [Transform handles](https://github.com/excalidraw/excalidraw/blob/c0ad61c6743aef7623e641cd1460d757cc6cacf3/packages/element/src/transformHandles.ts): handle geometry accounts for zoom and touch targets are larger than mouse targets.
- [Text editing](https://github.com/excalidraw/excalidraw/blob/c0ad61c6743aef7623e641cd1460d757cc6cacf3/packages/excalidraw/wysiwyg/textWysiwyg.tsx): a textarea positioned on the element, entered deliberately rather than opening a form on selection.

A reference checkout is available locally at `/home/bolt/git/refs/excalidraw`.
To create one on another machine, run this outside the app repository:

```bash
git clone --depth 1 https://github.com/excalidraw/excalidraw.git excalidraw-reference
```

## Interaction checks

- Selecting and dragging on desktop or touch never opens a text input.
- Corners and edges resize directly. Image corners preserve the image ratio;
  geometry stays within the board's publishable size and coordinate bounds.
- Resize targets stay the same screen size as the camera zooms.
- Touch movement has a drag threshold. A completed drag cannot become a double tap.
- A second pointer cancels uncommitted element movement and starts pinch/pan.
  Lifting one finger continues navigation; it cannot turn into an element drag.
- Pointer cancellation, lost capture, Escape, and window blur cancel pending
  element transforms without adding undo entries.
- Inline text uses native text selection, multiline input, clipboard, and undo.
  Escape discards the edit; blur and Ctrl/Cmd+Enter commit it exactly once.
- Live sharing waits until a move, resize, or text edit completes. Viewers can
  navigate without changing the published scene.

`src/client/board-geometry.test.ts` covers all resize directions, anchor/ratio
preservation, storage limits, and pinch anchors. Also verify the pointer and focus
sequences above in a real browser, including a touch context and both themes.

This board supports images and text cards; it does not implement Excalidraw's
drawing tools, multi-selection, rotation, or file format.
