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

export function confirm(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    dialogs.confirm = { title: opts.title, message: opts.message ?? "", confirmLabel: opts.confirmLabel ?? "Confirm", danger: opts.danger ?? false, resolve };
  });
}

export function promptText(opts: { title: string; label?: string; value?: string; placeholder?: string; multiline?: boolean; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs.prompt = {
      title: opts.title,
      label: opts.label ?? "",
      value: opts.value ?? "",
      placeholder: opts.placeholder ?? "",
      multiline: opts.multiline ?? false,
      confirmLabel: opts.confirmLabel ?? "OK",
      resolve,
    };
  });
}
