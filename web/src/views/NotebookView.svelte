<script lang="ts">
  import NotesPanel from "../components/notes/NotesPanel.svelte";
  import { NotebookPen } from "../lib/icons";
</script>

<div class="page stack">
  <header class="row"><NotebookPen size={22} /><h1>Notebook</h1></header>
  <p class="small muted">Every note, from every chat and the global ones, and your best moments across all your stories.</p>
  <NotesPanel />
</div>

<style>
  .page {
    max-width: 46rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }
  header {
    gap: 0.5rem;
  }
  h1 {
    margin: 0;
  }
</style>
