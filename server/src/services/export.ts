import { strToU8, zipSync } from "fflate";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../config";
import { all, db, dbMode } from "../db/db";
import { getCard } from "./characters";
import { getChatRow, type SwipeRow } from "./chats";
import { getDefaultPersona, getPersona } from "./personas";

interface ExportMessage {
  role: string;
  name: string;
  content: string;
  swipes: string[];
  swipeIdx: number;
  createdAt: number;
}

function loadChat(chatId: string) {
  const chat = getChatRow(chatId);
  if (!chat) return undefined;
  const card = chat.character_id ? getCard(chat.character_id) : undefined;
  const persona = getPersona(chat.persona_id) ?? getDefaultPersona();
  const charName = card?.name ?? "Character";
  const userName = persona?.name ?? "You";
  const msgs = all<{ id: string; role: string; name: string | null; active_swipe: number; created_at: number }>(
    "SELECT id, role, name, active_swipe, created_at FROM messages WHERE chat_id = ? AND deleted_at IS NULL ORDER BY seq",
    chatId,
  );
  const swipes = all<SwipeRow>("SELECT s.* FROM swipes s JOIN messages m ON m.id = s.message_id WHERE m.chat_id = ? ORDER BY s.idx", chatId);
  const messages: ExportMessage[] = msgs.map((m) => {
    const ss = swipes.filter((s) => s.message_id === m.id);
    return {
      role: m.role,
      name: m.role === "user" ? userName : m.role === "assistant" ? (m.name ?? charName) : "Note",
      content: ss.find((s) => s.idx === m.active_swipe)?.content ?? "",
      swipes: ss.map((s) => s.content),
      swipeIdx: m.active_swipe,
      createdAt: m.created_at,
    };
  });
  return { chat, charName, userName, messages };
}

/** SillyTavern-compatible JSONL (DATA-02). */
export function exportChatJsonl(chatId: string): string | undefined {
  const d = loadChat(chatId);
  if (!d) return undefined;
  const lines = [JSON.stringify({ user_name: d.userName, character_name: d.charName, create_date: new Date(d.chat.created_at).toISOString(), chat_metadata: { mea_chat_id: d.chat.id, mode: d.chat.mode } })];
  for (const m of d.messages) {
    lines.push(
      JSON.stringify({
        name: m.name,
        is_user: m.role === "user",
        is_system: m.role === "system",
        send_date: new Date(m.createdAt).toISOString(),
        mes: m.content,
        ...(m.swipes.length > 1 ? { swipes: m.swipes, swipe_id: m.swipeIdx } : {}),
        extra: {},
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function exportChatMarkdown(chatId: string): string | undefined {
  const d = loadChat(chatId);
  if (!d) return undefined;
  return `# ${d.chat.title}\n\n${d.messages.map((m) => `**${m.name}:**\n\n${m.content}`).join("\n\n---\n\n")}\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inlineFormat(s: string) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/(&quot;|"|“)([^"”\n]+)("|”)/g, '<span class="dl">“$2”</span>');
}

/** A cozy, self-contained HTML keepsake of the story. */
export function exportChatHtml(chatId: string): string | undefined {
  const d = loadChat(chatId);
  if (!d) return undefined;
  const body = d.messages
    .map((m) => {
      const paras = m.content.split(/\n{2,}/).map((p) => `<p>${inlineFormat(p).replace(/\n/g, "<br>")}</p>`).join("");
      return `<article class="${m.role}"><h3>${esc(m.name)}</h3>${paras}</article>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.chat.title)}</title><style>
body{margin:0;background:#FBF6F1;color:#43363D;font:18px/1.7 Georgia,'Lora',serif}
main{max-width:42rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
h1{font-weight:600;font-size:1.8rem;margin:0 0 2rem;color:#9C3F63}
article{background:#FFFDFB;border:1px solid #EADDD5;border-radius:16px;padding:1rem 1.25rem;margin:0 0 1rem}
article.user{background:#F4F0FC}
h3{margin:0 0 .4rem;font:700 .85rem/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#76646D}
p{margin:.5rem 0} em{color:#76646D} .dl{color:#9C3F63}
@media (prefers-color-scheme:dark){body{background:#231E2A;color:#F2E8EE}article{background:#2D2635;border-color:#463C52}article.user{background:#2E2A3D}h1,.dl{color:#F2A7BF}em,h3{color:#B9AAB4}}
</style></head><body><main><h1>${esc(d.chat.title)}</h1>
${body}
</main></body></html>`;
}

/** Whole-library backup zip: database snapshot + images (DATA-02). Secrets stay encrypted. */
export function exportLibraryZip(): Uint8Array {
  // An in-memory (encrypted) database is serialized directly, so no plain copy lands in a temp folder.
  let snapshot: Uint8Array;
  if (dbMode() === "memory") snapshot = db().serialize();
  else {
    const tmp = join(tmpdir(), `mea-export-${Date.now()}.db`);
    db().exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    snapshot = readFileSync(tmp);
    unlinkSync(tmp);
  }
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    "mea.db": snapshot,
    "manifest.json": strToU8(JSON.stringify({ app: "mea", format: 1, exportedAt: new Date().toISOString(), note: "API keys are encrypted with this machine's key file and won't work elsewhere." }, null, 2)),
  };
  // Files only: images/deleted/ (M36) holds purged images and isn't part of the library.
  for (const f of readdirSync(paths.images, { withFileTypes: true })) if (f.isFile()) files[`images/${f.name}`] = [readFileSync(join(paths.images, f.name)), { level: 0 }];
  return zipSync(files as Parameters<typeof zipSync>[0], { level: 6 });
}

export function chatTitleFor(chatId: string) {
  return (getChatRow(chatId)?.title ?? "chat").replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "chat";
}
