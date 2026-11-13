/** Which way the orchard has turned: from the story's season and month, or the turning leaves if there's no story. */
export type OrchardSeason = "blossom" | "summer" | "early" | "peak" | "late";

export function orchardSeason(season: string | null | undefined, month: number | null | undefined): OrchardSeason {
  const s = (season ?? "").toLowerCase();
  if (/spring|blossom/.test(s)) return "blossom";
  if (/summer/.test(s)) return "summer";
  if (/winter/.test(s)) return "late";
  if (/autumn|fall|harvest/.test(s)) {
    if (/early/.test(s) || month === 9) return "early";
    if (/late/.test(s) || month === 11) return "late";
    return "peak";
  }
  return "peak";
}
