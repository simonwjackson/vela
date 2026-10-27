/**
 * The Moment vocabulary: Signal as an OpenUI language, the source of truth for the JSON Schema Vela
 * sends in `moment.capabilities` (tools/moment-schema.mjs generates src/contract/moment-schema.json
 * from `buildLibrary()`). Build time and tests only: the app parses with the generated JSON, so zod
 * never enters the browser bundle. Importable in Node without a DOM.
 *
 * A Moment is `Screen(blocks)`: blocks top to bottom with exactly one `Lead`, at most two supporting
 * items, an optional `Details`, then the base row. `NoChange()` keeps Vela's own screen (the chip,
 * when the message has one, still shows). What `say`, `when`, `until` and `chip` carry is in the
 * `moment.show` message, not the program.
 *
 * Schemas only (`component: null`): render.ts binds each name. The descriptions are the model's
 * prompt. Arguments map to props in the key order of each `z.object`. No prop sets colour, size,
 * font, spacing or position; live values are bound by key (enums, so a typo is a schema error).
 */
import { createLibrary, defineAction, defineComponent } from "@openuidev/lang-core";
import { z } from "zod";
import { BAR_KEYS, FACT_KEYS, GLYPHS, HERO_KEYS, NAME_KEYS, ROOT, SEQUENCE_KEYS, SHEETS, SOURCES, STOP_KINDS, TIERS, VALUE_KEYS } from "./keys";

