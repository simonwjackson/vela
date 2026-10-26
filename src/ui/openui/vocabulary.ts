/**
 * Signal as an OpenUI language: every part the co-driver may compose a screen from, with its
 * props and what it is for. Dev-only spike (see README.md here).
 *
 * Schemas only (`component: null`): render.ts binds each name to Vela's real Signal parts. The
 * descriptions are the model's prompt, so they say what a part is for, not how it looks.
 *
 * Positional order matters: OpenUI Lang maps arguments to props in the key order of each
 * `z.object`. Changing the order changes the language.
 *
 * Rules the schema itself keeps:
 * - No prop sets colour, size, font, spacing or position. Only semantic props (`tone`, `kind`)
 *   where Signal already has them.
 * - Live values are bound by key (`Hero("nav.next")`, `Fact("Arrive", "trip.eta")`), never typed.
 *   Keys are enums, so a typo is a schema error and the prompt lists every key that exists.
 */
import { createLibrary, defineAction, defineComponent } from "@openuidev/lang-core";
import { z } from "zod";

// ---- Keys: the live data a part can bind to -------------------------------------------------------

/** Values with a large figure: what a Hero can show. */
export const HERO_KEYS = ["nav.next", "trip.left", "trip.distance", "car.range", "playback.left", "trip.driven", "trip.time"] as const;
/** Every value a Fact can show. */
export const VALUE_KEYS = [
  ...HERO_KEYS,
  "trip.eta",
  "next.road",
  "next.distance",
  "weather.now",
  "weather.next",
  "playback.title",
  "trip.avg",
  "trip.stops",
  "dest.name",
  "clock",
] as const;
export const PLACE_KEYS = ["suggest.0", "suggest.1", "suggest.2", "dest"] as const;
export const MEDIA_KEYS = ["media.next", "media.now"] as const;
export type HeroKey = (typeof HERO_KEYS)[number];
export type ValueKey = (typeof VALUE_KEYS)[number];
export type PlaceKey = (typeof PLACE_KEYS)[number];
export type MediaKey = (typeof MEDIA_KEYS)[number];

/** Glyphs by name: a subset of core/icons.ts `glyph` (render.ts checks they exist). */
export const GLYPHS = [
  "search", "home", "work", "recent", "flag", "nosignal", "locate", "pin", "alert", "check", "chevron", "plus",
  "music", "podcast", "book", "fuel", "food", "rest", "bubble", "trip", "compass", "reroute", "download", "retry", "sound", "bell",
] as const;
const glyphName = z.enum(GLYPHS);

// ---- Actions: map onto the app contract (stubs in the spike page) --------------------------------

export const ToCoDriver = defineAction({
  name: "ToCoDriver",
  description: "Say this to the co-driver as if the driver said it, for example @ToCoDriver(\"Read the next chapter\").",
  params: z.object({ text: z.string() }),
});
export const StartRoute = defineAction({
  name: "StartRoute",
  description: "Start a route to a bound place (a PLACE key).",
  params: z.object({ place: z.enum(PLACE_KEYS) }),
});
export const AddStop = defineAction({
  name: "AddStop",
  description: "Add a bound place (a PLACE key) as a stop on the way.",
  params: z.object({ place: z.enum(PLACE_KEYS) }),
});
export const Play = defineAction({
  name: "Play",
  description: "Play a bound item (a MEDIA key) now.",
  params: z.object({ item: z.enum(MEDIA_KEYS) }),
});
export const OpenSheet = defineAction({
  name: "OpenSheet",
  description: "Open one of Vela's sheets: route (the stops), library (Music, Podcasts, Books) or where (search a destination).",
  params: z.object({ sheet: z.enum(["route", "library", "where"]) }),
});
export const ACTIONS = [ToCoDriver, StartRoute, AddStop, Play, OpenSheet] as const;
const action = z.union([ToCoDriver.ref, StartRoute.ref, AddStop.ref, Play.ref, OpenSheet.ref]);

// ---- Small parts -----------------------------------------------------------------------------------

export const Button = defineComponent({
  name: "Button",
  description:
    "A 56 px button. kind primary is the one main action of its surface (at most one per surface); secondary (default) is a plain choice; quiet is a dismiss or a minor choice. Labels say exactly what happens, in 1 to 3 words.",
  props: z.object({ label: z.string(), action, kind: z.enum(["primary", "secondary", "quiet"]).optional() }),
  component: null,
});

export const Actions = defineComponent({
  name: "Actions",
  description: "A row of 1 to 3 Buttons, at the end of a card or under a Quiet answer.",
  props: z.object({ buttons: z.array(Button.ref) }),
  component: null,
});

