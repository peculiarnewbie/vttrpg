import * as Schema from "effect/Schema";
import { ClientFrame, ServerFrame, type ClientFrame as ClientFrameType } from "../domain/schemas";
import type { IndexRow } from "../domain/compendium-index";
import type { SearchRequest } from "./search";

export type RealtimeStatus = "connecting" | "open" | "closed";

export type RealtimeHandlers = {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: RealtimeStatus) => void;
};

export type RealtimeController = {
  send: (frame: ClientFrameType) => void;
  close: () => void;
  /**
   * Search the compendium: sends a `search` frame with a fresh requestId and
   * resolves with the matching `search.result`. Rejects on an `error` frame
   * with that requestId, after 5 s, or if the socket isn't open or closes.
   * Replies are also passed to `onFrame` like any frame.
   */
  search: SearchRequest;
};

export function connectWorld(worldId: string, handlers: RealtimeHandlers): RealtimeController {
  let socket: WebSocket | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  let counter = 0;
  const pending = new Map<
    string,
    {
      resolve: (rows: readonly IndexRow[]) => void;
      reject: (cause: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // Frames sent while (re)connecting go out once the socket opens: a roll clicked
  // as the page loads isn't lost. Searches wait too, until their timeout.
  const queued: { payload: string; requestId?: string }[] = [];
  const QUEUE_LIMIT = 50;
  const transmit = (payload: string, requestId?: string) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    else {
      queued.push({ payload, requestId });
      if (queued.length > QUEUE_LIMIT) queued.shift();
    }
  };
  const unqueue = (requestId: string) => {
    const index = queued.findIndex((item) => item.requestId === requestId);
    if (index >= 0) queued.splice(index, 1);
  };
  const rejectPending = () => {
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer);
      unqueue(requestId);
      request.reject(new Error("WebSocket closed"));
    }
    pending.clear();
  };

  const open = () => {
    if (closed) return;
    handlers.onStatus("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const currentSocket = new WebSocket(`${protocol}//${location.host}/api/worlds/${worldId}/ws`);
    socket = currentSocket;

    currentSocket.onopen = () => {
      handlers.onStatus("open");
      for (const item of queued.splice(0)) currentSocket.send(item.payload);
    };
    currentSocket.onclose = () => {
      rejectPending();
      handlers.onStatus("closed");
      if (!closed) retry = setTimeout(open, 1500);
    };
    currentSocket.onerror = () => currentSocket.close();
    currentSocket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
        const decoded = Schema.decodeUnknownResult(ServerFrame)(parsed);
        if (decoded._tag === "Success") {
          const frame = decoded.success;
          if (frame.type === "search.result" || (frame.type === "error" && frame.requestId)) {
            const id = frame.requestId;
            const request = id === undefined ? undefined : pending.get(id);
            if (request && id !== undefined) {
              clearTimeout(request.timer);
              pending.delete(id);
              if (frame.type === "search.result") request.resolve(frame.results);
              else request.reject(new Error(frame.message));
            }
          }
          handlers.onFrame(frame);
        }
      } catch {
        // ignore malformed frames
      }
    };
  };

  open();

  return {
    send: (input) => {
      const decoded = Schema.decodeUnknownResult(ClientFrame)(input);
      if (decoded._tag === "Failure") return;
      const frame = decoded.success;
      // Cursor moves and pings are stale by the time a socket opens.
      if (frame.type === "cursor" || frame.type === "ping") {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      } else if (!closed) transmit(JSON.stringify(frame));
    },
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      rejectPending();
      queued.length = 0;
      socket?.close();
    },
    search: (query) => {
      if (closed) return Promise.reject(new Error("WebSocket is closed"));
      const requestId = `s${++counter}`;
      const decoded = Schema.decodeUnknownResult(ClientFrame)({
        type: "search",
        ...query,
        requestId,
      });
      if (decoded._tag === "Failure") return Promise.reject(new Error("Invalid search query"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          unqueue(requestId);
          reject(new Error("Search timed out"));
        }, 5000);
        pending.set(requestId, { resolve, reject, timer });
        try {
          transmit(JSON.stringify(decoded.success), requestId);
        } catch (cause) {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(cause);
        }
      });
    },
  };
}
