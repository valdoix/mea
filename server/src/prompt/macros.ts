/**
 * Macro engine (PROMPT-03): {{char}}, {{user}}, {{if ...}}…{{else}}…{{/if}},
 * variables, random/pick/roll, dates. Unknown macros are left untouched.
 */

export interface MacroContext {
  char: string;
  user: string;
  persona?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  mesExamples?: string;
  charPrompt?: string;
  charInstruction?: string;
  original?: string;
  mode?: string;
  model?: string;
  lastMessage?: string;
  lastUserMessage?: string;
  lastCharMessage?: string;
  /** Chat-scoped variables; mutated by setvar/addvar/incvar. */
  vars: Record<string, string>;
  globalVars?: Record<string, string>;
  /** Stable seed for {{pick}} (usually the chat id). */
  seed?: string;
  /** Extra named values, e.g. draft, storySoFar. */
  extra?: Record<string, string>;
  now?: Date;
  random?: () => number;
}

type Node = { t: "text"; v: string } | { t: "macro"; v: string; pos: number } | { t: "if"; cond: string; then: Node[]; else: Node[] };

const TRIM = "\u0000TRIM\u0000";

/** Finds the index right after the matching "}}" for a "{{" at `start`, honoring nesting. */
function findClose(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function parse(s: string, pos: { i: number }, inIf: boolean): { nodes: Node[]; end: "eof" | "else" | "endif" } {
  const nodes: Node[] = [];
  let text = "";
  while (pos.i < s.length) {
    const open = s.indexOf("{{", pos.i);
    if (open < 0) {
      text += s.slice(pos.i);
      pos.i = s.length;
      break;
    }
    text += s.slice(pos.i, open);
    const close = findClose(s, open);
    if (close < 0) {
      text += s.slice(open);
      pos.i = s.length;
      break;
    }
    const inner = s.slice(open + 2, close - 2);
    const tag = inner.trim();
    const lower = tag.toLowerCase();
    pos.i = close;
    if (inIf && (lower === "else" || lower === "#else")) {
      if (text) nodes.push({ t: "text", v: text });
      return { nodes, end: "else" };
    }
    if (inIf && (lower === "/if" || lower === "endif")) {
      if (text) nodes.push({ t: "text", v: text });
      return { nodes, end: "endif" };
    }
    if (text) {
      nodes.push({ t: "text", v: text });
      text = "";
    }
    if (tag.startsWith("//")) continue;
    const ifMatch = tag.match(/^#?if(?:::|\s+)([\s\S]+)$/i);
    if (ifMatch) {
      const thenPart = parse(s, pos, true);
      let elsePart: Node[] = [];
      if (thenPart.end === "else") elsePart = parse(s, pos, true).nodes;
      nodes.push({ t: "if", cond: ifMatch[1]!.trim(), then: thenPart.nodes, else: elsePart });
      continue;
    }
    nodes.push({ t: "macro", v: inner, pos: open });
  }
  if (text) nodes.push({ t: "text", v: text });
  return { nodes, end: "eof" };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FALSY = new Set(["", "0", "no", "false", "off", "null", "undefined"]);

function splitArgs(rest: string): string[] {
  if (rest.startsWith("::")) return rest.slice(2).split("::");
  if (rest.startsWith(":")) return rest.slice(1).split(rest.includes("::") ? "::" : ",").map((s) => s.trim());
  if (rest.startsWith(" ")) return [rest.trim()];
  return [];
}

function rollDice(spec: string, random: () => number): string {
  const m = spec.replace(/\s+/g, "").match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) {
    const n = Number(spec);
    return Number.isFinite(n) && n > 0 ? String(1 + Math.floor(random() * n)) : "";
  }
  const count = Math.min(100, Number(m[1] || 1));
  const sides = Number(m[2]);
  let total = Number(m[3] || 0);
  for (let i = 0; i < count; i++) total += 1 + Math.floor(random() * sides);
  return String(total);
}

function evalMacro(raw: string, ctx: MacroContext, pos: number): string | null {
  const inner = expandMacros(raw, ctx, false).trim();
  const m = inner.match(/^([A-Za-z_][\w.]*)([\s\S]*)$/);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const args = splitArgs(m[2]!);
  const random = ctx.random ?? Math.random;
  const date = ctx.now ?? new Date();
  const get = (v: string | undefined) => v ?? "";
  switch (name) {
    case "char":
      return ctx.char;
    case "user":
      return ctx.user;
    case "persona":
      return get(ctx.persona);
    case "description":
      return get(ctx.description);
    case "personality":
      return get(ctx.personality);
    case "scenario":
      return get(ctx.scenario);
    case "mesexamples":
    case "mes_examples":
    case "mesexamplesraw":
      return get(ctx.mesExamples);
    case "charprompt":
      return get(ctx.charPrompt);
    case "charinstruction":
    case "charjailbreak":
      return get(ctx.charInstruction);
    case "original":
      return get(ctx.original);
    case "mode":
      return get(ctx.mode);
    case "model":
      return get(ctx.model);
    case "lastmessage":
      return get(ctx.lastMessage);
    case "lastusermessage":
      return get(ctx.lastUserMessage);
    case "lastcharmessage":
      return get(ctx.lastCharMessage);
    case "newline":
      return "\n";
    case "trim":
      return TRIM;
    case "noop":
      return "";
    case "time":
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    case "date":
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    case "weekday":
      return date.toLocaleDateString("en-US", { weekday: "long" });
    case "isotime":
      return date.toTimeString().slice(0, 5);
    case "isodate":
      return date.toISOString().slice(0, 10);
    case "random":
      return args.length ? args[Math.floor(random() * args.length)]! : "";
    case "pick":
      return args.length ? args[hash(`${ctx.seed ?? ""}:${pos}:${args.join("|")}`) % args.length]! : "";
    case "roll":
      return rollDice(args[0] ?? "", random);
    case "setvar":
      ctx.vars[args[0] ?? ""] = args.slice(1).join("::");
      return "";
    case "getvar":
      return ctx.vars[args[0] ?? ""] ?? "";
    case "addvar":
    case "incvar":
    case "decvar": {
      const key = args[0] ?? "";
      const cur = ctx.vars[key] ?? "";
      const delta = name === "incvar" ? 1 : name === "decvar" ? -1 : Number(args[1] ?? 0);
      const isNum = cur === "" || Number.isFinite(Number(cur));
      ctx.vars[key] = name === "addvar" && !(isNum && Number.isFinite(Number(args[1]))) ? cur + (args[1] ?? "") : String(Number(cur || 0) + delta);
      return name === "addvar" ? "" : ctx.vars[key]!;
    }
    case "setglobalvar":
      if (ctx.globalVars) ctx.globalVars[args[0] ?? ""] = args.slice(1).join("::");
      return "";
    case "getglobalvar":
      return ctx.globalVars?.[args[0] ?? ""] ?? "";
    default: {
      const extra = ctx.extra?.[m[1]!] ?? ctx.extra?.[name];
      return extra ?? null;
    }
  }
}

function sideValue(side: string, ctx: MacroContext): string {
  const s = side.trim();
  if (/^[A-Za-z_][\w.]*$/.test(s)) {
    const v = evalMacro(s, ctx, 0);
    if (v !== null) return v;
  }
  return s.replace(/^["']|["']$/g, "");
}

function evalCondition(cond: string, ctx: MacroContext): boolean {
  const expanded = expandMacros(cond, ctx, false).trim();
  const negate = /^(!|not\s+)/i.test(expanded);
  const body = expanded.replace(/^(!|not\s+)/i, "");
  const m = body.match(/^([\s\S]*?)\s*(==|!=|=)\s*([\s\S]*)$/);
  let result: boolean;
  if (m) {
    const a = sideValue(m[1]!, ctx).toLowerCase();
    const b = sideValue(m[3]!, ctx).toLowerCase();
    result = m[2] === "!=" ? a !== b : a === b;
  } else {
    result = !FALSY.has(sideValue(body, ctx).trim().toLowerCase());
  }
  return negate ? !result : result;
}

function render(nodes: Node[], ctx: MacroContext): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "if") out += render(evalCondition(n.cond, ctx) ? n.then : n.else, ctx);
    else {
      const v = evalMacro(n.v, ctx, n.pos);
      out += v ?? `{{${n.v}}}`;
    }
  }
  return out;
}

export function expandMacros(template: string, ctx: MacroContext, finalize = true): string {
  if (!template || !template.includes("{{")) return template;
  const { nodes } = parse(template, { i: 0 }, false);
  let out = render(nodes, ctx);
  if (finalize && out.includes(TRIM)) out = out.replace(/\s*\u0000TRIM\u0000\s*/g, "");
  return out;
}
