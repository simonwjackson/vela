import { createComicsClient } from "./ossicle-comics";
import { OssicleRpcError } from "./ossicle-rpc";

test.each([502, 503])("Books names an unreachable upstream on HTTP %i", async (status) => {
  const comics = createComicsClient({ origin: "https://ossicle.test", fetch: async () => new Response(null, { status }) });
  await expect(comics.booksList()).rejects.toMatchObject({ message: "Books server unreachable", retryable: true });
});

test("Books names an unreachable server on a network failure", async () => {
  const comics = createComicsClient({ origin: "https://ossicle.test", fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await expect(comics.booksList()).rejects.toMatchObject({ message: "Books server unreachable", retryable: true });
});

test("Books keeps request failures distinct from unreachable upstreams", async () => {
  const comics = createComicsClient({ origin: "https://ossicle.test", fetch: async () => new Response(null, { status: 400 }) });
  await expect(comics.booksList()).rejects.toBeInstanceOf(OssicleRpcError);
  await expect(comics.booksList()).rejects.toMatchObject({ retryable: false, message: "The books server answered HTTP 400" });
});

test("Books uses the current Ossicle proxy envelope for its library", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const publication = { id: "book-1", generation: "g1", title: "A Book", authors: ["An Author"] };
  const comics = createComicsClient({
    origin: "https://ossicle.test",
    fetch: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ _tag: "books.list", outcome: { status: "ready", value: { publications: [publication] } } });
    },
  });
  expect(await comics.booksList()).toEqual([publication]);
  expect(requests).toEqual([{ url: "https://ossicle.test/comics/rpc", body: { _tag: "books.list", payload: {} } }]);
  expect(comics.url("/narration/window.ogg")).toBe("https://ossicle.test/comics/narration/window.ogg");
});
