/** Promise-based confirm / prompt dialogs rendered by <Dialogs />. */

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface PromptState {
  title: string;
  label: string;
  value: string;
  placeholder: string;
  multiline: boolean;
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

export const dialogs = $state({ confirm: null as ConfirmState | null, prompt: null as PromptState | null });

/**
 * L15: a second dialog waits for the one showing instead of replacing it (which left the first
 * caller waiting forever). The short pause lets the first close, so a quick second Enter can't
 * answer the next one.
 */
const lines = { confirm: { queue: Promise.resolve() as Promise<unknown>, waiting: 0 }, prompt: { queue: Promise.resolve() as Promise<unknown>, waiting: 0 } };
function inTurn<T>(kind: keyof typeof lines, show: () => Promise<T>): Promise<T> {
  const line = lines[kind];
  const later = line.waiting > 0;
  line.waiting++;
  const p = line.queue.then(() => (later ? new Promise((r) => setTimeout(r, 250)) : null)).then(show);
  line.queue = p.catch(() => {}).finally(() => line.waiting--);
  return p;
}

export function confirm(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return inTurn(
    "confirm",
    () =>
      new Promise<boolean>((resolve) => {
        dialogs.confirm = { title: opts.title, message: opts.message ?? "", confirmLabel: opts.confirmLabel ?? "Confirm", danger: opts.danger ?? false, resolve };
      }),
  );
}

export function promptText(opts: { title: string; label?: string; value?: string; placeholder?: string; multiline?: boolean; confirmLabel?: string }): Promise<string | null> {
  return inTurn("prompt", () => new Promise<string | null>((resolve) => {
    dialogs.prompt = {
      title: opts.title,
      label: opts.label ?? "",
      value: opts.value ?? "",
      placeholder: opts.placeholder ?? "",
      multiline: opts.multiline ?? false,
      confirmLabel: opts.confirmLabel ?? "OK",
      resolve,
    };
  }));
}
