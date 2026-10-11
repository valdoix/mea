<script lang="ts">
  import Module from "../desk/Module.svelte";
  import StatusLamps, { type Lamp } from "./StatusLamps.svelte";
  import { get } from "../../lib/api";
  import { openDock } from "../../lib/dock.svelte";
  import { onEvent } from "../../lib/events";
  import { navigate } from "../../lib/router.svelte";
  import { sugg } from "../../lib/suggestions.svelte";

  /**
   * P1: the Chat tab's Status. Suggestions waiting in the Inbox, then the tiles features register
   * on the server (services/status.ts). Each tile opens what it counts.
   */
  let { chatId }: { chatId: string } = $props();

  interface Tile {
    id: string;
    n: number;
    label: string;
    tone: "amber" | "red" | "blue";
    value?: string;
    title?: string;
    open?: { href: string } | { dock: "chat" | "memory" | "story" | "world" | "meus" | "notes"; section?: string } | { inbox: string };
  }
  let tiles = $state<Tile[]>([]);
  async function load() {
    try {
      tiles = (await get<{ tiles: Tile[] }>(`/api/chats/${chatId}/status`)).tiles;
    } catch {
      tiles = [];
    }
  }
  $effect(() => {
    void chatId;
    void load();
  });
  let timer: ReturnType<typeof setTimeout>;
  $effect(() =>
    onEvent((e) => {
      if ((("chatId" in e && e.chatId === chatId) || e.type === "inbox.changed" || e.type === "reconnected") && e.type !== "gen.delta") {
        clearTimeout(timer);
        timer = setTimeout(load, 1200);
      }
    }),
  );

  const opener = (t: Tile) => {
    const o = t.open;
    if (!o) return undefined;
    if ("href" in o) return () => navigate(o.href);
    if ("dock" in o) return () => openDock(o.dock, o.section);
    return () => navigate(`/inbox?chat=${encodeURIComponent(chatId)}&source=${o.inbox}`);
  };
  const lamps = $derived<Lamp[]>([
    { n: sugg.count, label: `suggestion${sugg.count === 1 ? "" : "s"} waiting`, tone: "blue", href: `/inbox?chat=${encodeURIComponent(chatId)}`, title: "Open this story's suggestions in the Inbox" },
    ...tiles.map((t) => ({ n: t.n, label: t.label, tone: t.tone, value: t.value, title: t.title, onclick: opener(t) })),
  ]);
  const lit = $derived(lamps.filter((l) => l.n).length);
</script>

<Module title="Status" led={lit ? "warm" : "ok"} peek={lit ? `${lit} to look at` : "All clear"}>
  <StatusLamps {lamps} />
</Module>
