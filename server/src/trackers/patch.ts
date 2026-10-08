import { addMinutes, parseStoryTime, formatStoryTime, timeOfDay, parseDuration } from "./clock";
import { type Field, type Row, type State, type Template, tableKey } from "./schema";

/**
 * Delta updates (TRK-02): the tracker model proposes changes; this validates each one against
 * the schema, skips locked fields (TRK-05), caps meter moves (TRK-11), keeps the clock moving
 * forward (TRK-10), and records what changed for the chips under the message (TRK-07).
 */
export interface PatchOp {
  path: string;
  op?: "set" | "add" | "remove" | "delete_row";
  value?: unknown;
  reason?: string;
}

export interface Patch {
  time_passed_minutes?: number | null;
  flashback?: boolean | null;
  changes: PatchOp[];
}

export type ChangeSource = "ai" | "user" | "init" | "timeskip";

export interface Change {
  path: string;
  template: string;
  label: string;
  kind: "set" | "add" | "remove" | "row_added" | "row_removed" | "clock";
  row?: string;
  from?: unknown;
  to?: unknown;
  delta?: number;
  reason?: string;
  /** TRK-11: the move was capped; `requested` is what the model asked for. */
  limited?: { requested: unknown };
  /** A note for the chip's detail: "big jump", "flashback". */
  flag?: string;
  memory?: boolean;
  source: ChangeSource;
}

export interface ApplyOptions {
  templates: Template[];
  locks?: string[];
  source: ChangeSource;
  /** TRK-11: cap meter moves at each field's maxDelta (otherwise big jumps are only flagged). */
  limits?: boolean;
  /** The message seq the change belongs to; stamps table rows for thread age (TRK-19). */
  seq?: number;
  /** Largest clock jump the model may make in one message, in minutes. */
  maxClockMinutes?: number;
}

export interface ApplyResult {
  state: State;
  changes: Change[];
  rejected: { path: string; why: string }[];
}

interface Target {
  template: Template;
  field: Field;
  rowKey?: string;
  sub?: Field;
  /** Canonical path, used for locks and chips. */
  path: string;
  label: string;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const norm = (s: string) => s.trim().toLowerCase();

export function isLocked(path: string, locks: string[] = []) {
  const p = norm(path);
  return locks.some((l) => {
    const k = norm(l);
    return p === k || p.startsWith(`${k}.`) || p.startsWith(`${k}[`);
  });
}

/** Parses "scene.location", "characters.people[Mira].mood", "persona.status.outfit", also dotted row names. */
export function resolvePath(path: string, templates: Template[]): Target | string {
  const m = path.trim().match(/^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)(.*)$/i);
  if (!m) return "unreadable path";
  const template = templates.find((t) => t.key === m[1]!.toLowerCase());
  if (!template) return `no tracker "${m[1]}"`;
  const field = template.schema.fields.find((f) => f.key === m[2]!.toLowerCase());
  if (!field) return `no field "${m[2]}" in ${template.name}`;
  let rest = m[3]!;
  const base = `${template.key}.${field.key}`;
  if (!rest) return { template, field, path: base, label: field.label };
  if (field.type === "table") {
    let rowKey: string | undefined;
    let subKey: string | undefined;
    const b = rest.match(/^\[(.+?)\](?:\.([a-z][a-z0-9_]*))?$/i);
    if (b) {
      rowKey = b[1]!.trim();
      subKey = b[2];
    } else if (rest.startsWith(".")) {
      // Tolerate characters.people.Mira.mood (row names may themselves contain dots).
      rest = rest.slice(1);
      const lastDot = rest.lastIndexOf(".");
      const tail = lastDot >= 0 ? rest.slice(lastDot + 1) : "";
      if (tail && field.fields?.some((f) => f.key === tail.toLowerCase())) {
        rowKey = rest.slice(0, lastDot);
        subKey = tail;
      } else rowKey = rest;
    } else return "unreadable path";
    if (!rowKey) return "missing row name";
    const sub = subKey ? field.fields?.find((f) => f.key === subKey!.toLowerCase()) : undefined;
    if (subKey && !sub) return `no column "${subKey}" in ${field.label}`;
    const path = `${base}[${rowKey}]${sub ? `.${sub.key}` : ""}`;
    return { template, field, rowKey, sub, path, label: sub ? `${rowKey} · ${sub.label}` : rowKey };
  }
  if (field.type === "object") {
    const s = rest.match(/^\.([a-z][a-z0-9_]*)$/i);
    const sub = s ? field.fields?.find((f) => f.key === s[1]!.toLowerCase()) : undefined;
    if (!sub) return `no part "${rest.slice(1)}" in ${field.label}`;
    return { template, field, sub, path: `${base}.${sub.key}`, label: `${field.label} · ${sub.label}` };
  }
  return "this field has no parts";
}

