/** F2: the Director's Desk lives in the composer's tray; on phones a header button asks for it. */
export const deskRequest = $state<{ seq: number }>({ seq: 0 });

export function openDesk() {
  deskRequest.seq++;
}
