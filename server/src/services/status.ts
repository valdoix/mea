/**
 * P1: the Chat tab's Status tiles. Features register a tile (secrets close to coming out, the next
 * promise due, the craft coach, story health…); each tile says how many need a look and what
 * opening it shows. A tile that throws is left out, never the whole panel.
 */
export interface StatusTile {
  id: string;
  /** How many need a look: the tile lights when above 0. */
  n: number;
  label: string;
  tone: "amber" | "red" | "blue";
  /** Shown instead of the count ("5/6", "20 min"). */
  value?: string;
  title?: string;
  /** What opening it does: a page in the app, a side dock tab, or the Inbox filtered to a source. */
  open?: { href: string } | { dock: "chat" | "memory" | "story" | "world" | "meus" | "notes"; section?: string } | { inbox: string };
  /** Lower comes first. */
  order?: number;
}

type TileFn = (chatId: string) => StatusTile | StatusTile[] | null;
const tiles: TileFn[] = [];

export function registerStatusTile(fn: TileFn) {
  tiles.push(fn);
}

export function statusTiles(chatId: string): StatusTile[] {
  const out: StatusTile[] = [];
  for (const fn of tiles) {
    try {
      const t = fn(chatId);
      if (t) out.push(...(Array.isArray(t) ? t : [t]));
    } catch (e) {
      console.error("[mea] a status tile failed:", e);
    }
  }
  return out.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}
