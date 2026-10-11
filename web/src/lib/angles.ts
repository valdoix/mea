/** A2: swipe with an angle. The texts live on the server (steer/swipes.ts); these are the buttons. */
export const ANGLES = [
  { id: "another", label: "Another direction" },
  { id: "quieter", label: "Quieter" },
  { id: "tension", label: "More tension" },
  { id: "dialogue", label: "More dialogue" },
  { id: "shorter", label: "Shorter" },
  { id: "side", label: "From their side" },
  { id: "surprise", label: "Surprise me" },
] as const;
export type Angle = (typeof ANGLES)[number]["id"];
