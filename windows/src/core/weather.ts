// The weather, turned into something for Mochi to wear: an umbrella in the
// rain, a beanie and scarf in the snow, sunglasses on a hot sunny day.
// Off by default — see Settings → Weather. The data comes from Rust (Open-Meteo).

import type { Outfit } from "../mochi/growth";

export interface WeatherNow {
  /** WMO code: 0 clear … 95 thunderstorm. */
  code: number;
  temperature: number;
  feelsLike: number;
  isDay: boolean;
  wind: number;
  city: string;
}

export interface WeatherLook {
  outfit: Outfit;
  fall: "rain" | "snow" | null;
  /** How it feels to Mochi — shivers in the cold, fans itself in the heat. */
  mood: "cold" | "hot" | "wet" | "storm" | null;
  emoji: string;
  label: string;
}

const NONE: WeatherLook = { outfit: {}, fall: null, mood: null, emoji: "", label: "" };

function describe(code: number, isDay: boolean): { emoji: string; label: string } {
  if (code === 0) return isDay ? { emoji: "☀️", label: "Clear" } : { emoji: "🌙", label: "Clear night" };
  if (code <= 2) return { emoji: isDay ? "🌤️" : "☁️", label: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", label: "Cloudy" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Fog" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { emoji: "🌧️", label: "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { emoji: "❄️", label: "Snow" };
  if (code >= 95) return { emoji: "⛈️", label: "Thunderstorm" };
  return { emoji: "🌡️", label: "Weather" };
}

export function lookFor(w: WeatherNow | null): WeatherLook {
  if (!w) return NONE;
  const { code, feelsLike, isDay } = w;
  const { emoji, label } = describe(code, isDay);
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const snowy = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const outfit: Outfit = {};
  let fall: WeatherLook["fall"] = null;
  let mood: WeatherLook["mood"] = null;

  if (rainy) {
    outfit.hat = "umbrella";
    fall = "rain";
    mood = code >= 95 ? "storm" : "wet";
  } else if (snowy) {
    outfit.hat = "beanie";
    outfit.neck = "scarf";
    fall = "snow";
    mood = "cold";
  }
  if (feelsLike < 8) {
    outfit.neck = "scarf";
    mood = mood ?? "cold";
    if (feelsLike < 2 && !outfit.hat) outfit.hat = "beanie";
  }
  if (!rainy && !snowy && isDay && code <= 1 && feelsLike >= 27) {
    outfit.face = "sunglasses";
    mood = "hot";
  }
  return { outfit, fall, mood, emoji, label: `${label} · ${Math.round(w.temperature)}°` };
}