/** Builds the library afresh: each call defines its own schemas (lang-core keys components by them). */
export function buildLibrary() {
  const glyphName = z.enum(GLYPHS);
  const tier = z.enum(TIERS);

  // ---- Actions: each maps onto something the app already does --------------------------------
  const OpenSheet = defineAction({
    name: "OpenSheet",
    description: "Open one of Vela's sheets: route (every stop, Add stop, End route), library (Music, Podcasts, Books), where (search a destination) or add-stop.",
    params: z.object({ sheet: z.enum(SHEETS) }),
  });
  const FindStop = defineAction({
    name: "FindStop",
    description: "Search for a stop of this kind on the way (the Add a stop sheet, searching): fuel, food or rest.",
    params: z.object({ kind: z.enum(STOP_KINDS) }),
  });
  const Resume = defineAction({ name: "Resume", description: "Resume the last item of a Source: music, podcasts or books.", params: z.object({ source: z.enum(SOURCES) }) });
  const ConnectCar = defineAction({ name: "ConnectCar", description: "Connect to the car's OBD adapter (asks the driver once).", params: z.object({}) });
  const Dismiss = defineAction({ name: "Dismiss", description: "Close this Moment now (as the ✕ does), for a quiet Not now.", params: z.object({}) });
  const ACTIONS = [OpenSheet, FindStop, Resume, ConnectCar, Dismiss];
  const action = z.union([OpenSheet.ref, FindStop.ref, Resume.ref, ConnectCar.ref, Dismiss.ref]);

  // ---- Atoms -------------------------------------------------------------------------------------
  const Value = defineComponent({
    name: "Value",
    description:
      'A live figure with its unit, bound by key: Value("car.range") draws "38 km". weather.change.in is the distance to the next forecast change; weather.rain.in, weather.rain.length and weather.rain.at give the distance, length and estimated arrival time of rain. In the Lead it is the screen\'s one large figure; elsewhere tier secondary (road size, the default) or tertiary (body size).',
    props: z.object({ key: z.enum(VALUE_KEYS), tier: tier.optional() }),
    component: null,
  });
  const Name = defineComponent({
    name: "Name",
    description: 'A live name, bound by key: a place, a road, a title or the car\'s fault codes. Name("stop.next") draws "Larch Pharmacy". weather.now and weather.next name the current and next forecast conditions. Tier as Label.',
    props: z.object({ key: z.enum(NAME_KEYS), tier: tier.optional() }),
    component: null,
  });
  const Label = defineComponent({
    name: "Label",
    description:
      'A few of your own words right after a figure whose meaning neither its glyph nor the context gives, for example "fuel range" after Value("car.range"). Never above a figure, never a heading: the glyph is the label. muted draws it one grey tier down.',
    props: z.object({ text: z.string(), tier: tier.optional(), muted: z.boolean().optional() }),
    component: null,
  });
  const Glyph = defineComponent({
    name: "Glyph",
    description: 'A glyph at the size of the line it sits in (in a Row). "next.turn" is the next maneuver\'s arrow, bound.',
    props: z.object({ name: glyphName }),
    component: null,
  });
  const Bar = defineComponent({
    name: "Bar",
    description:
      "A position, always left to right, 2 px, bound: playback (what plays), range (how far the fuel reaches, as a share of the distance left), fuel (the tank's level). The trip has no bar: TripRow says the time left and the arrival.",
    props: z.object({ key: z.enum(BAR_KEYS) }),
    component: null,
  });
  const Sequence = defineComponent({
    name: "Sequence",
    description: "A bound route sequence, left to right on one line: route.stops gives the stops ahead; weather.stretches (also route.weather) gives the forecast stretches in the next 60 km, with each condition and the distance to its start. Weather is unavailable without a current forecast. Labels that do not fit say how many more.",
    props: z.object({ key: z.enum(SEQUENCE_KEYS) }),
    component: null,
  });
  const Art = defineComponent({ name: "Art", description: "The cover of what plays. Large when it is the Lead, small elsewhere.", props: z.object({}), component: null });
  const Divider = defineComponent({
    name: "Divider",
    description: "A hairline between two groups inside a Card, Stack or Columns. Never across the screen, never first or last.",
    props: z.object({}),
    component: null,
  });
  const Button = defineComponent({
    name: "Button",
    description:
      "A 56 px button. kind primary is the one main action of its surface (at most one per surface); secondary (default) is a plain choice; quiet is a dismiss or a minor choice. Labels say exactly what happens, in 1 to 3 words.",
    props: z.object({ label: z.string(), action, kind: z.enum(["primary", "secondary", "quiet"]).optional() }),
    component: null,
  });
  const Actions = defineComponent({ name: "Actions", description: "A row of 1 to 3 Buttons.", props: z.object({ buttons: z.array(Button.ref) }), component: null });
  const Text = defineComponent({
    name: "Text",
    description: "One or two plain sentences, for a reason or a suggestion. muted for secondary detail.",
    props: z.object({ text: z.string(), muted: z.boolean().optional() }),
    component: null,
  });
  const Fact = defineComponent({
    name: "Fact",
    description: 'One label and its live value, inline: Fact("Arrive", "trip.eta").',
    props: z.object({ label: z.string(), value: z.enum(FACT_KEYS) }),
    component: null,
  });
  const Facts = defineComponent({ name: "Facts", description: "One line of 1 to 4 Facts that wraps when narrow.", props: z.object({ items: z.array(Fact.ref) }), component: null });
  const Notice = defineComponent({
    name: "Notice",
    description: "A glyph, a short title and an optional sub line: news or a problem with its fix. Never coloured; the glyph carries it.",
    props: z.object({ title: z.string(), sub: z.string().optional(), glyph: glyphName.optional() }),
    component: null,
  });
  const ListRow = defineComponent({
    name: "ListRow",
    description: "A list row with your own words: title, optional sub line and glyph, and an optional action.",
    props: z.object({ title: z.string(), sub: z.string().optional(), glyph: glyphName.optional(), action: action.optional() }),
    component: null,
  });
  const List = defineComponent({
    name: "List",
    description: "1 to 4 rows, no dividers. More rows than fit scroll, with the cut-off row showing.",
    props: z.object({ rows: z.array(ListRow.ref) }),
    component: null,
  });

  // ---- Organisms: Vela's parts, whole ----------------------------------------------------------
  const Hero = defineComponent({
    name: "Hero",
    description:
      'Vela\'s turn answer, whole: "nav.next" is the next turn as Vela answers it while guiding (arrow, distance, road; "Now"; the time left on a long leg; "Arrived"); "trip.left" is the time left with the next turn under it. Use it in the Lead when the turn is the answer.',
    props: z.object({ value: z.enum(HERO_KEYS) }),
    component: null,
  });
  const Quiet = defineComponent({
    name: "Quiet",
    description: "A quiet answer: a glyph and one short sentence at road size in grey, an optional sub line and Actions. tone warn only when guidance is less reliable.",
    props: z.object({ text: z.string(), sub: z.string().optional(), glyph: glyphName.optional(), tone: z.enum(["default", "warn"]).optional(), actions: z.optional(Actions.ref) }),
    component: null,
  });
  const NowPlaying = defineComponent({ name: "NowPlaying", description: "What plays, large: cover, title, show, position and keys. Bound. Only with no route.", props: z.object({}), component: null });
  const Listening = defineComponent({ name: "Listening", description: "The listening card: cover, title, by-line, position and keys of what plays. Bound.", props: z.object({}), component: null });
  const Shelf = defineComponent({
    name: "Shelf",
    description: "The last item from Music, Podcasts and Books, one tap to resume each. Bound. Large rows in the Lead, a card elsewhere, a row with Talk as the last block.",
    props: z.object({}),
    component: null,
  });
  const WhereTo = defineComponent({ name: "WhereTo", description: "The Where to? field with up to 3 saved and recent places. Bound.", props: z.object({}), component: null });
  const CoDriver = defineComponent({
    name: "CoDriver",
    description: "The co-driver speaking: with no text, the live conversation; with text, your own 1 or 2 short sentences, with optional Actions. A card.",
    props: z.object({ text: z.string().optional(), actions: z.optional(Actions.ref) }),
    component: null,
  });
  const TripRow = defineComponent({
    name: "TripRow",
    description: "Vela's trip row, whole, on one line: the time left (to the next stop when there is one; the next turn when no other part shows it), then the arrival time (or the next stop's name and time). Bound. As the last block it also holds Talk.",
    props: z.object({}),
    component: null,
  });
  const Sheet = defineComponent({ name: "Sheet", description: "The route sheet: every stop, Add stop and End route. Only as Frame's secondary.", props: z.object({ kind: z.enum(["route"]) }), component: null });

  // ---- Layout: the primitives nest in one order (lang-core loses slot types with recursive schemas):
  // Row < Card < Optional < Stack < Columns < Lead < Split < Screen.
  type Refs = [z.ZodType, z.ZodType, ...z.ZodType[]];
  const any = (...cs: { ref: unknown }[]): z.ZodType => z.union(cs.map((c) => c.ref) as unknown as Refs);
  const ATOMS = [Value, Name, Label, Glyph, Bar, Sequence, Art, Divider, Text, Fact, Facts, Notice, List, Actions];
  const ORGANISMS = [Hero, Quiet, NowPlaying, Listening, Shelf, WhereTo, CoDriver, TripRow];

  const Row = defineComponent({
    name: "Row",
    description: "Parts side by side on one line, wrapping when narrow: a Glyph with a Value, a Value with its Label, a Bar with a Fact.",
    props: z.object({ children: z.array(any(...ATOMS)) }),
    component: null,
  });
  const Card = defineComponent({
    name: "Card",
    description: "A surface (the listening card's) around 1 to 4 parts, for things the driver can touch. No title: the content says what it is.",
    props: z.object({ children: z.array(any(...ATOMS, Row)) }),
    component: null,
  });
  const Optional = defineComponent({
    name: "Optional",
    description: "A part that may be left out when the screen is too short for it (the last Optional goes first), in the Screen, a Stack, Columns or a Split. The driver can still ask Talk for it.",
    props: z.object({ child: any(...ATOMS, ...ORGANISMS, Row, Card) }),
    component: null,
  });
  const Stack = defineComponent({
    name: "Stack",
    description: "Parts top to bottom as one group, with Signal's spacing.",
    props: z.object({ children: z.array(any(...ATOMS, ...ORGANISMS, Row, Card, Optional)) }),
    component: null,
  });
  const Columns = defineComponent({
    name: "Columns",
    description: "2 to 4 equal columns, for a comparison (two places, now and later). They wrap to fewer per line when narrow.",
    props: z.object({ children: z.array(any(...ATOMS, ...ORGANISMS, Row, Card, Optional, Stack)) }),
    component: null,
  });
  const Lead = defineComponent({
    name: "Lead",
    description:
      'The one thing the driver reads first: exactly one per screen. A Value in it is the screen\'s large figure; a Label or Name in it is road size. Its own short label (at most 4 words, after the figure, for example "fuel range") says what the figure is when no glyph does; it is part of the Lead, not of the word budget. It may hold a Row or Stack (a Glyph and a Value, then a label or a Bar), a Hero, Quiet, NowPlaying, Shelf or Art.',
    props: z.object({ child: any(...ATOMS, ...ORGANISMS, Row, Card, Stack, Columns) }),
    component: null,
  });
  const Split = defineComponent({
    name: "Split",
    description: "Two groups on one centre line: side by side on a wide screen (the first takes about 60%), one above the other on a tall one. The first leads.",
    props: z.object({
      first: any(...ATOMS, ...ORGANISMS, Row, Card, Stack, Columns, Lead, Optional),
      second: any(...ATOMS, ...ORGANISMS, Row, Card, Stack, Columns, Lead, Optional),
    }),
    component: null,
  });
  const Frame = defineComponent({
    name: "Frame",
    description:
      "Vela's own screen for this moment, whole, as Vela draws it without a Moment: primary is the answer (Hero, Quiet, NowPlaying or Shelf), secondary the card beside it (Listening, WhereTo, CoDriver, Shelf or Sheet), base the row under both (TripRow or Shelf). Use it alone; NoChange says the same more simply.",
    props: z.object({
      primary: z.union([Hero.ref, Quiet.ref, NowPlaying.ref, Shelf.ref]).optional(),
      secondary: z.union([Listening.ref, WhereTo.ref, CoDriver.ref, Shelf.ref, Sheet.ref]).optional(),
      base: z.union([TripRow.ref, Shelf.ref]).optional(),
    }),
    component: null,
  });
  const Details = defineComponent({
    name: "Details",
    description:
      'More, on request: collapsed to one quiet button (label, 1 or 2 words, for example "Car"); a tap or the driver\'s voice opens it, and it then takes the supporting items\' place beside the Lead. Only for at least two facts the driver might plausibly ask for next. A block of the Screen, written as its own statement. open is set by Vela, not by you.',
    props: z.object({ label: z.string(), children: z.array(any(...ATOMS, ...ORGANISMS, Row, Card, Stack)), open: z.boolean().optional() }),
    component: null,
  });
  const blocks = [...ATOMS, ...ORGANISMS, Row, Card, Stack, Columns, Lead, Optional, Split, Frame, Details];
  const Screen = defineComponent({
    name: "Screen",
    description:
      "A Moment: blocks top to bottom (one Lead, at most two supporting items, an optional Details, then the base row: TripRow, or Shelf with no route). Vela adds the top row (with the chip and the ✕) and Talk. What the co-driver says, when it shows and how long it stays are in the message, not here.",
    props: z.object({ blocks: z.array(any(...blocks)) }),
    component: null,
  });
  const NoChange = defineComponent({
    name: "NoChange",
    description: "Vela keeps its own screen: the message's chip (if any) shows in the top row and the co-driver says say. Prefer this whenever Vela's screen already answers.",
    props: z.object({}),
    component: null,
  });

  return createLibrary({
    components: [
      Screen, NoChange, Details, Lead, Optional, Stack, Split, Row, Columns, Card, Frame,
      Value, Name, Label, Glyph, Bar, Sequence, Art, Divider,
      Hero, Quiet, NowPlaying, Listening, Shelf, WhereTo, CoDriver, TripRow, Sheet,
      Text, Fact, Facts, Notice, List, ListRow, Button, Actions,
    ],
    actions: ACTIONS,
    root: ROOT,
    componentGroups: [
      { name: "Screen and composition", components: ["Screen", "NoChange", "Lead", "Details", "Optional", "Stack", "Split", "Row", "Columns", "Card"] },
      { name: "Atoms", components: ["Value", "Name", "Label", "Glyph", "Bar", "Sequence", "Art", "Divider", "Text", "Fact", "Facts", "Notice", "List", "ListRow", "Actions", "Button"] },
      { name: "Organisms (Vela's parts, whole)", components: ["Hero", "Quiet", "NowPlaying", "Listening", "Shelf", "WhereTo", "CoDriver", "TripRow", "Frame", "Sheet"] },
    ],
  });
}
