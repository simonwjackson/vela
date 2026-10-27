import type { MomentShow, SurfaceUp } from "../contract";
import { createMomentChannel } from "./channel";
const show: MomentShow = { type: "moment.show", id: "moment-1", program: 'root = Screen([])', say: "Rain ahead", when: "after-turn", until: { seconds: 60 }, chip: "Rain ahead", cause: { event: "rain-1" } };
test("received Moments reach UI, problems and dismissals return over the same channel", () => {
  const sent: SurfaceUp[] = []; const channel = createMomentChannel((m) => { sent.push(m); return true; });
  let updates = 0; channel.moments.subscribe(() => { updates++; });
  channel.receive(show); expect(channel.moments.current).toEqual(show);
  channel.moments.problems(show.id, []); channel.moments.dismiss("other", "tap"); expect(channel.moments.current).toEqual(show);
  channel.moments.dismiss(show.id, "voice"); expect(channel.moments.current).toBeUndefined();
  expect(sent).toEqual([{ type: "moment.problems", id: show.id, problems: [] }, { type: "moment.dismissed", id: show.id, by: "voice" }]);
  channel.receive(show); channel.receive({ type: "moment.dismiss", id: show.id }); expect(channel.moments.current).toBeUndefined(); expect(updates).toBe(4);
});
test("untrusted transport data is refused", () => {
  const sent: SurfaceUp[] = []; const channel = createMomentChannel((m) => { sent.push(m); return true; });
  channel.receive({ ...show, until: { seconds: -1 } }); expect(channel.moments.current).toBeUndefined();
  expect(sent[0]?.type).toBe("moment.problems");
});
