import schema from "./moment-schema.json";
import { buildLibrary } from "../ui/moment/vocabulary";

test("committed Moment schema matches the vocabulary", () => {
  expect(schema).toEqual(buildLibrary().toJSONSchema());
});
