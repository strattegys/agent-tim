/**
 * WMO Weather interpretation codes (Open-Meteo).
 * https://open-meteo.com/en/docs#weathervariables
 */

export function wmoWeatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 55) return "🌦️";
  if (code === 56 || code === 57) return "🌨️";
  if (code >= 61 && code <= 65) return "🌧️";
  if (code === 66 || code === 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code === 85 || code === 86) return "🌨️";
  if (code >= 95 && code <= 99) return "⛈️";
  return "🌡️";
}

/** Short English label for title/tooltip. */
export function wmoWeatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm w/ hail";
  return "Weather";
}

/** One–two words for compact UI (daily rows, chips). */
export function wmoWeatherBrief(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly sunny";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 56 || code === 57) return "icy mix";
  if (code >= 61 && code <= 65) return "rainy";
  if (code === 66 || code === 67) return "ice rain";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 80 && code <= 82) return "showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code >= 95 && code <= 99) return "storms";
  return "mixed";
}
