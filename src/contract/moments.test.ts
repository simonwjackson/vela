import { MAX_LIFE_S, MOMENT_RULES, UNTIL_EVENTS } from "./moments";
import { momentCapabilities } from "../moments/capabilities";
import { MAX_LIFE_S as uiMax, UNTIL_EVENTS as uiEvents } from "../ui/moment/keys";
test("capabilities advertise the same detectable events and lifetime the UI enforces", () => {
  const capabilities = momentCapabilities(true);
  expect(uiMax).toBe(MAX_LIFE_S); expect(uiEvents).toBe(UNTIL_EVENTS);
  expect(capabilities.rules.numbers).toBe(MOMENT_RULES);
  expect(capabilities.rules.numbers.maxLifeSeconds).toBe(600);
  expect(capabilities.rules.numbers.untilEvents).toEqual(UNTIL_EVENTS);
  for (const event of UNTIL_EVENTS) expect(capabilities.rules.text).toContain(event);
  expect(capabilities.rules.text).toContain("600 seconds");
});
