export type RoomWeather = "fair" | "cloudy" | "rain" | "fog" | "snow" | "storm";
/** What Appearance can pin the room to; "scene" lets the story decide. */
export type WeatherPin = "scene" | RoomWeather;

/** A pinned sky wins; otherwise the scene's, and no scene (or a clear one) is fair. Wind reads as passing cloud. */
export function resolveWeather(
  pin: WeatherPin | undefined,
  scene: string | null,
): RoomWeather {
  if (pin && pin !== "scene") return pin;
  switch (scene) {
    case "storm":
    case "snow":
    case "rain":
    case "fog":
    case "cloudy":
      return scene;
    case "wind":
      return "cloudy";
    default:
      return "fair";
  }
}
