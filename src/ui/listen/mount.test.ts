import { createListeningFixture, createMemoryStorage, settle } from "../../audio/testing/listening-fixture";
import { createDownloads } from "../../sw/downloads";
import { createMemoryOfflineAudio } from "../../sw/offline-cache";
import { describeNowPlaying, formatTime, mount } from "./mount";

const buttons = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].filter((button) => button.textContent === text);

test("shows Now playing, plays search results, resumes from the Shelf, and unmounts cleanly", async () => {
  const fixture = createListeningFixture();
  const root = document.createElement("div");
  const unmount = mount(root, { listening: fixture.listening });
  expect(root.textContent).toContain("Nothing is playing.");

  const select = root.querySelector("select") as HTMLSelectElement;
  const input = root.querySelector("input[type=search]") as HTMLInputElement;
  select.value = "podcasts";
  input.value = "glass";
  root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(root.textContent).toContain("Gears of Glass — The Quiet Engine");

  buttons(root, "Play")
    .find((button) => button.closest("li") !== null)
    ?.click();
  await settle();
  expect(root.textContent).toContain("Podcasts: Gears of Glass by The Quiet Engine. playing");
  expect(buttons(root, "Forward 30 s")).toHaveLength(1);
  expect(root.textContent).toContain("Podcasts: Gears of Glass — The Quiet Engine Resume");

  buttons(root, "Pause")[0]?.click();
  await settle();
  expect(fixture.elements.podcasts.paused).toBe(true);

  unmount();
  expect(root.children).toHaveLength(0);
  fixture.listening.dispose();
});

test("shows download status and the manual Wi-Fi switch", async () => {
  const fixture = createListeningFixture();
  const downloads = createDownloads({
    origins: { pyxis: fixture.pyxis.origin, ossicle: fixture.ossicle.origin },
    offline: createMemoryOfflineAudio(),
    sources: {
      podcasts: () => fixture.podcasts.offlineCandidates(),
      currentBook: () => undefined,
      narrationAhead: async () => [],
      pinnedTracks: async () => [],
    },
    fetch: fixture.ossicle.fetch,
    pyxisToken: async () => undefined,
    connection: () => undefined,
    storage: createMemoryStorage(),
  });
  const root = document.createElement("div");
  mount(root, { listening: fixture.listening, downloads });
  expect(root.textContent).toContain("Downloads have not run yet.");
  const box = root.querySelector("input[type=checkbox]") as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(root.textContent).toContain("saved for offline"));
  expect(root.textContent).toContain("Podcasts: First Turn of the Crank — saved");
  fixture.listening.dispose();
});

test("formats times and states plainly", () => {
  expect(formatTime(65)).toBe("1:05");
  expect(formatTime(3725)).toBe("1:02:05");
  expect(
    describeNowPlaying({
      item: { source: "books", id: "b", title: "A Book", by: "An Author", durationSec: 600 },
      transport: "paused",
      positionSec: 30,
    }),
  ).toBe("Books: A Book by An Author. paused, 0:30 / 10:00.");
});
