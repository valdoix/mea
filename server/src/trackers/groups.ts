import type { Group, GroupKind, GroupMember } from "./types";

/**
 * docs/30 Part 1: groups as factions. Pure helpers over names and texts; the fold keeps the groups
 * (`WorldState.groups`), and trackers/factions.ts puts yours, the lore's and the story's together.
 */

const tidy = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** A group's key: lower case, without "the" ("The Scoobies" and "scoobies" are one group). */
export const groupKey = (name: string) =>
  tidy(name)
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^the\s+/, "");

/** Who's in it now: joined, and not left since. */
export const currentMembers = (g: Pick<Group, "members">): GroupMember[] => g.members.filter((m) => m.left == null);

/** "Dawn's friends": the person it's anchored to. */
export function possessiveAnchor(name: string): string | undefined {
  const m = tidy(name).match(/^(?:the\s+)?(\p{Lu}[\p{L}.-]*(?:\s+\p{Lu}[\p{L}.-]*)?)'s?\s+\p{L}/u);
  return m?.[1];
}

const FAMILY = /\b(?:family|families|clan|kin|dynasty|bloodline)\b/i;
const HOUSEHOLD = /\b(?:household|housemates|roommates)\b/i;
const CIRCLE = /\b(?:friends|crew|gang|circle|pack|squad|clique|kids|group|team|band|lot)\b/i;
const ORG =
  /\b(?:council|order|guild|court|coven|church|temple|company|agency|department|bureau|initiative|academy|institute|police|army|legion|militia|brotherhood|sisterhood|society|league|club|union|syndicate|cartel|mafia|corporation|corp|inc|ministry|senate|parliament|watch|guard|knights|houses?|cult|lodge|circus|crown|empire|kingdom|republic|federation|alliance|tribe|faction|party|clinic|hospital|school|university|college|firm|bank|press|gazette)\b/i;

/**
 * docs/30 1.4: the kind of group a name reads as. `lore` is the lore entry's category, when it came
 * from one; `surnames` the family names in the cast ("the Summerses" is a family).
 */
export function kindOfGroup(name: string, o: { lore?: string; surnames?: string[] } = {}): GroupKind {
  const n = tidy(name);
  if (o.lore === "family") return "family";
  if (HOUSEHOLD.test(n)) return "household";
  if (FAMILY.test(n)) return "family";
  const plural = n.match(/^(?:the\s+)?(\p{Lu}[\p{L}'-]*)$/u)?.[1]?.toLowerCase();
  if (plural && o.surnames?.some((s) => [s, `${s}s`, `${s}es`].includes(plural))) return "family";
  if (ORG.test(n) || o.lore === "faction") return "organisation";
  if (possessiveAnchor(n) || CIRCLE.test(n)) return "circle";
  return "circle";
}

/** Words that look like a capitalised plural group but aren't one ("the Fates", days, months). */
const NOT_A_GROUP =
  /^(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|holidays|olympics|states|united states|netherlands|philippines|bahamas|alps|rockies|andes|himalayas|ones|others|blues|news|lords|heavens|gods|fates|furies|graces|muses|mrs|ms|dr|drs|yes|thanks|days|times|years|mr)$/i;

const ORG_END = /(?:Council|Order|Guild|Court|Coven|Initiative|Society|League|Brotherhood|Sisterhood|Syndicate|Knights|Watch|Legion|Circle)$/;
/** "one of the Hellions", "joined the Order": words before a name that make it a group. */
const GROUP_BEFORE = /\b(?:(?:one|two|some|most|all|any|none|rest|members?|leaders?|head|heads|side|friends|enemies|ranks|eyes|word) of|join(?:s|ed|ing)?|left|quit|betray(?:s|ed)?|by order of|on behalf of)\s+$/i;
/** "the Scoobies were", "the Council has decided": a plural verb after it. */
const GROUP_AFTER = /^\s*(?:'s\s+\w+\s+)?(?:are|were|have|had|gathered|met|meet|arrived|showed up|came|want(?:ed)?|decided|sent|knew|know|agreed|voted|lined up|crowded|filed|piled|regrouped|all)\b/i;

/**
 * docs/30 1.2: capitalised groups named in the story's text ("the Scoobies", "the Hellions",
 * "the Watchers' Council"), with the messages that name them. `skip` says a name is a person or a place.
 */
export function groupsInText(texts: { seq: number; text: string }[], skip: (name: string) => boolean): Map<string, { name: string; seqs: number[] }> {
  const out = new Map<string, { name: string; seqs: number[] }>();
  // "the Scoobies", "the Watchers' Council", "the Order of Taraka": after "the", a capitalised plural, or a name ending in an organisation's word.
  const re = /\b[Tt]he\s+((?:\p{Lu}[\p{L}'-]*'?\s+){1,2}(?:Council|Order|Guild|Court|Coven|Initiative|Society|League|Brotherhood|Sisterhood|Syndicate|Knights|Watch|Legion|Circle)|(?:\p{Lu}[\p{L}'-]*\s+){0,2}\p{Lu}[\p{L}-]*(?:s|ies))\b(?![\s']+\p{Lu})/gu;
  for (const { seq, text } of texts) {
    const seen = new Set<string>();
    for (const m of text.matchAll(re)) {
      const name = m[1]!.trim();
      // A capitalised word after "the" at the start of a sentence is only a name when there's more than one word, or it's a plural.
      const key = groupKey(name);
      if (key.length < 4 || NOT_A_GROUP.test(key) || seen.has(key) || skip(name)) continue;
      const before = text.slice(Math.max(0, m.index! - 24), m.index!);
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 30);
      // A name ending in an organisation's word ("the Watchers' Council") is a group however it's used.
      if (!ORG_END.test(name) && !GROUP_BEFORE.test(before) && !GROUP_AFTER.test(after)) continue;
      seen.add(key);
      const cur = out.get(key);
      if (cur) cur.seqs.push(seq);
      else out.set(key, { name, seqs: [seq] });
    }
  }
  return out;
}

/** Groups: "Scoobies (Willow, Xander, Anya, Tara) · Winters Family (Gabriel, Eleanor)": the tracker's names for them. */
export function groupsLine(groups: Group[], max = 8): string | null {
  const shown = groups
    .filter((g) => currentMembers(g).length)
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .slice(0, max)
    .map((g) => {
      const ms = currentMembers(g).map((m) => m.name);
      return `${g.name} (${ms.slice(0, 8).join(", ")}${ms.length > 8 ? ", …" : ""})`;
    });
  return shown.length ? `Groups: ${shown.join(" · ")}` : null;
}
