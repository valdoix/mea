/**
 * Versions of a song: a live recording, a remix, an acoustic take, a sped-up or slowed edit, a demo.
 * Told from the title's version part only (what's in brackets, or after " - "), so "Live Forever"
 * isn't a live song. Copies of one song (the single and the album cut, a live take, a feat. version)
 * share a key, so having played one counts for all of them.
 */

export const VERSIONS = ["live", "remix", "acoustic", "sped up", "demo"] as const;
export type Version = (typeof VERSIONS)[number];

const MARKS: Record<Version, RegExp> = {
  live: /\b(live|unplugged|in concert|concert|sessions?|tour)\b/i,
  remix: /\b(remix|rmx|mix|dub|rework|bootleg|vip|flip)\b/i,
  acoustic: /\b(acoustic|stripped|unplugged|piano version|orchestral)\b/i,
  "sped up": /\b(sped[ -]?up|speed[ -]?up|slowed|reverb|nightcore|8d)\b/i,
  demo: /\bdemo\b/i,
};

/** The title's version part: what's in brackets, and anything after " - ". */
function versionPart(title: string) {
  const bits = [...title.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]!);
  const dash = /\s[-–—]\s(.+)$/.exec(title);
  if (dash) bits.push(dash[1]!);
  return bits.join(" | ");
}

/** Which versions a title is (none for the studio cut). */
export function versionsOf(title: string): Version[] {
  const part = versionPart(title);
  return part ? VERSIONS.filter((v) => MARKS[v].test(part)) : [];
}

/** A title is one of these versions. */
export const blockedVersion = (title: string, blocked: readonly Version[]) => blocked.length > 0 && versionsOf(title).some((v) => blocked.includes(v));

const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/** One key for every copy of a song: its title without the version part or a feat., and its first artist. */
export function songKey(t: { title: string; artist: string }) {
  const base = t.title.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s[-–—]\s.*$/, " ").replace(/\b(feat|ft|featuring)\.?\s.*$/i, " ");
  const artist = t.artist.split(/\s*(?:&|,|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0] ?? "";
  return `${plain(base) || plain(t.title)}|${plain(artist)}`;
}
