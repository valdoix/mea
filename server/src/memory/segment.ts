/**
 * Scene-break heuristics (MEM-03). Pure functions so they are easy to test.
 * Strong signals close a scene on their own; weak ones may be confirmed by a helper model.
 */
export type BoundaryKind = "marker" | "chapter" | "timeskip" | "pause" | "cap" | "manual";

export interface BoundarySignal {
  kind: BoundaryKind;
  strength: "strong" | "weak";
  detail: string;
}

export interface LedgerMessage {
  seq: number;
  content: string;
  createdAt: number;
}

const NUM = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|a few|few|many|some|\\d+)";

const CHAPTER = /^\s*(?:#{1,3}\s*)?(?:chapter|part|book)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/im;
const MARKER = /^\s*(?:-{3,}|\*{3,}|\* \* \*|⁂|~{3,}|_{3,}|={3,}|#{3,}\s*$|\[\s*scene (?:break|change)\s*\]|scene (?:break|change)[.:]?\s*$)\s*$/im;

const STRONG_SKIPS: RegExp[] = [
  new RegExp(`\\b${NUM}\\s+(?:days?|weeks?|months?|years?|decades?)\\s+(?:later|passed|went by|had passed|have passed|after)\\b`, "i"),
  /\b(?:the\s+)?(?:next|following)\s+(?:morning|day|evening|night|week|month|year|dawn|afternoon)\b/i,
  /\b(?:time\s*-?\s*skip|timeskip|some time later|much later|meanwhile|elsewhere)\b/i,
  /\b(?:a|one)\s+(?:week|month|year)\s+(?:later|passed)\b/i,
];

const WEAK_SKIPS: RegExp[] = [
  new RegExp(`\\b${NUM}\\s+(?:hours?|minutes?)\\s+(?:later|passed|went by)\\b`, "i"),
  /\blater\s+(?:that|in the)\s+(?:day|night|evening|morning|afternoon)\b/i,
  /\b(?:that|by)\s+(?:night|evening|nightfall|dawn)\b/i,
  /\b(?:the\s+)?(?:sun|night)\s+(?:had\s+)?(?:set|risen|fallen)\b/i,
  /\b(?:when|by the time)\s+(?:they|she|he|you|we|i)\s+(?:arrived?|reached|got (?:back|home|there))\b/i,
];

/** Looks only at the opening of a message: a scene break leads with the jump. */
const opening = (text: string) => text.trim().slice(0, 240);

function leads(head: string, index: number) {
  const before = head.slice(0, index);
  return /^[\s*_"'(\[\-—]*$/.test(before) || /[.!?…]["'*_)\]]*\s*[*_]*$/.test(before);
}

/** Decides whether `msg` starts a new scene, given the message before it. */
export function detectBoundary(prev: LedgerMessage | null, msg: LedgerMessage, opts: { pauseHours: number }): BoundarySignal | null {
  if (!prev) return null;
  const head = opening(msg.content);
  const chapter = head.match(CHAPTER);
  if (chapter) return { kind: "chapter", strength: "strong", detail: `heading "${chapter[0].trim()}"` };
  const firstLines = msg.content.trim().split("\n").slice(0, 3).join("\n");
  if (MARKER.test(firstLines)) return { kind: "marker", strength: "strong", detail: "scene-break marker" };
  // A time jump counts when it opens a sentence ("*Three days later,* …"), not inside dialogue.
  for (const re of STRONG_SKIPS) {
    const m = head.match(re);
    if (m) return { kind: "timeskip", strength: leads(head, m.index ?? 0) ? "strong" : "weak", detail: `"${m[0]}"` };
  }
  for (const re of WEAK_SKIPS) {
    const m = head.match(re);
    if (m && leads(head, m.index ?? 0)) return { kind: "timeskip", strength: "weak", detail: `"${m[0]}"` };
  }
  const gapH = (msg.createdAt - prev.createdAt) / 3_600_000;
  if (opts.pauseHours > 0 && gapH >= opts.pauseHours) return { kind: "pause", strength: "weak", detail: `${Math.round(gapH)} h pause` };
  return null;
}
