/**
 * The Moment vocabulary's plain data: the keys a part binds to, the glyphs, the action steps and the
 * component groups. No zod and no lang-core here, so the app imports this file freely;
 * vocabulary.ts (build time and tests only) turns it into the OpenUI library.
 *
 * Every key binds to data Vela itself holds now (the engines' state, the car's readings, what the
 * screen remembers), so a Moment's figures stay live while it shows.
 */

/** Figures: a number (or a clock time, or minutes) with its unit. What a Value shows. */
export const VALUE_KEYS = [
  "trip.left", "trip.distance", "trip.eta", "next.distance",
  "stop.next.in", "stop.next.eta", "stops.left",
  "playback.left", "playback.spare",
  "car.range", "range.short", "car.fuel", "car.ambient", "car.coolant", "car.voltage",
  "trip.driven", "trip.time", "trip.avg",
  "weather.change.in", "weather.rain.in", "weather.rain.length", "weather.rain.at",
] as const;
/** Words: a place, a road, a title, a by-line, fault codes. What a Name shows. */
export const NAME_KEYS = ["dest", "next.road", "road.now", "stop.next", "media.now", "media.by", "car.codes", "weather.now", "weather.next"] as const;
export const BAR_KEYS = ["playback", "range", "fuel"] as const;
export const SEQUENCE_KEYS = ["route.stops", "weather.stretches", "route.weather"] as const;
export const HERO_KEYS = ["nav.next", "trip.left"] as const;
export const FACT_KEYS = [...VALUE_KEYS, ...NAME_KEYS] as const;

export type ValueKey = (typeof VALUE_KEYS)[number];
export type NameKey = (typeof NAME_KEYS)[number];
export type BarKey = (typeof BAR_KEYS)[number];
export type SequenceKey = (typeof SEQUENCE_KEYS)[number];
export type HeroKey = (typeof HERO_KEYS)[number];
export type FactKey = (typeof FACT_KEYS)[number];

/** Glyphs by name: core/icons.ts names, plus "next.turn" (the next maneuver's arrow, bound). */
export const GLYPHS = [
  "next.turn",
  "search", "home", "work", "recent", "flag", "pin", "alert", "check", "chevron", "plus", "locate", "nosignal",
  "music", "podcast", "book", "fuel", "food", "rest", "bubble", "trip", "compass", "reroute", "download", "retry", "sound", "bell",
  "car", "engine", "thermo", "battery",
] as const;
export type MomentGlyph = (typeof GLYPHS)[number];

/** The type tiers below the lead. The lead tier is the Lead's alone. */
export const TIERS = ["secondary", "tertiary", "caption"] as const;
export type Tier = (typeof TIERS)[number];

export const SHEETS = ["route", "library", "where", "add-stop"] as const;
export const STOP_KINDS = ["fuel", "food", "rest"] as const;
export const SOURCES = ["music", "podcasts", "books"] as const;

/** Action steps a Button (or a row) runs. Each maps to something the app already does. */
export const ACTION_NAMES = ["OpenSheet", "FindStop", "Resume", "ConnectCar", "Dismiss"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

/** Shared lifecycle limits are also advertised in moment.capabilities. */
export { UNTIL_EVENTS, MAX_LIFE_S } from "../../contract/moments";
export type { UntilEvent } from "../../contract/moments";

export const ROOT = "Screen";
export const ROOTS = new Set(["Screen", "NoChange"]);
/** Organisms that answer: the Lead's (or a Frame's primary) alone. */
export const ANSWERS = new Set(["Hero", "Quiet", "NowPlaying"]);
/** Base rows: as a Screen's last block they hold Talk. */
export const BASES = new Set(["TripRow", "Shelf"]);