type Coerced = { ok: true; value: unknown } | { ok: false; why: string };

/** Turns a proposed value into the field's type, or explains why it can't. */
export function coerce(f: Field, value: unknown): Coerced {
  if (value === null || value === undefined) {
    if (f.type === "tags") return { ok: true, value: [] };
    if (f.type === "boolean") return { ok: true, value: false };
    if (f.type === "number" || f.type === "meter") return { ok: false, why: "a number is needed" };
    return { ok: true, value: "" };
  }
  switch (f.type) {
    case "text":
    case "entity":
      return { ok: true, value: String(typeof value === "object" ? JSON.stringify(value) : value).trim().slice(0, 400) };
    case "longtext":
      return { ok: true, value: String(typeof value === "object" ? JSON.stringify(value) : value).trim().slice(0, 2000) };
    case "number":
    case "meter": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.+-]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, why: "not a number" };
      const min = f.min ?? (f.type === "meter" ? 0 : -Infinity);
      const max = f.max ?? (f.type === "meter" ? 100 : Infinity);
      return { ok: true, value: Math.max(min, Math.min(max, Math.round(n * 100) / 100)) };
    }
    case "enum": {
      const v = norm(String(value));
      const hit = f.options?.find((o) => norm(o) === v) ?? f.options?.find((o) => norm(o).startsWith(v) || v.startsWith(norm(o)));
      return hit ? { ok: true, value: hit } : { ok: false, why: `must be one of: ${f.options?.join(", ")}` };
    }
    case "tags": {
      const list = Array.isArray(value) ? value : String(value).split(/[,;\n]/);
      return { ok: true, value: [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].slice(0, 40) };
    }
    case "boolean":
      return { ok: true, value: typeof value === "boolean" ? value : /^(true|yes|y|1|on)$/i.test(String(value).trim()) };
    case "datetime": {
      const t = parseStoryTime(value);
      return t ? { ok: true, value: formatStoryTime(t) } : String(value).trim() === "" ? { ok: true, value: "" } : { ok: false, why: "use YYYY-MM-DD HH:mm or Day N HH:mm" };
    }
    case "duration": {
      const n = typeof value === "number" ? value : parseDuration(String(value));
      return n == null || !Number.isFinite(n) ? { ok: false, why: "a duration like 90 minutes or 2 days" } : { ok: true, value: Math.max(0, Math.round(n)) };
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return { ok: false, why: "an object is needed" };
      const out: Row = {};
      for (const sub of f.fields ?? []) {
        if (!(sub.key in (value as Row))) continue;
        const c = coerce(sub, (value as Row)[sub.key]);
        if (c.ok) out[sub.key] = c.value;
      }
      return { ok: true, value: out };
    }
    case "table":
      return { ok: false, why: "set table rows one at a time" };
  }
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (isEmpty(a) && isEmpty(b));

function rowsOf(state: State, t: Template, f: Field): Row[] {
  state[t.key] ??= {};
  const cur = state[t.key]![f.key];
  if (!Array.isArray(cur)) state[t.key]![f.key] = [];
  return state[t.key]![f.key] as Row[];
}

export function findRow(rows: Row[], f: Field, key: string) {
  const k = tableKey(f);
  return rows.find((r) => norm(String(r[k] ?? "")) === norm(key));
}

/** The template field marked as the story clock, if any. */
export function clockField(templates: Template[]) {
  for (const t of templates) for (const f of t.schema.fields) if (f.clock && f.type === "datetime") return { template: t, field: f };
  return null;
}

