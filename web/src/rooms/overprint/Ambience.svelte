<script lang="ts">
  import { app } from "../../lib/state.svelte";

  // Overprint's press sheet: two halftone screens, rings of ink slightly out of register, and the
  // printer's marks.
</script>

<i class="dots pink"></i><i class="dots blue"></i>
<i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i><i class="ring r4"></i>
<span class="reg rg1"></span><span class="reg rg2"></span>
<span class="slug">Mea · two-colour edition · pass {app.night ? "02" : "01"}</span>

<style>
  .dots {
    inset: -40px;
    opacity: 0.22;
    -webkit-mask: radial-gradient(70% 60% at var(--mx) var(--my), #000, transparent 70%);
    mask: radial-gradient(70% 60% at var(--mx) var(--my), #000, transparent 70%);
    animation: dots 60s linear infinite;
  }
  .dots.pink {
    --mx: 88%;
    --my: 10%;
    background: radial-gradient(circle, var(--accent) 1.6px, transparent 2.2px) 0 0 / 11px 11px;
  }
  .dots.blue {
    --mx: 10%;
    --my: 92%;
    background: radial-gradient(circle, var(--sig2) 1.6px, transparent 2.2px) 3px 4px / 11px 11px;
    animation-direction: reverse;
  }
  :global(.amb.night) .dots {
    opacity: 0.2;
  }
  @keyframes dots {
    to {
      transform: translate(33px, 22px);
    }
  }
  .ring {
    border-radius: 50%;
    mix-blend-mode: multiply;
    opacity: 0.22;
    animation: register 9s ease-in-out infinite alternate;
  }
  :global(.amb.night) .ring {
    mix-blend-mode: screen;
    opacity: 0.16;
  }
  .r1 {
    width: 420px;
    height: 420px;
    right: -120px;
    top: 8%;
    background: var(--accent);
  }
  .r2 {
    width: 300px;
    height: 300px;
    right: 120px;
    top: 30%;
    background: var(--sig2);
    animation-duration: 11s;
    animation-direction: alternate-reverse;
  }
  .r3 {
    width: 240px;
    height: 240px;
    left: -60px;
    bottom: 6%;
    background: var(--sig1);
    opacity: 0.4;
    animation-duration: 13s;
  }
  :global(.amb.night) .r3 {
    opacity: 0.12;
  }
  .r4 {
    width: 140px;
    height: 140px;
    left: 130px;
    bottom: 22%;
    background: transparent;
    border: 14px solid var(--accent);
    opacity: 0.18;
    animation-duration: 7s;
  }
  @keyframes register {
    0%,
    100% {
      translate: 0 0;
    }
    45% {
      translate: 5px -3px;
    }
    50% {
      translate: -2px 2px;
    }
    55% {
      translate: 3px 1px;
    }
  }
  .reg {
    width: 22px;
    height: 22px;
    opacity: 0.45;
    background:
      linear-gradient(var(--text), var(--text)) center / 1px 100% no-repeat,
      linear-gradient(var(--text), var(--text)) center / 100% 1px no-repeat;
  }
  .reg::after {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    border: 1px solid var(--text);
  }
  .rg1 {
    right: 18px;
    top: 18px;
  }
  .rg2 {
    left: 18px;
    bottom: 18px;
  }
  .slug {
    right: 48px;
    bottom: 16px;
    font: 400 10px var(--font-meta, monospace);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    opacity: 0.7;
  }
</style>