export const Chip = defineComponent({
  name: "Chip",
  description:
    "A status chip in the top row, for news the screen's answer does not already say. tone warn only when an answer is less reliable (no signal, GPS lost). Use it only as Screen's chip.",
  props: z.object({ text: z.string(), glyph: glyphName.optional(), tone: z.enum(["default", "warn"]).optional() }),
  component: null,
});

export const Text = defineComponent({
  name: "Text",
  description: "One or two plain sentences inside a card. tone muted for secondary detail.",
  props: z.object({ text: z.string(), tone: z.enum(["default", "muted"]).optional() }),
  component: null,
});

export const Fact = defineComponent({
  name: "Fact",
  description: 'One label and its live value, for example Fact("Arrive", "trip.eta"). The value is bound by key, never written.',
  props: z.object({ label: z.string(), value: z.enum(VALUE_KEYS) }),
  component: null,
});

export const Facts = defineComponent({
  name: "Facts",
  description: "One line of 1 to 4 Facts that wraps when narrow. For summaries and side details.",
  props: z.object({ items: z.array(Fact.ref) }),
  component: null,
});

export const Notice = defineComponent({
  name: "Notice",
  description:
    "A glyph, a short title and an optional sub line: news, a warning about the road, or a problem with its fix. Never coloured; the glyph carries it.",
  props: z.object({ title: z.string(), sub: z.string().optional(), glyph: glyphName.optional() }),
  component: null,
});

export const ListRow = defineComponent({
  name: "ListRow",
  description: "A list row with your own words: title, optional sub line and glyph, and an optional action for a tap.",
  props: z.object({ title: z.string(), sub: z.string().optional(), glyph: glyphName.optional(), action: action.optional() }),
  component: null,
});

export const PlaceRow = defineComponent({
  name: "PlaceRow",
  description: "A bound place (name, address, how far ahead, live). The tap runs action, for example @AddStop(\"suggest.0\").",
  props: z.object({ place: z.enum(PLACE_KEYS), action: action.optional() }),
  component: null,
});

export const MediaRow = defineComponent({
  name: "MediaRow",
  description: "A bound episode, album or book (cover, title, show, length). The tap runs action, for example @Play(\"media.next\").",
  props: z.object({ item: z.enum(MEDIA_KEYS), action: action.optional() }),
  component: null,
});

export const List = defineComponent({
  name: "List",
  description: "1 to 4 rows, no dividers. More rows than fit scroll, with the cut-off row showing.",
  props: z.object({ rows: z.array(z.union([PlaceRow.ref, MediaRow.ref, ListRow.ref])) }),
  component: null,
});

const inCard = z.union([Text.ref, Facts.ref, Notice.ref, List.ref, Actions.ref]);

// ---- Answer parts (Stage primary) ------------------------------------------------------------------

export const Hero = defineComponent({
  name: "Hero",
  description:
    'The answer: one large live figure, the memorable thing on the screen, with a road line under it. "nav.next" is the next turn exactly as Vela answers it while guiding (distance and road, "Now", or the time left on a long leg, or "Arrived"). The other keys show their value large, with line as the words under it (for example Hero("car.range", "to empty")); line is ignored for "nav.next".',
  props: z.object({ value: z.enum(HERO_KEYS), line: z.string().optional() }),
  component: null,
});

export const Quiet = defineComponent({
  name: "Quiet",
  description:
    "A quiet answer: a glyph and one short sentence at road size in grey, with an optional sub line and Actions. For a screen whose answer is words, not a number. tone warn only when guidance is less reliable.",
  props: z.object({ text: z.string(), sub: z.string().optional(), glyph: glyphName.optional(), tone: z.enum(["default", "warn"]).optional(), actions: z.optional(Actions.ref) }),
  component: null,
});

export const NowPlaying = defineComponent({
  name: "NowPlaying",
  description: "What plays, large (the stage): cover, title, show, position and keys. Bound to playback. Only as Stage primary, and only with no route.",
  props: z.object({}),
  component: null,
});

export const Shelf = defineComponent({
  name: "Shelf",
  description:
    "The last item from Music, Podcasts and Books, one tap to resume each. Bound. Its form follows its place: large rows as Stage primary, a card as secondary, a row with Talk as base.",
  props: z.object({}),
  component: null,
});

// ---- Card parts (Stage secondary) ------------------------------------------------------------------

export const Listening = defineComponent({
  name: "Listening",
  description: "The listening card: cover, title, by-line, position and keys of what plays. Bound to playback. The default card while driving.",
  props: z.object({}),
  component: null,
});

export const WhereTo = defineComponent({
  name: "WhereTo",
  description: "The Where to? field with up to 3 saved and recent places. Bound. The card for a screen with no route.",
  props: z.object({}),
  component: null,
});

