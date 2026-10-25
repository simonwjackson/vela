import type { Item } from "../contract";
import { type MediaMetadataFields, type MediaSessionLike, bindMediaSession, positionStateFor } from "./media-session";
import { createListeningFixture, settle } from "./testing/listening-fixture";

/** A real MediaSessionLike that records what Vela set and lets a test press buttons. */
function createRecordingMediaSession() {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  const positions: MediaPositionState[] = [];
  const session: MediaSessionLike & { metadataFields?: MediaMetadataFields } = {
    metadata: null,
    playbackState: "none",
    setActionHandler(action, handler) {
      if (handler === null) handlers.delete(action);
      else handlers.set(action, handler);
    },
    setPositionState(state) {
      if (state !== undefined) positions.push(state);
    },
  };
  const press = (action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) => {
    const handler = handlers.get(action);
    if (handler === undefined) throw new Error(`no handler for ${action}`);
    handler({ action, ...details } as MediaSessionActionDetails);
  };
  return { session, handlers, positions, press };
}

const createMetadata = (fields: MediaMetadataFields) => fields as unknown as MediaMetadata;
const episode: Item = { source: "podcasts", id: "e-4", title: "Gears of Glass", by: "The Quiet Engine" };

test("metadata, playback state and position follow Now playing", async () => {
  const fixture = createListeningFixture();
  const media = createRecordingMediaSession();
  const unbind = bindMediaSession(fixture.listening, media.session, { createMetadata });
  await fixture.listening.send({ type: "playItem", item: episode });
  await settle();
  expect(media.session.metadata).toMatchObject({ title: "Gears of Glass", artist: "The Quiet Engine" });
  expect(media.session.playbackState).toBe("playing");
  expect(media.positions.at(-1)).toMatchObject({ duration: 2400 });

  media.press("pause");
  await settle();
  expect(media.session.playbackState).toBe("paused");
  unbind();
  expect(media.handlers.size).toBe(0);
  fixture.listening.dispose();
});

test("stereo next/previous on a Podcast seek forward 30 s and back 15 s", async () => {
  const fixture = createListeningFixture();
  const media = createRecordingMediaSession();
  bindMediaSession(fixture.listening, media.session, { createMetadata });
  await fixture.listening.send({ type: "playItem", item: episode });
  await settle();
  fixture.elements.podcasts.advance(100);

  media.press("nexttrack");
  await settle();
  expect(fixture.elements.podcasts.currentTime).toBe(130);
  media.press("previoustrack");
  await settle();
  expect(fixture.elements.podcasts.currentTime).toBe(115);
  media.press("seekto", { seekTime: 600 });
  await settle();
  expect(fixture.elements.podcasts.currentTime).toBe(600);
  fixture.listening.dispose();
});

test("stereo next/previous on a Book seek forward 30 s and back 15 s", async () => {
  const fixture = createListeningFixture();
  const media = createRecordingMediaSession();
  bindMediaSession(fixture.listening, media.session, { createMetadata });
  await fixture.listening.send({ type: "playItem", item: { source: "books", id: "b-lantern", title: "", by: "" } });
  await settle();
  fixture.elements.books.advance(20);
  expect(fixture.listening.nowPlaying?.positionSec).toBe(20);
  media.press("nexttrack");
  await settle();
  expect(fixture.listening.nowPlaying?.positionSec).toBe(50);
  media.press("previoustrack");
  await settle();
  expect(fixture.listening.nowPlaying?.positionSec).toBe(35);
  fixture.listening.dispose();
});

test("stereo next/previous on Music change track", async () => {
  const fixture = createListeningFixture();
  const media = createRecordingMediaSession();
  bindMediaSession(fixture.listening, media.session, { createMetadata });
  const [track] = await fixture.listening.search("music", "Gull Waltz");
  if (track === undefined) throw new Error("fixture track missing");
  await fixture.listening.send({ type: "playItem", item: track });
  await settle();
  expect(fixture.listening.nowPlaying?.item.title).toBe("Gull Waltz");

  media.press("nexttrack");
  await settle();
  expect(fixture.listening.nowPlaying?.item.title).toBe("Fog Signal");
  expect(fixture.listening.nowPlaying?.transport).toBe("playing");
  media.press("previoustrack");
  await settle();
  expect(fixture.listening.nowPlaying?.item.title).toBe("Gull Waltz");
  expect(media.session.metadata).toMatchObject({ title: "Gull Waltz", album: "Harbor Lights" });
  fixture.listening.dispose();
});

test("position state is withheld when the duration is unknown", () => {
  expect(
    positionStateFor({ item: { source: "music", id: "x", title: "", by: "" }, transport: "playing", positionSec: 4 }),
  ).toBeUndefined();
  expect(
    positionStateFor({
      item: { source: "music", id: "x", title: "", by: "", durationSec: 10 },
      transport: "playing",
      positionSec: 40,
    }),
  ).toEqual({ duration: 10, playbackRate: 1, position: 10 });
});
