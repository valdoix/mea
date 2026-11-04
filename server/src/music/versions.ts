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

/** A title without the version part or a feat. */
export const bareTitle = (title: string) => title.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s[-–—]\s.*$/, " ").replace(/\b(feat|ft|featuring)\.?\s.*$/i, " ").replace(/\s+/g, " ").trim();

/** The song's first credited artist. */
export const firstArtist = (artist: string) => artist.split(/\s*(?:&|,|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0] ?? "";

/** One key for every copy of a song: its title without the version part or a feat., and its first artist. */
export function songKey(t: { title: string; artist: string }) {
  return `${plain(bareTitle(t.title)) || plain(t.title)}|${plain(firstArtist(t.artist))}`;
}

/** Marks that say only how clean a copy is, or who else is on it: the recording is the same. */
const ONLY_THE_WORDS = /^\s*(?:(?:feat|ft|featuring)\b.*|(?:super\s+)?clean(?:\s+(?:version|edit))?|explicit(?:\s+version)?|dirty(?:\s+version)?|censored(?:\s+version)?|edited(?:\s+version)?|radio\s+(?:edit|version))\s*$/i;

const cutOf = (title: string) =>
  versionPart(title)
    .split(" | ")
    .filter((bit) => bit.trim() && !ONLY_THE_WORDS.test(bit))
    .map(plain)
    .sort()
    .join("|");

/** The same recording, whichever way its words are cut: "Song (Clean)" and "Song" are, "Song (Live)" and "Song" aren't. */
export const sameCut = (a: string, b: string) => cutOf(a) === cutOf(b);
