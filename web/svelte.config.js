import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess({ script: false }),
  compilerOptions: { runes: true },
};