export const CoDriver = defineComponent({
  name: "CoDriver",
  description:
    "The co-driver card: the co-driver speaking to the driver. With no text it shows the live conversation (listening, thinking, speaking). With text it is your own message: 1 or 2 short sentences, with an optional Actions row.",
  props: z.object({ text: z.string().optional(), actions: z.optional(Actions.ref) }),
  component: null,
});

export const Card = defineComponent({
  name: "Card",
  description: "A card for what no other part says: an optional title, then 1 to 3 of Text, Facts, Notice, List and Actions, in that order of use.",
  props: z.object({ children: z.array(inCard), title: z.string().optional() }),
  component: null,
});

export const Sheet = defineComponent({
  name: "Sheet",
  description: "A sheet: the card slot grown to full height, beside a still readable answer. route: the stops and destination, with Add stop and End route. Only as Stage secondary.",
  props: z.object({ kind: z.enum(["route"]) }),
  component: null,
});

// ---- Base parts (Stage base) -----------------------------------------------------------------------

export const TripRow = defineComponent({
  name: "TripRow",
  description: "The trip row: time left, the progress bar with stops, the arrival time. Bound. The base of every screen on a route.",
  props: z.object({}),
  component: null,
});

// ---- Layout primitives -----------------------------------------------------------------------------

const block = z.union([Hero.ref, Quiet.ref, NowPlaying.ref, Shelf.ref, Listening.ref, WhereTo.ref, CoDriver.ref, Card.ref, Notice.ref, Facts.ref]);

export const Stack = defineComponent({
  name: "Stack",
  description: "2 or 3 parts in one slot, top to bottom, with Signal's spacing. For example a Hero with a Facts line under it, or a Card above Listening.",
  props: z.object({ children: z.array(block) }),
  component: null,
});

export const Split = defineComponent({
  name: "Split",
  description: "Two parts that share one slot: side by side when the slot is wide enough for both, else one above the other. The first one leads.",
  props: z.object({ first: block, second: block }),
  component: null,
});

export const Row = defineComponent({
  name: "Row",
  description: "Small parts side by side in a card (Facts, Actions, Notice), wrapping onto more lines when narrow.",
  props: z.object({ children: z.array(z.union([Facts.ref, Notice.ref, Actions.ref, Text.ref])) }),
  component: null,
});

const slot = z.union([block, Stack.ref, Split.ref]);

export const Stage = defineComponent({
  name: "Stage",
  description:
    "The screen's three parts. primary is the answer (Hero, Quiet, NowPlaying or Shelf, alone or in a Stack). secondary is the card slot beside it (Listening, WhereTo, CoDriver, Card, Shelf or Sheet; two only in a Split or Stack). base is the row under both (TripRow or Shelf); without it the base row holds Talk alone. Vela lays them out from the screen's size: side by side on a wide screen, stacked on a tall one.",
  props: z.object({ primary: slot, secondary: z.union([slot, Sheet.ref]).optional(), base: z.union([TripRow.ref, Shelf.ref]).optional() }),
  component: null,
});

export const Screen = defineComponent({
  name: "Screen",
  description:
    "The root: one Stage, and an optional Chip in the top row. Vela always adds the clock, the settings button and Talk (at the trailing end of the base row). Never draw them.",
  props: z.object({ stage: Stage.ref, chip: z.optional(Chip.ref) }),
  component: null,
});

/** Every component, root first. render.ts binds exactly one renderer to each. */
export const COMPONENTS = [
  Screen, Stage, Stack, Split, Row,
  Hero, Quiet, NowPlaying, Shelf,
  Listening, WhereTo, CoDriver, Card, Sheet, TripRow,
  Text, Facts, Fact, Notice, List, ListRow, PlaceRow, MediaRow, Chip, Button, Actions,
] as const;
export type ComponentName = (typeof COMPONENTS)[number]["name"];
export const ROOT = "Screen";

export const library = createLibrary({
  components: [...COMPONENTS],
  actions: [...ACTIONS],
  root: ROOT,
  componentGroups: [
    { name: "Screen and layout", components: ["Screen", "Stage", "Stack", "Split", "Row"] },
    { name: "Answers (Stage primary)", components: ["Hero", "Quiet", "NowPlaying", "Shelf"] },
    { name: "Cards (Stage secondary)", components: ["Listening", "WhereTo", "CoDriver", "Card", "Sheet"] },
    { name: "Base (Stage base)", components: ["TripRow"] },
    { name: "Inside cards", components: ["Text", "Facts", "Fact", "Notice", "List", "ListRow", "PlaceRow", "MediaRow", "Actions", "Button", "Chip"] },
  ],
});
