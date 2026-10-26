import { createEndOfTurn } from "./end-of-turn";

const ROAD = 0.01; // steady road noise, about -40 dBFS
const VOICE = 0.1;

function run(levels: readonly number[], before: readonly number[] = Array(30).fill(ROAD)) {
  const eot = createEndOfTurn(before);
  return levels.map((rms) => eot.push(rms, 100));
}

test("ends 1.2 s after speech stops, measured in audio frames", () => {
  const verdicts = run([...Array(15).fill(VOICE), ...Array(12).fill(ROAD)]);
  expect(verdicts.slice(0, 26).every((v) => v === "continue")).toBe(true);
  expect(verdicts[26]).toBe("said");
});

test("short pauses between words do not end the turn", () => {
  const phrase = [...Array(5).fill(VOICE), ...Array(6).fill(ROAD), ...Array(5).fill(VOICE)];
  expect(run([...phrase, ...phrase]).includes("said")).toBe(false);
});

test("nothing said for 5 s ends with nothing said; 30 s ends the turn whatever happens", () => {
  expect(run(Array(50).fill(ROAD)).at(-1)).toBe("nothing-said");
  expect(run(Array(49).fill(ROAD)).at(-1)).toBe("continue");
  const talker = Array.from({ length: 300 }, (_, i) => (i % 5 === 0 ? ROAD : VOICE));
  expect(run(talker).at(-1)).toBe("said");
});
