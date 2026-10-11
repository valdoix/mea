/**
 * P1: anything in a chat can ask for a side dock tab to open (a Status tile, a chip). The chat
 * screen watches `dockRequest` and opens the tab (and the panel, or the sheet on phones).
 */
export type DockTab = "chat" | "memory" | "story" | "world" | "meus" | "notes";

export const dockRequest = $state<{ tab: DockTab | null; section: string | null; seq: number }>({ tab: null, section: null, seq: 0 });

export function openDock(tab: DockTab, section?: string) {
  dockRequest.tab = tab;
  dockRequest.section = section ?? null;
  dockRequest.seq++;
}