export function applyPatch(input: State, patch: Patch, opts: ApplyOptions): ApplyResult {
  const state = clone(input) ?? {};
  const changes: Change[] = [];
  const rejected: ApplyResult["rejected"] = [];
  const locks = opts.locks ?? [];
  const clock = clockField(opts.templates);
  let clockSetDirectly = false;

  const record = (t: Target, c: Omit<Change, "path" | "template" | "label" | "source" | "memory" | "row">) => {
    const memory = Boolean((t.sub ?? t.field).memory);
    changes.push({ path: t.path, template: t.template.key, label: t.label, row: t.rowKey, source: opts.source, ...(memory ? { memory } : {}), ...c });
  };

  for (const op of patch.changes ?? []) {
    const t = resolvePath(op.path ?? "", opts.templates);
    if (typeof t === "string") {
      rejected.push({ path: op.path, why: t });
      continue;
    }
    if (opts.source !== "user" && isLocked(t.path, locks)) {
      rejected.push({ path: t.path, why: "locked" });
      continue;
    }
    const target = t.sub ?? t.field;
    if (target.derived && opts.source !== "user") continue;
    const reason = typeof op.reason === "string" ? op.reason.trim().slice(0, 160) : undefined;
    const kind = op.op ?? "set";

    // Whole table rows: add/merge or remove.
    if (t.field.type === "table" && t.rowKey && !t.sub) {
      const rows = rowsOf(state, t.template, t.field);
      const existing = findRow(rows, t.field, t.rowKey);
      if (kind === "delete_row" || kind === "remove") {
        if (existing) {
          rows.splice(rows.indexOf(existing), 1);
          record(t, { kind: "row_removed", from: existing[tableKey(t.field)], reason });
        }
        continue;
      }
      const value = typeof op.value === "object" && op.value && !Array.isArray(op.value) ? (op.value as Row) : {};
      const row: Row = existing ?? { [tableKey(t.field)]: t.rowKey, _since: opts.seq ?? null };
      if (!existing) rows.push(row);
      for (const sub of t.field.fields ?? []) {
        if (sub.key === tableKey(t.field) || !(sub.key in value) || sub.derived) continue;
        const subPath = `${t.path}.${sub.key}`;
        if (opts.source !== "user" && isLocked(subPath, locks)) continue;
        const c = coerce(sub, value[sub.key]);
        if (c.ok) row[sub.key] = c.value;
      }
      row._touched = opts.seq ?? row._touched ?? null;
      if (!existing) record(t, { kind: "row_added", to: t.rowKey, reason });
      continue;
    }

    // A cell in a table row (the row is created on first write).
    let container: Row;
    let key: string;
    if (t.field.type === "table" && t.rowKey && t.sub) {
      const rows = rowsOf(state, t.template, t.field);
      let row = findRow(rows, t.field, t.rowKey);
      if (!row) {
        if (kind === "remove" && t.sub.type !== "tags") continue;
        row = { [tableKey(t.field)]: t.rowKey, _since: opts.seq ?? null };
        rows.push(row);
        record({ ...t, sub: undefined, path: `${t.template.key}.${t.field.key}[${t.rowKey}]`, label: t.rowKey }, { kind: "row_added", to: t.rowKey, reason });
      }
      row._touched = opts.seq ?? row._touched ?? null;
      container = row;
      key = t.sub.key;
    } else if (t.field.type === "object" && t.sub) {
      state[t.template.key] ??= {};
      const obj = state[t.template.key]![t.field.key];
      container = obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Row) : {};
      state[t.template.key]![t.field.key] = container;
      key = t.sub.key;
    } else if (t.field.type === "table") {
      rejected.push({ path: t.path, why: "name a row, like field[Name].column" });
      continue;
    } else {
      state[t.template.key] ??= {};
      container = state[t.template.key]!;
      key = t.field.key;
    }

    const before = clone(container[key]);
    // Tags: add/remove items.
    if (target.type === "tags" && (kind === "add" || kind === "remove")) {
      const items = (coerce(target, op.value) as { value: string[] }).value;
      const cur = Array.isArray(before) ? (before as string[]) : [];
      const next = kind === "add" ? [...cur, ...items.filter((i) => !cur.some((c) => norm(c) === norm(i)))] : cur.filter((c) => !items.some((i) => norm(c) === norm(i)));
      if (same(cur, next)) continue;
      container[key] = next;
      const diff = kind === "add" ? items.filter((i) => !cur.some((c) => norm(c) === norm(i))) : cur.filter((c) => items.some((i) => norm(c) === norm(i)));
      record(t, { kind, from: cur, to: diff.length === 1 ? diff[0] : diff, reason });
      continue;
    }

    // Numbers: "add" and "+5"/"-3" strings are relative moves.
    let value = op.value;
    if ((target.type === "number" || target.type === "meter") && (kind === "add" || (typeof value === "string" && /^[+-]\s*\d/.test(value.trim())))) {
      const delta = Number(String(value).replace(/\s/g, ""));
      value = (typeof before === "number" ? before : (target.min ?? 0)) + (Number.isFinite(delta) ? delta : 0);
    }
    const c = coerce(target, value);
    if (!c.ok) {
      rejected.push({ path: t.path, why: c.why });
      continue;
    }
    let next = c.value;

    // TRK-10: the clock only moves forward unless the change is flagged as a flashback.
    let flag: string | undefined;
    if (target.clock && target.type === "datetime" && opts.source !== "user") {
      const a = parseStoryTime(before);
      const b = parseStoryTime(next);
      if (a && b && b.minutes < a.minutes) {
        if (!patch.flashback && opts.source !== "timeskip") {
          rejected.push({ path: t.path, why: "story time can't go backwards (flag a flashback)" });
          continue;
        }
        flag = "flashback";
      }
      clockSetDirectly = true;
    }

    // TRK-11: cap how far a meter moves in one message.
    let limited: Change["limited"];
    let delta: number | undefined;
    if ((target.type === "number" || target.type === "meter") && typeof next === "number") {
      const prev = typeof before === "number" ? before : null;
      if (prev != null) {
        delta = Math.round((next - prev) * 100) / 100;
        if (target.maxDelta && Math.abs(delta) > target.maxDelta && opts.source === "ai") {
          if (opts.limits !== false) {
            limited = { requested: next };
            next = prev + Math.sign(delta) * target.maxDelta;
            delta = Math.sign(delta) * target.maxDelta;
          } else flag = "big jump";
        }
      }
    }

    if (same(before, next)) continue;
    container[key] = next;
    record(t, { kind: "set", from: before, to: next, ...(delta != null ? { delta } : {}), reason, ...(limited ? { limited } : {}), ...(flag ? { flag } : {}) });
  }

  // TRK-10: "time passed" moves the clock when the model didn't set it outright.
  if (clock && !clockSetDirectly && patch.time_passed_minutes && patch.time_passed_minutes > 0) {
    const path = `${clock.template.key}.${clock.field.key}`;
    const cur = state[clock.template.key]?.[clock.field.key];
    if (!isLocked(path, locks) && typeof cur === "string" && parseStoryTime(cur)) {
      const minutes = Math.min(patch.time_passed_minutes, opts.maxClockMinutes ?? 7 * 1440);
      const next = addMinutes(cur, minutes);
      if (next && next !== cur) {
        state[clock.template.key]![clock.field.key] = next;
        changes.push({
          path,
          template: clock.template.key,
          label: clock.field.label,
          kind: "clock",
          from: cur,
          to: next,
          delta: minutes,
          source: opts.source,
          ...(minutes < patch.time_passed_minutes ? { limited: { requested: patch.time_passed_minutes } } : {}),
        });
      }
    }
  }

  deriveFields(state, opts.templates, locks);
  return { state, changes, rejected };
}

/** Code-filled fields: time of day follows the clock. */
export function deriveFields(state: State, templates: Template[], locks: string[] = []) {
  const clock = clockField(templates);
  if (!clock) return;
  const tod = timeOfDay(state[clock.template.key]?.[clock.field.key]);
  if (!tod) return;
  for (const t of templates)
    for (const f of t.schema.fields)
      if (f.derived === "timeOfDay" && !isLocked(`${t.key}.${f.key}`, locks)) {
        state[t.key] ??= {};
        state[t.key]![f.key] = f.options?.includes(tod) ? tod : state[t.key]![f.key];
      }
}
