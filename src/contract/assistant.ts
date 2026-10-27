/** voice-gateway passthroughs; shapes from assistant/core docs/reflexes.md and src/card.ts. */
export type AssistantMediaAction = { readonly version: 1; readonly id: string; readonly kind: "media" } & (
  | { readonly command: "play" | "pause" | "skip" }
  | { readonly command: "volume"; readonly volume: number }
  | { readonly command: "podcast"; readonly query: string }
);
export type AssistantJson = null | boolean | number | string | readonly AssistantJson[] | { readonly [key: string]: AssistantJson };
export type WeatherGlyph = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";
export interface AssistantWeatherCard {
  readonly kind: "Weather";
  readonly attribution?: string;
  readonly place: string;
  readonly units: "imperial" | "metric";
  readonly range: "today" | "week";
  readonly now: { readonly glyph: WeatherGlyph; readonly temperature: number; readonly feelsLike: number; readonly wind: number; readonly humidity: number; readonly summary: string };
  readonly hours: readonly { readonly hour: string; readonly glyph: WeatherGlyph; readonly temperature: number; readonly precipitation: number }[];
  readonly days: readonly { readonly date: string; readonly weekday: string; readonly glyph: WeatherGlyph; readonly high: number; readonly low: number; readonly precipitation: number }[];
}
export type AssistantCard = AssistantWeatherCard | {
  readonly kind: "Reflex"; readonly title: string; readonly text: string;
  readonly data?: AssistantJson; readonly askId?: string;
};
