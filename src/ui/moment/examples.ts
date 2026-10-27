/**
 * The Moment programs Vela sends as `moment.capabilities.examples`: the five approved states (Vela's
 * own screen, whole, as Frame programs) and three deliberately different composed shapes. Plain
 * strings, so the app and the build import them without the vocabulary. The tests gate each one.
 */

/** The five approved states, by the dev scenario each is drawn on. */
export const APPROVED_EXAMPLES: readonly (readonly [scenario: string, program: string])[] = [
  ["near", `root = Screen([frame])
frame = Frame(Hero("nav.next"), Listening(), TripRow())`],
  ["far", `root = Screen([frame])
frame = Frame(Hero("trip.left"), Listening(), TripRow())`],
  ["noroute", `root = Screen([frame])
frame = Frame(NowPlaying(), WhereTo(), Shelf())`],
  ["speaking", `root = Screen([frame])
frame = Frame(Hero("nav.next"), CoDriver(), TripRow())`],
  ["stops", `root = Screen([frame])
frame = Frame(Hero("nav.next"), Sheet("route"), TripRow())`],
];

/**
 * Three composed shapes: a figure Lead with a bar and an action (Range short of the destination,
 * after the turn); a summary with Details on arrival; a Sequence of the stops ahead on a long leg.
 */
export const COMPOSED_EXAMPLES: readonly (readonly [situation: string, program: string])[] = [
  [
    "range-short",
    `root = Screen([lead, short, act, trip])
lead = Lead(Stack([Row([Glyph("fuel"), Value("car.range")]), Label("fuel range")]))
short = Optional(Row([Bar("range"), Fact("Short by", "range.short")]))
act = Actions([Button("Find fuel", @FindStop("fuel"), "primary"), Button("Not now", @Dismiss(), "quiet")])
trip = TripRow()`,
  ],
  [
    "arrived",
    `root = Screen([lead, totals, car])
lead = Lead(Row([Glyph("flag"), Value("trip.driven"), Label("driven")]))
totals = Facts([Fact("Average", "trip.avg")])
car = Details("Car", [Facts([Fact("Fuel", "car.fuel"), Fact("Range", "car.range")])])`,
  ],
  [
    "long-leg",
    `root = Screen([lead, ahead, trip])
lead = Lead(Row([Glyph("pin"), Value("stops.left"), Label("on the way")]))
ahead = Sequence("route.stops")
trip = TripRow()`,
  ],
];

/** The 8 examples, approved first. */
export const MOMENT_EXAMPLES: readonly string[] = [...APPROVED_EXAMPLES.map(([, p]) => p), ...COMPOSED_EXAMPLES.map(([, p]) => p)];
