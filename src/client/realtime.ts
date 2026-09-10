import * as Schema from "effect/Schema";
import { ClientFrame, ServerFrame, type ClientFrame as ClientFrameType } from "../domain/schemas";

export type RealtimeStatus = "connecting" | "open" | "closed";

export type RealtimeHandlers = {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: RealtimeStatus) => void;
};

export type RealtimeController = {
  send: (frame: ClientFrameType) => void;
  close: () => void;
};

export function connectWorld(worldId: string, handlers: RealtimeHandlers): RealtimeController {
  let socket: WebSocket | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    handlers.onStatus("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/worlds/${worldId}/ws`);

    socket.onopen = () => handlers.onStatus("open");
    socket.onclose = () => {
      handlers.onStatus("closed");
      if (!closed) retry = setTimeout(open, 1500);
    };
    socket.onerror = () => socket?.close();
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
        const decoded = Schema.decodeUnknownResult(ServerFrame)(parsed);
        if (decoded._tag === "Success") handlers.onFrame(decoded.success);
      } catch {
        // ignore malformed frames
      }
    };
  };

  open();

  return {
    send: (frame) => {
      const decoded = Schema.decodeUnknownResult(ClientFrame)(frame);
      if (decoded._tag === "Failure") return;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(decoded.success));
    },
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    },
  };
}
