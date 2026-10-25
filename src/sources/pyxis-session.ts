/**
 * The car's local projection of its Pyxis session: the state the core will reach after a
 * command, computed before the core answers. It lets Music keep playing (and keep a correct
 * queue cursor) in a dead zone; when the report reaches the core, the core's returned session
 * replaces the projection.
 *
 * The rules mirror Pyxis's own device projection (pyxis clients/app/src/worker/session-local.ts
 * `applySessionCommand`) for the commands the car issues. Shuffle reordering is not
 * projected: `queue` is already in effective order, and the core reorders additions.
 */
import type { PyxisSession, PyxisSessionCommand } from "./pyxis-rpc";

export class SessionCommandRefused extends Error {
  override name = "SessionCommandRefused";
}

export function applySessionCommand(session: PyxisSession, command: PyxisSessionCommand): PyxisSession {
  let queue = [...session.queue];
  let order = [...(session.queueOrder ?? session.queue.map((_, index) => index))];
  let cursor = session.cursor;
  let transport = session.transport;
  let positionMs = session.positionMs;
  let durationMs = session.durationMs;
  let volume = session.volume;
  let repeat = session.repeat;
  let shuffle = session.shuffle;

  switch (command._tag) {
    case "queue.add": {
      const start = order.length === 0 ? 0 : Math.max(...order) + 1;
      for (const [index, track] of command.payload.trackIds.entries()) {
        queue.push(track);
        order.push(start + index);
      }
      if (cursor === undefined && queue.length > 0) cursor = 0;
      break;
    }
    case "queue.remove": {
      const { index } = command.payload;
      if (index < 0 || index >= queue.length) throw new SessionCommandRefused("queue index is outside the queue");
      const wasCurrent = cursor === index;
      queue.splice(index, 1);
      order.splice(index, 1);
      if (queue.length === 0) cursor = undefined;
      else if (cursor !== undefined && index < cursor) cursor -= 1;
      else if (cursor !== undefined && cursor >= queue.length) cursor = queue.length - 1;
      if (wasCurrent) {
        transport = "stopped";
        positionMs = 0;
        durationMs = undefined;
      }
      break;
    }
    case "queue.clear":
      queue = [];
      order = [];
      cursor = undefined;
      transport = "stopped";
      positionMs = 0;
      durationMs = undefined;
      break;
    case "repeat.set":
      repeat = command.payload.mode;
      break;
    case "shuffle.set":
      shuffle = command.payload.enabled;
      break;
    case "cursor.jump":
      if (command.payload.index < 0 || command.payload.index >= queue.length) {
        throw new SessionCommandRefused("queue index is outside the queue");
      }
      cursor = command.payload.index;
      transport = "stopped";
      positionMs = 0;
      durationMs = undefined;
      break;
    case "transport.seek":
      if (
        session.currentTrackId === undefined ||
        durationMs === undefined ||
        durationMs <= 0 ||
        command.payload.positionMs < 0 ||
        command.payload.positionMs > durationMs
      ) {
        throw new SessionCommandRefused("seek requires a known track, duration and bounded position");
      }
      positionMs = command.payload.positionMs;
      break;
    case "transport.play":
      if (queue.length === 0) throw new SessionCommandRefused("cannot play an empty queue");
      if (transport === "ended") positionMs = 0;
      transport = "playing";
      break;
    case "transport.pause":
      if (transport !== "playing") throw new SessionCommandRefused("cannot pause unless playing");
      transport = "paused";
      break;
    case "transport.stop":
      transport = "stopped";
      positionMs = 0;
      break;
    case "transport.trackEnded": {
      if (transport !== "playing") throw new SessionCommandRefused("cannot end unless playing");
      positionMs = 0;
      const next = cursor === undefined ? undefined : cursor + 1;
      if (repeat === "one") {
        // Replay the same occurrence.
      } else if (next !== undefined && next < queue.length) {
        cursor = next;
        durationMs = undefined;
      } else if (repeat === "all" && queue.length > 0) {
        cursor = 0;
        durationMs = undefined;
      } else {
        transport = "ended";
      }
      break;
    }
    case "position.report":
      positionMs = command.payload.positionMs;
      if (command.payload.durationMs !== undefined) durationMs = command.payload.durationMs;
      break;
    case "volume.set":
      if (command.payload.volume < 0 || command.payload.volume > 100) throw new SessionCommandRefused("volume is outside 0..=100");
      volume = command.payload.volume;
      break;
  }

  const currentTrackId = cursor === undefined ? undefined : queue[cursor];
  const { cursor: _c, currentTrackId: _t, streamPath: _s, durationMs: _d, ...rest } = session;
  return {
    ...rest,
    repeat,
    shuffle,
    queueOrder: order,
    queue,
    ...(cursor === undefined ? {} : { cursor }),
    ...(currentTrackId === undefined ? {} : { currentTrackId, streamPath: `/stream/${currentTrackId}` }),
    transport,
    positionMs,
    ...(durationMs === undefined ? {} : { durationMs }),
    volume,
    revision: session.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
