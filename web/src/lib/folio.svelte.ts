/**
 * Folio: the notes shown in the margin, the columns pulled out beside the story, and the named
 * workspaces that remember an arrangement. Kept on this device: what suits the phone in your pocket
 * isn't what suits the PC at home.
 */
import type { DockTab } from "./dock.svelte";

export type NoteKind = "memory" | "story" | "world" | "meus" | "notes";

export interface FolioColumn {
  key: string;
  /** A side-panel tab, or one Codex entity. */
  kind: DockTab | "entity";
  entityId?: string;
  /** Where it belongs: an entity's page only makes sense in its own story. */
  chatId?: string;
  title?: string;
  /** The message it was pulled out of. */
  from?: number;
  pinned: boolean;
  /** Dragged to a width of its own; unset is the default. */
  width?: number;
}

export interface Workspace {
  name: string;
  columns: FolioColumn[];
}

/** "Reading" is the margin alone, and always there. */
export const READING = "Reading";
const KEY = "mea.folio";

interface Saved {
  columns: FolioColumn[];
  workspaces: Workspace[];
  active: string | null;
  filters: Record<NoteKind, boolean>;
}

function read(): Saved {
  const d: Saved = { columns: [], workspaces: [], active: READING, filters: { memory: true, story: true, world: true, meus: true, notes: true } };
  try {
    const s = { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as Saved;
    return { ...s, filters: { ...d.filters, ...s.filters } };
  } catch {
    return d;
  }
}

/** page: which column the phone is showing (0 is the story). */
export const folio = $state({ ...read(), page: 0 });

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ columns: folio.columns, workspaces: folio.workspaces, active: folio.active, filters: folio.filters }));
  } catch {
    // private mode: the arrangement lasts until the tab closes
  }
}

/** The active workspace follows what you do to its columns; "Reading" stays the margin alone. */
function changed() {
  const w = folio.workspaces.find((x) => x.name === folio.active);
  if (w) w.columns = $state.snapshot(folio.columns) as FolioColumn[];
  else if (folio.columns.length) folio.active = null;
  else folio.active = READING;
  folio.page = Math.min(folio.page, folio.columns.length);
  save();
}

const keyOf = (kind: FolioColumn["kind"], entityId?: string) => (entityId ? `${kind}:${entityId}` : kind);

/** Opens a column, or goes to it if it's already out. */
export function openColumn(kind: FolioColumn["kind"], opts: { entityId?: string; chatId?: string; title?: string; from?: number } = {}) {
  const key = keyOf(kind, opts.entityId);
  let i = folio.columns.findIndex((c) => c.key === key);
  if (i < 0) {
    folio.columns.push({ key, kind, pinned: false, ...opts });
    i = folio.columns.length - 1;
    changed();
  }
  folio.page = i + 1;
}

export function closeColumn(key: string) {
  folio.columns = folio.columns.filter((c) => c.key !== key);
  changed();
}

export function togglePin(key: string) {
  const c = folio.columns.find((x) => x.key === key);
  if (!c) return;
  c.pinned = !c.pinned;
  changed();
}

/** A column's width: kept between a usable minimum and most of the window. null goes back to the default. */
export const COLUMN_MIN = 260;
export function columnMax() {
  return Math.max(COLUMN_MIN, Math.min(900, Math.round(window.innerWidth * 0.6)));
}
export function setColumnWidth(key: string, w: number | null, persist = true) {
  const c = folio.columns.find((x) => x.key === key);
  if (!c) return;
  if (w == null) delete c.width;
  else c.width = Math.round(Math.max(COLUMN_MIN, Math.min(columnMax(), w)));
  if (persist) changed();
}

export function moveColumn(key: string, to: number) {
  const from = folio.columns.findIndex((c) => c.key === key);
  if (from < 0 || to < 0 || to >= folio.columns.length || from === to) return;
  const [c] = folio.columns.splice(from, 1);
  folio.columns.splice(to, 0, c!);
  changed();
}

/** A different story: its own columns stay, unpinned ones and another story's entity pages go. */
let lastChat: string | null = null;
export function enterChat(chatId: string) {
  const previous = lastChat;
  lastChat = chatId;
  if (previous === chatId) return;
  const next = folio.columns.filter((c) => (c.kind === "entity" ? c.chatId === chatId : c.pinned || previous === null));
  if (next.length !== folio.columns.length) {
    folio.columns = next;
    changed();
  }
  folio.page = 0;
}

export function saveWorkspace(name: string) {
  const n = name.trim().slice(0, 40);
  if (!n || n === READING) return false;
  const columns = $state.snapshot(folio.columns) as FolioColumn[];
  const w = folio.workspaces.find((x) => x.name === n);
  if (w) w.columns = columns;
  else folio.workspaces.push({ name: n, columns });
  folio.active = n;
  save();
  return true;
}

export function useWorkspace(name: string, chatId: string) {
  // Pinned columns stay through a change of workspace.
  const pinned = folio.columns.filter((c) => c.pinned);
  const cols = name === READING ? [] : ((folio.workspaces.find((w) => w.name === name)?.columns ?? []) as FolioColumn[]);
  const fresh = cols.filter((c) => (c.kind !== "entity" || c.chatId === chatId) && !pinned.some((p) => p.key === c.key));
  folio.columns = [...pinned, ...fresh];
  folio.active = name;
  folio.page = 0;
  save();
}

export function deleteWorkspace(name: string) {
  folio.workspaces = folio.workspaces.filter((w) => w.name !== name);
  if (folio.active === name) folio.active = folio.columns.length ? null : READING;
  save();
}

export function toggleFilter(kind: NoteKind) {
  folio.filters[kind] = !folio.filters[kind];
  save();
}
