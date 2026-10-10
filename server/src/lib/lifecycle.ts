/**
 * A clean stop on request (ARCH-09). On Windows, ending the Scheduled Task kills the process without
 * a signal, so the shutdown work (saving the encrypted database) never runs. Scripts ask first instead.
 */
let handler: (() => void) | null = null;

export function onShutdown(fn: () => void) {
  handler = fn;
}

export function requestShutdown() {
  setTimeout(() => (handler ? handler() : process.exit(0)), 100);
}
