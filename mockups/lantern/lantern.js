/* Mea · Lantern prototype. Plain JS, no build step. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("lantern." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("lantern." + k, JSON.stringify(v)); } catch {} },
  };

  /* ------------------------------------------------------------------ icons */
  const I = {
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    bookopen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    pen: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    redo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    cards: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/>',
    bubble: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    panelL: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    panelR: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    focus: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
    dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    flask: '<path d="M9 3h6M10 3v7.4L4.6 19A2 2 0 0 0 6.3 22h11.4a2 2 0 0 0 1.7-3L14 10.4V3"/><path d="M6.5 15h11"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    list: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1M4 12h1M4 18h1"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    feather: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
    scroll: '<path d="M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
    slash: '<path d="M22 2 2 22"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 11.999 2z"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const icon = (n, style = "") => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="${style}">${I[n] || ""}</svg>`;
  const paintIcons = (root = document) => $$("i[data-i]", root).forEach((el) => (el.outerHTML = icon(el.dataset.i, el.getAttribute("style") || "")));

  /* -------------------------------------------------------------------- art */
  let uid = 0;
  const ART = {
    wren(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#211845"/><stop offset=".7" stop-color="#6b3f86"/><stop offset="1" stop-color="#b8607e"/></linearGradient>
        <radialGradient id="g${u}"><stop offset="0" stop-color="#ffd08f" stop-opacity=".95"/><stop offset="1" stop-color="#ffd08f" stop-opacity="0"/></radialGradient>
        <linearGradient id="b${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe6b8" stop-opacity=".75"/><stop offset="1" stop-color="#ffe6b8" stop-opacity="0"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/>
        <g fill="#fff">${stars(u, 14, 0, 0, 100, 70)}</g>
        <polygon points="50,48 140,26 140,72" fill="url(#b${u})"><animateTransform attributeName="transform" type="rotate" values="-14 50 48;14 50 48;-14 50 48" dur="7s" repeatCount="indefinite"/></polygon>
        <circle cx="50" cy="46" r="20" fill="url(#g${u})"><animate attributeName="r" values="16;24;16" dur="3.4s" repeatCount="indefinite"/></circle>
        <path d="M0 104 Q 25 96 50 102 T 100 100 V130 H0Z" fill="#1e7a80"/>
        <path d="M41 104 L44 54 H56 L59 104Z" fill="#f4ecf6"/>
        <path d="M43.4 66 H56.6 L57 72 H43Z M42.6 82 H57.4 L57.9 88 H42.1Z" fill="#ff9ec0"/>
        <rect x="45" y="42" width="10" height="12" fill="#ffd08f"/><path d="M42 42 L50 33 L58 42Z" fill="#c7b4ff"/><rect x="41" y="54" width="18" height="2.5" fill="#c7b4ff"/>
        <path d="M0 112 Q 25 106 50 112 T 100 110 V130 H0Z" fill="#103f4a"><animate attributeName="d" values="M0 112 Q 25 106 50 112 T 100 110 V130 H0Z;M0 111 Q 25 116 50 110 T 100 112 V130 H0Z;M0 112 Q 25 106 50 112 T 100 110 V130 H0Z" dur="6s" repeatCount="indefinite"/></path>`;
    },
    ilse(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2458"/><stop offset=".55" stop-color="#c46a7e"/><stop offset="1" stop-color="#ffcf9a"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/><circle cx="72" cy="88" r="18" fill="#ffe2b0" opacity=".85"/>
        <g fill="#fff" opacity=".22"><ellipse cx="20" cy="96" rx="30" ry="7"/><ellipse cx="80" cy="108" rx="34" ry="8"/><ellipse cx="40" cy="116" rx="40" ry="8"/></g>
        <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="4s" repeatCount="indefinite"/>
          <ellipse cx="44" cy="50" rx="30" ry="12" fill="#c7b4ff"/><path d="M14 50 H74" stroke="#7a5aa8" stroke-width="1"/><path d="M20 44 Q44 36 68 44" stroke="#7a5aa8" fill="none"/>
          <path d="M70 50 L80 42 L80 58Z" fill="#9b84d6"/><rect x="36" y="64" width="18" height="7" rx="2" fill="#5b3f7a"/><path d="M38 62 L36 64 M52 62 L54 64" stroke="#5b3f7a"/></g>`;
    },
    moth(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170f30"/><stop offset="1" stop-color="#4a2c6e"/></linearGradient><radialGradient id="g${u}"><stop offset="0" stop-color="#ffd08f" stop-opacity=".7"/><stop offset="1" stop-color="#ffd08f" stop-opacity="0"/></radialGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/>
        ${[0, 1, 2, 3].map((r) => `<rect x="0" y="${30 + r * 26}" width="100" height="2" fill="#2d1d4a"/>` + Array.from({ length: 12 }, (_, i) => `<rect x="${2 + i * 8.2}" y="${14 + r * 26 + (i % 3) * 2}" width="6.5" height="${16 - (i % 3) * 2}" fill="${["#3d2a62", "#5a3a7e", "#2f2350", "#6b4a8c"][(i + r) % 4]}"/>`).join("")).join("")}
        <circle cx="50" cy="62" r="34" fill="url(#g${u})"/>
        <g transform="translate(50 62)"><g><animateTransform attributeName="transform" type="scale" values="1 1;.55 1;1 1" dur="1.6s" repeatCount="indefinite"/>
          <path d="M0 0 C -14 -16 -26 -10 -22 2 C -26 12 -12 16 0 4Z" fill="#ffe2c2"/><path d="M0 0 C 14 -16 26 -10 22 2 C 26 12 12 16 0 4Z" fill="#ffe2c2"/>
          <circle cx="-12" cy="-2" r="3" fill="#c7b4ff"/><circle cx="12" cy="-2" r="3" fill="#c7b4ff"/></g><rect x="-1.2" y="-6" width="2.4" height="14" rx="1.2" fill="#3d2a62"/></g>`;
    },
    kestrel(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1024"/><stop offset=".6" stop-color="#b8452f"/><stop offset="1" stop-color="#ffb86b"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/>
        <path d="M-5 130 L38 62 L48 70 L58 58 L105 130Z" fill="#1d0c18"/><path d="M44 66 L48 70 L52 64 L50 90 L46 86Z" fill="#ff8a4a" opacity=".85"><animate attributeName="opacity" values=".5;1;.5" dur="2s" repeatCount="indefinite"/></path>
        <g fill="#ffd9c0">${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 37) % 100}" cy="${(i * 23) % 60}" r="${0.6 + (i % 3) * 0.4}" opacity=".7"><animateTransform attributeName="transform" type="translate" values="0 0;${(i % 5) - 2} 40" dur="${5 + (i % 4)}s" repeatCount="indefinite"/></circle>`).join("")}</g>
        <path d="M30 34 q6 -5 12 0 q6 -5 12 0" stroke="#1d0c18" stroke-width="2.2" fill="none" stroke-linecap="round"><animateTransform attributeName="transform" type="translate" values="0 0;8 -3;0 0" dur="6s" repeatCount="indefinite"/></path>`;
    },
    okonkwo(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e2638"/><stop offset="1" stop-color="#2d6e78"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/><g fill="#fff">${stars(u, 8, 0, 0, 100, 50)}</g>
        <circle cx="70" cy="30" r="13" fill="#f6efd8"/><circle cx="76" cy="26" r="12" fill="#14324a"/>
        <rect x="14" y="62" width="72" height="70" fill="#123040"/>
        ${Array.from({ length: 12 }, (_, i) => `<rect x="${20 + (i % 4) * 16}" y="${70 + Math.floor(i / 4) * 16}" width="10" height="10" rx="1" fill="${[1, 4, 6, 9, 11].includes(i) ? "#ffd08f" : "#1d4556"}"/>`).join("")}
        <path d="M46 48 h8 v-8 h6 v8 h8 v6 h-8 v8 h-6 v-8 h-8z" fill="#ff9ec0" opacity=".9"/>`;
    },
    ash(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2748"/><stop offset="1" stop-color="#4b6aa2"/></linearGradient><radialGradient id="g${u}"><stop offset="0" stop-color="#ffd08f"/><stop offset="1" stop-color="#ffd08f" stop-opacity="0"/></radialGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/>
        <g stroke="#9cc4ff" stroke-width=".8" opacity=".5">${Array.from({ length: 16 }, (_, i) => `<path d="M${(i * 13) % 100} ${(i * 29) % 70} l-3 9"/>`).join("")}</g>
        <path d="M0 86 Q 25 80 50 86 T 100 84 V130 H0Z" fill="#203a66"/>
        <g><animateTransform attributeName="transform" type="rotate" values="-3 50 86;3 50 86;-3 50 86" dur="4s" repeatCount="indefinite"/>
          <path d="M24 84 H76 L68 96 H32Z" fill="#c98a5a"/><path d="M50 84 L50 58" stroke="#e9dccb" stroke-width="1.5"/><circle cx="58" cy="70" r="9" fill="url(#g${u})"/><rect x="56" y="67" width="4" height="6" rx="1" fill="#ffd08f"/></g>
        <path d="M0 98 Q 25 92 50 98 T 100 96 V130 H0Z" fill="#162c50"/>`;
    },
    mara(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1b3a"/><stop offset="1" stop-color="#8a4a72"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/>
        ${[[30, 80, "#ff9ec0"], [62, 70, "#ffd08f"], [46, 96, "#c7b4ff"], [76, 98, "#ff9ec0"], [18, 104, "#82e3d3"]].map(([x, y, c]) => `<path d="M${x} 130 Q ${x - 4} ${y + 20} ${x} ${y}" stroke="#4f8f7a" stroke-width="1.6" fill="none"/>` + [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${y - 5}" rx="3" ry="5.5" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join("") + `<circle cx="${x}" cy="${y}" r="2.4" fill="#fff3"/>`).join("")}`;
    },
    stranger(u) {
      return `<defs><linearGradient id="s${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1c2c"/><stop offset="1" stop-color="#55557a"/></linearGradient></defs>
        <rect width="100" height="130" fill="url(#s${u})"/><g fill="#fff" opacity=".08"><ellipse cx="30" cy="80" rx="60" ry="10"/><ellipse cx="70" cy="100" rx="60" ry="12"/></g>
        <path d="M38 130 L42 80 Q50 70 58 80 L62 130Z" fill="#0f0f1a"/><circle cx="50" cy="68" r="8" fill="#0f0f1a"/><path d="M36 64 H64 L58 60 H42Z" fill="#0f0f1a"/><circle cx="53" cy="68" r="1" fill="#ffd08f"><animate attributeName="opacity" values="1;0;1" dur="4s" repeatCount="indefinite"/></circle>`;
    },
  };
  function stars(u, n, x0, y0, w, h) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i * 53 + u * 7) % w), y = y0 + ((i * 31 + u * 11) % h), r = 0.4 + (i % 3) * 0.3;
      s += `<circle cx="${x}" cy="${y}" r="${r}"><animate attributeName="opacity" values="1;.2;1" dur="${2 + (i % 4)}s" begin="${i * 0.3}s" repeatCount="indefinite"/></circle>`;
    }
    return s;
  }
  const art = (key) => {
    const [name] = key.split("-");
    const u = ++uid;
    return `<svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${(ART[name] || ART.wren)(u)}</svg>`;
  };
  const paintArt = (root = document) => $$("[data-art]", root).forEach((el) => { if (!el.dataset.painted) { el.innerHTML = art(el.dataset.art); el.dataset.painted = "1"; } });

  /* ------------------------------------------------------------------- data */
  const CHARS = [
    { id: "wren", name: "Wren Halloway", line: "Keeper of the Gull's Reach light", tags: ["slow burn", "coastal"], chats: 3, live: true },
    { id: "ilse", name: "Captain Ilse Varga", line: "Airship captain, owes everyone money", tags: ["adventure", "banter"], chats: 5, dot: true },
    { id: "moth", name: "Moth", line: "Night librarian of the Paper Library", tags: ["cozy", "mystery"], chats: 2 },
    { id: "kestrel", name: "Kestrel", line: "Survivor of the long ashfall", tags: ["survival", "grief"], chats: 1 },
    { id: "okonkwo", name: "Dr. Okonkwo", line: "Night shift, St. Brigid's, ward eleven", tags: ["slice of life"], chats: 4 },
  ];
  const STORIES = [
    { id: "wren", title: "The Lamp at Gull's Reach", who: "Wren Halloway" },
    { id: "ilse", title: "Brass & Thunder", who: "Captain Ilse Varga", dot: true },
    { id: "moth", title: "The Paper Library", who: "Moth" },
  ];

  /* -------------------------------------------------------------------- sky */
  const flies = $("#flies");
  for (let n = 0; n < 26; n++) {
    const f = document.createElement("span");
    f.className = "fly";
    Object.assign(f.style, { left: Math.random() * 100 + "%", top: Math.random() * 100 + "%" });
    f.style.setProperty("--x", Math.random() * 180 - 90 + "px");
    f.style.setProperty("--y", Math.random() * 180 - 90 + "px");
    f.style.setProperty("--d", 9 + Math.random() * 12 + "s");
    f.style.animationDelay = `0s, ${Math.random() * 3}s`;
    flies.appendChild(f);
  }

  /* ---------------------------------------------------------------- helpers */
  function placeThumb(seg) {
    const thumb = $(".thumb", seg), on = $("button.on", seg);
    if (!thumb || !on || !on.offsetWidth) return;
    thumb.style.width = on.offsetWidth + "px";
    thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`;
  }
  function seg(el, onChange) {
    $$("button", el).forEach((b) => b.addEventListener("click", () => {
      $$("button", el).forEach((x) => x.classList.toggle("on", x === b));
      placeThumb(el);
      onChange?.(b);
    }));
    requestAnimationFrame(() => placeThumb(el));
  }
  const layoutSegs = () => $$(".seg, .dock-tabs").forEach(placeThumb);
  addEventListener("resize", layoutSegs);

  let toastTimer;
  function toast(t) {
    $("#toast-t").textContent = t;
    $("#toast").classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("on"), 2600);
  }
  function sparkle(x, y, n = 12) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "sparkle";
      s.textContent = ["✦", "✧", "·", "✦"][i % 4];
      s.style.left = x + "px"; s.style.top = y + "px";
      const a = (Math.PI * 2 * i) / n, r = 40 + Math.random() * 50;
      s.style.setProperty("--dx", Math.cos(a) * r + "px");
      s.style.setProperty("--dy", Math.sin(a) * r - 20 + "px");
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }
  const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

  /* ----------------------------------------------------------- shell state */
  const isDesk = () => innerWidth > 1100;
  const state = { rail: { chat: store.get("railChat", false), other: store.get("railOther", true) }, dock: store.get("dock", true), focus: false, view: "home" };
  function applyShell() {
    const inChat = state.view === "chat";
    document.body.classList.toggle("no-rail", !(inChat ? state.rail.chat : state.rail.other));
    document.body.classList.toggle("no-dock", !state.dock);
    document.body.classList.toggle("dock-open-m", state.dock && !isDesk());
    document.body.classList.toggle("focus", state.focus && inChat);
    $$('[data-act="rail"]').forEach((b) => b.classList.toggle("on", inChat ? state.rail.chat : state.rail.other));
    $$('[data-act="dock"]').forEach((b) => b.classList.toggle("on", state.dock));
    $$('[data-act="focus"]').forEach((b) => b.classList.toggle("on", state.focus));
    setTimeout(layoutSegs, 620);
  }
  const act = {
    rail() { const k = state.view === "chat" ? "chat" : "other"; state.rail[k] = !state.rail[k]; store.set(k === "chat" ? "railChat" : "railOther", state.rail[k]); applyShell(); },
    dock() { if (state.view !== "chat") return; state.dock = !state.dock; store.set("dock", state.dock); applyShell(); },
    focus() { if (state.view !== "chat") return; state.focus = !state.focus; applyShell();  },
    palette: () => openPalette(),
    "close-palette": () => closePalette(),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && act[b.dataset.act]) { e.preventDefault(); act[b.dataset.act](); }
  });
  $("#reveal").addEventListener("click", () => act.rail());

  /* ----------------------------------------------------------------- router */
  const VIEWS = ["home", "chat", "read", "character", "personas", "studio", "lore", "presets", "notebook", "inbox", "settings", "codex", "memory", "world"];
  function route() {
    const name = (location.hash.replace(/^#\/?/, "").split("/")[0] || "home");
    const v = VIEWS.includes(name) ? name : "home";
    state.view = v;
    document.body.dataset.view = v;
    if (v !== "chat") state.focus = false;
    $$(".view").forEach((s) => s.classList.toggle("on", s.dataset.view === v));
    const navKey = { chat: "home", read: "home", character: "home", codex: "home", memory: "home", world: "home" }[v] || v;
    $$(".rail .nav[data-route]").forEach((a) => a.classList.toggle("on", a.dataset.route === navKey));
    $$(".story-orb").forEach((o) => o.classList.toggle("on", v === "chat" && o.dataset.id === "wren"));
    applyShell();
    paintArt($(`.view[data-view="${v}"]`));
    requestAnimationFrame(layoutSegs);
    if (v === "chat") requestAnimationFrame(() => { const f = $("#feed"); f.style.scrollBehavior = "auto"; f.scrollTop = f.scrollHeight; f.style.scrollBehavior = ""; });
  }
  addEventListener("hashchange", route);

  /* ------------------------------------------------------------------ keys */
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") {
      if ($("#palette").classList.contains("on")) return closePalette();
      if (state.focus) { state.focus = false; applyShell(); }
      return;
    }
    if (typing(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "[") act.rail();
    else if (e.key === "]") act.dock();
    else if (e.key.toLowerCase() === "f") act.focus();
    else if (state.view === "chat" && ["1", "2", "3"].includes(e.key)) setStyle(["cards", "book", "bubbles"][+e.key - 1]);
  });

  /* ------------------------------------------------------------ rail orbs */
  $("#rail-stories").innerHTML = STORIES.map((s) => `<a class="story-orb" href="#/chat" data-id="${s.id}"><span class="orb" data-art="${s.id}"></span>${s.dot ? '<span class="dot"></span>' : ""}<span class="tip">${s.title} · ${s.who}</span></a>`).join("");

  /* ------------------------------------------------------------- chat style */
  const feedInner = $("#feed-inner");
  function setStyle(s, quiet) {
    feedInner.className = "feed-inner style-" + s;
    feedInner.style.animation = "none"; void feedInner.offsetWidth; feedInner.style.animation = "viewin .6s var(--ease)";
    $$("#style-seg button").forEach((b) => b.classList.toggle("on", b.dataset.style === s));
    placeThumb($("#style-seg"));
    $$('.choice[data-style]').forEach((c) => c.classList.toggle("on", c.dataset.style === s));
    store.set("style", s);
    if (!quiet) toast(`${s[0].toUpperCase() + s.slice(1)} style`);
  }
  $$("#style-seg button").forEach((b) => b.addEventListener("click", () => setStyle(b.dataset.style)));
  setStyle(store.get("style", "cards"), true);

  /* --------------------------------------------------------------- dock */
  const dockTabs = $("#dock-tabs");
  seg(dockTabs, (b) => $$(".pane").forEach((p) => p.classList.toggle("on", p.dataset.p === b.dataset.p)));
  const G = [["Trust", 62, "#ff9ec0", "rising ↑"], ["Warmth", 48, "#ffd08f", "thawing"], ["Tension", 71, "#c7b4ff", "stormy"]];
  $("#gauges").innerHTML = G.map(([n, v, c, s]) => `<div class="gauge"><svg viewBox="0 0 70 70"><circle cx="35" cy="35" r="28" stroke="rgb(255 255 255 / 9%)" stroke-width="6" fill="none"/><circle class="arc" cx="35" cy="35" r="28" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="${(v / 100) * 176} 176" transform="rotate(-90 35 35)" style="filter:drop-shadow(0 0 4px ${c})"/><text x="35" y="40" text-anchor="middle" fill="#f5eef7" font-size="15" font-family="Manrope" font-weight="700">${v}</text></svg><b>${n}</b><small>${s}</small></div>`).join("");
  $$(".nudges button.chip").forEach((b) => b.addEventListener("click", () => b.classList.toggle("on")));

  /* ------------------------------------------------------------ composer */
  const say = $("#say"), feed = $("#feed");
  say.addEventListener("input", () => { say.style.height = "auto"; say.style.height = Math.min(say.scrollHeight, 160) + "px"; });
  const REPLIES = [
    ["<span class=\"a\">Wren snorts into her mug, which is nearly a laugh.</span> <span class=\"d\">“Don't let it go to your head. The stairs are still mine.”</span>", "<span class=\"t\">He stayed. He actually stayed.</span>"],
    ["<span class=\"a\">The lens turns. Somewhere below, the sea throws itself at the rocks and loses, again.</span> <span class=\"d\">“Tamsin used to sit there,”</span> she says, and then looks as if she wishes she hadn't."],
    ["<span class=\"d\">“Tide's turning,”</span> <span class=\"a\">she says, though neither of them moves toward the door.</span>"],
  ];
  let replyN = 0;
  function msgHTML(who, html, extra = "") {
    const user = who === "Ash";
    return `<div class="av"><span class="orb" data-art="${user ? "ash" : "wren"}"></span></div><div class="body hair">${extra}<div class="mh"><span class="nm">${who}</span><span class="when">${user ? "just now" : "writing…"}</span>${user ? "" : '<span class="sw"></span>'}<span class="acts" ${user ? 'style="margin-left:auto"' : ""}><button class="ib" title="Edit">${icon("pen")}</button></span></div><div class="tx">${html}</div></div>`;
  }
  function send() {
    const text = say.value.trim();
    if (!text) return;
    const m = document.createElement("article");
    m.className = "msg user";
    const p = document.createElement("p"); p.textContent = text;
    m.innerHTML = msgHTML("Ash", p.outerHTML);
    feedInner.appendChild(m); paintArt(m);
    say.value = ""; say.style.height = "auto";
    $$(".msg.live").forEach((x) => { x.classList.remove("live"); $(".when", x).textContent = "night · 2nd bell"; $(".caret", x)?.remove(); $(".sw", x).innerHTML = ""; });
    feed.scrollTop = feed.scrollHeight;
    setTimeout(() => stream(REPLIES[replyN++ % REPLIES.length]), 700);
  }
  function stream(paras) {
    const m = document.createElement("article");
    m.className = "msg ai live";
    m.innerHTML = msgHTML("Wren", '<p><span class="typing"><i></i><i></i><i></i></span></p>');
    feedInner.appendChild(m); paintArt(m);
    feed.scrollTop = feed.scrollHeight;
    const tx = $(".tx", m);
    const full = paras.map((x) => `<p>${x}</p>`).join("");
    const tmp = document.createElement("div"); tmp.innerHTML = full;
    const words = tmp.textContent.split(/(\s+)/);
    let i = 0;
    setTimeout(function tick() {
      i += 2;
      if (i < words.length) {
        tx.innerHTML = `<p>${words.slice(0, i).join("")}<span class="caret"></span></p>`;
        feed.scrollTop = feed.scrollHeight;
        setTimeout(tick, 45);
      } else {
        tx.innerHTML = full;
        m.classList.remove("live");
        $(".when", m).textContent = "night · 2nd bell";
        const mf = document.createElement("div");
        mf.className = "mf";
        mf.innerHTML = `<span class="chip lamp keep">${icon("sparkles")}Wren will remember this</span><span class="chip">${Math.round(words.length / 2)} words</span>`;
        $(".body", m).appendChild(mf);
        const r = mf.firstElementChild.getBoundingClientRect();
        sparkle(r.left + 20, r.top + 10);
        toast("A new memory was saved");
        feed.scrollTop = feed.scrollHeight;
      }
    }, 900);
  }
  $("#send").addEventListener("click", send);
  say.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $$(".msg .acts [title='Best moment']").forEach((b) => b.addEventListener("click", (e) => { sparkle(e.clientX, e.clientY); toast("Saved to best moments"); }));
  $$(".flag .btn").forEach((b) => b.addEventListener("click", () => { const f = b.closest(".flag"); f.style.transition = ".5s"; f.style.opacity = "0"; f.style.transform = "translateX(30px)"; setTimeout(() => f.remove(), 500); toast(b.classList.contains("warm") ? "Fixed: she sold eggs at the market once, as a girl" : "Kept both"); }));


  /* --------------------------------------------------------- popovers */
  function togglePop(id, force) {
    const pop = $("#pop-" + id);
    const on = force ?? !pop.classList.contains("on");
    $$(".pop.on").forEach((p) => p !== pop && p.classList.remove("on"));
    pop.classList.toggle("on", on);
    $$(`[data-pop="${id}"]`).forEach((b) => b.classList.toggle("on", on));
    if (on) requestAnimationFrame(() => $$(".seg", pop).forEach(placeThumb));
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pop]");
    if (b) { e.stopPropagation(); togglePop(b.dataset.pop); return; }
    if (!e.target.closest(".pop")) $$(".pop.on").forEach((p) => togglePop(p.id.replace("pop-", ""), false));
  });
  const syncPip = () => $(".opts-btn .pip").style.display = $$("#pop-compose .nudges button.chip.on").length ? "" : "none";
  $$("#pop-compose .nudges button.chip").forEach((b) => b.addEventListener("click", syncPip));
  syncPip();
  $("#ghost").addEventListener("click", () => { say.value = "I lean back and let the warmth of the stove do the talking for a while."; say.dispatchEvent(new Event("input")); togglePop("compose", false); say.focus(); toast("Drafted for you, edit away"); });

  /* ------------------------------------------------------- display */
  const PAD = { compact: ["12px", "16px"], cozy: ["18px", "24px"], airy: ["26px", "34px"] };
  const W = { 38: "Narrow", 48: "Comfortable", 60: "Wide", 100: "Full" };
  function applyDisplay() {
    const d = store.get("display", { w: 48, p: 76, pad: "cozy" });
    const root = document.documentElement.style;
    root.setProperty("--box-w", d.w >= 100 ? "100%" : d.w + "rem");
    root.setProperty("--portrait", d.p + "px");
    root.setProperty("--pad-y", PAD[d.pad][0]); root.setProperty("--pad-x", PAD[d.pad][1]);
    $("#w-label").textContent = W[d.w];
    $$("#width-seg button").forEach((b) => b.classList.toggle("on", +b.dataset.w === d.w));
    $$("#portrait-seg button").forEach((b) => b.classList.toggle("on", +b.dataset.p === d.p));
    $$("#pad-seg button").forEach((b) => b.classList.toggle("on", b.dataset.pad === d.pad));
    ["#width-seg", "#portrait-seg", "#pad-seg"].forEach((q) => placeThumb($(q)));
  }
  const setDisplay = (patch) => { store.set("display", { ...store.get("display", { w: 48, p: 76, pad: "cozy" }), ...patch }); applyDisplay(); };
  $$("#width-seg button").forEach((b) => b.addEventListener("click", () => setDisplay({ w: +b.dataset.w })));
  $$("#portrait-seg button").forEach((b) => b.addEventListener("click", () => setDisplay({ p: +b.dataset.p })));
  $$("#pad-seg button").forEach((b) => b.addEventListener("click", () => setDisplay({ pad: b.dataset.pad })));
  const popSize = $("#pop-size");
  popSize.value = store.get("size", 18);
  const syncSize = () => { popSize.style.setProperty("--p", ((popSize.value - 15) / 7) * 100 + "%"); document.documentElement.style.setProperty("--story-size", popSize.value + "px"); };
  popSize.addEventListener("input", () => { store.set("size", popSize.value); syncSize(); });
  syncSize();
  applyDisplay();

  /* ---------------------------------------------------------------- home */
  const hr = new Date().getHours();
  $("#greet-eyebrow").textContent = `${new Date().toLocaleDateString("en-GB", { weekday: "long" })} · ${hr < 5 ? "small hours" : hr < 12 ? "morning" : hr < 18 ? "afternoon" : "evening"}`;
  $(".view[data-view=home] .display").innerHTML = `${hr < 5 ? "Still up" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"}, <em>Ash.</em>`;
  $("#chars").innerHTML = CHARS.map((c) => `
    <a class="char hair" href="${c.id === "wren" ? "#/character" : "#/chat"}">
      <div class="art" data-art="${c.id}"></div><div class="shine"></div>
      ${c.live ? '<span class="chip sea badge-top" style="background:rgb(0 0 0 / 35%);backdrop-filter:blur(8px)">● in a story</span>' : c.dot ? '<span class="chip lamp badge-top" style="background:rgb(0 0 0 / 35%);backdrop-filter:blur(8px)">new reply</span>' : ""}
      <span class="fav">${icon("heart")}</span>
      <div class="info"><b>${c.name}</b><span>${c.line}</span><div class="tags">${c.tags.map((t) => `<span class="chip">${t}</span>`).join("")}<span class="chip">${c.chats} chats</span></div></div>
    </a>`).join("") + `<button class="char new"><div><div class="plus">${icon("plus")}</div><div class="h2" style="font-size:22px">New character</div><div class="tiny faint" style="margin-top:6px">from an idea, a card or a PNG</div></div></button>`;
  $$(".char:not(.new)").forEach((c) => {
    c.addEventListener("mousemove", (e) => {
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.transform = `perspective(900px) rotateY(${(x - 0.5) * 10}deg) rotateX(${(0.5 - y) * 10}deg) translateY(-4px)`;
      c.style.setProperty("--mx", x * 100 + "%"); c.style.setProperty("--my", y * 100 + "%");
    });
    c.addEventListener("mouseleave", () => (c.style.transform = ""));
  });
  seg($("#sort-seg"));

  /* ---------------------------------------------------------------- read */
  seg($("#read-theme"), (b) => $("#read").classList.toggle("paper", b.dataset.t === "paper"));
  let readSize = 20;
  $$("[data-size]").forEach((b) => b.addEventListener("click", () => { readSize = Math.max(16, Math.min(26, readSize + +b.dataset.size)); $("#read").style.setProperty("--read-size", readSize + "px"); }));

  /* ------------------------------------------------------------ character */
  seg($("#char-tabs")); $$("#char-tabs button").forEach((b) => b.addEventListener("click", () => $$("#char-tabs button").forEach((x) => x.classList.toggle("on", x === b))));

  /* ------------------------------------------------------------- personas */
  const PERSONAS = [["ash", "Ash", "he/him · rows when he shouldn't", true], ["mara", "Mara Quill", "she/her · gardener, liar, kind"], ["stranger", "The Stranger", "they/them · no one knows"]];
  $("#personas").innerHTML = PERSONAS.map(([a, n, d, on]) => `<button class="person card hair ${on ? "on" : ""}"><span class="orb" data-art="${a}"></span><b>${n}</b><span>${d}</span></button>`).join("") + `<button class="person card" style="border:1.5px dashed rgb(255 255 255 / 16%);background:none;display:grid;place-items:center;color:var(--muted)"><div><div class="plus" style="width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--fill);margin:0 auto 10px">${icon("plus")}</div>New persona</div></button>`;
  $$("#personas .person").forEach((p) => p.addEventListener("click", () => $$("#personas .person").forEach((x) => x.classList.toggle("on", x === p))));

  /* --------------------------------------------------------------- studio */
  seg($("#kind-seg"));
  const QS = [
    ["What does Ines want more than anything?", ["To find who's drawing the maps", "To stop the city moving", "To be forgiven for the street", "Something else…"]],
    ["Who is she with when the story opens?", ["Alone, as always", "A rival cartographer", "A cat who knows the way", "You decide"]],
    ["How dark should it get?", ["Cozy, with teeth", "Bittersweet", "Properly unsettling"]],
  ];
  $("#qa").innerHTML = QS.map(([q, os], i) => `<div style="${i ? "margin-top:22px;padding-top:18px;border-top:1px solid var(--edge)" : ""}"><div class="eyebrow" style="margin-bottom:8px">Question ${i + 1} of 6</div><div class="q">${q}</div><div class="opts">${os.map((o, j) => `<button class="chip ${i === 0 && j === 0 ? "on" : ""}" style="height:34px;padding:0 14px;font-size:13px">${o}</button>`).join("")}</div></div>`).join("");
  $$("#qa .opts").forEach((g) => $$("button", g).forEach((b) => b.addEventListener("click", () => $$("button", g).forEach((x) => x.classList.toggle("on", x === b)))));

  /* ----------------------------------------------------------------- lore */
  const TOMES = [["Gull's Reach", "18 entries · Wren", "linear-gradient(160deg,#2f6f78,#173c4a)", "⚓"], ["The Paper Library", "42 entries · Moth", "linear-gradient(160deg,#6b4a8c,#2d1d4a)", "✦"], ["Brass & Thunder", "27 entries · Ilse", "linear-gradient(160deg,#c46a7e,#5b3f7a)", "⚙"], ["Ashfall", "11 entries · Kestrel", "linear-gradient(160deg,#b8452f,#3a1420)", "▲"], ["Common folk", "64 entries · shared", "linear-gradient(160deg,#8a7d9e,#3a3350)", "❀"]];
  $("#tomes").innerHTML = `<div class="eyebrow" style="padding:10px 12px">Your lorebooks</div>` + TOMES.map(([n, d, c, g], i) => `<button class="tome ${i ? "" : "on"}"><span class="cover" style="--c:${c}">${g}</span><div class="grow"><b style="font-weight:600;display:block">${n}</b><span class="tiny faint">${d}</span></div></button>`).join("");
  $$(".tome").forEach((t) => t.addEventListener("click", () => $$(".tome").forEach((x) => x.classList.toggle("on", x === t))));
  const ENTRIES = [["The Old Eye", ["lens", "Old Eye", "Fresnel"], 82, "woke 31×"], ["Gull's Reach", ["island", "Reach"], 100, "always on"], ["Tamsin Halloway", ["Tamsin", "brother"], 44, "woke 12×"], ["The ferry", ["ferry", "ferryman"], 58, "woke 19×"], ["The harbourmaster", ["harbourmaster", "Pell"], 18, "woke 4×"], ["Mainland market", ["market", "mainland"], 9, "woke 2×"]];
  $("#entries").innerHTML = ENTRIES.map(([t, k, v, a], i) => `<div class="entry ${i ? "" : "on"}"><b>${t}</b><span class="act">${a}</span><div class="kw">${k.map((x) => `<span class="chip">${x}</span>`).join("")}</div><div class="bar meter-line" style="margin-top:6px"><i style="--v:${v}%"></i></div></div>`).join("");
  $$(".entry").forEach((t) => t.addEventListener("click", () => $$(".entry").forEach((x) => x.classList.toggle("on", x === t))));

  /* -------------------------------------------------------------- presets */
  $("#preset-pills").innerHTML = ["Lantern Default", "Slow Burn Prose", "Snappy & Bright", "Wayfarer Tuned", "Horror Hours"].map((n, i) => `<button class="chip ${i === 1 ? "on" : ""}" style="height:36px;padding:0 16px;font-size:13px">${n}</button>`).join("");
  $$("#preset-pills .chip").forEach((b) => b.addEventListener("click", () => $$("#preset-pills .chip").forEach((x) => x.classList.toggle("on", x === b))));
  const LAYERS = [["System", "Who Mea is and how to write", 820, "var(--lilac)", "cog"], ["Character", "Wren's card and voice", 1460, "var(--rose)", "heart"], ["Persona", "Ash", 180, "var(--sky)", "users"], ["Lore in play", "Wakes on keywords", 640, "var(--lamp)", "book"], ["Memory", "Summaries and recalled moments", 2210, "var(--sea)", "brain"], ["Chat history", "The most recent messages", 2420, "#e6d2ff", "bubble"], ["Author's note", "Slow burn. Weather has weight.", 190, "#ffc4a3", "feather"]];
  const layers = $("#layers");
  layers.innerHTML = LAYERS.map(([n, d, t, c, ic]) => `<div class="layer" draggable="true"><span class="grip">${icon("grip")}</span><span class="ic" style="--c:${c}">${icon(ic)}</span><div><b>${n}</b><span>${d}</span></div><div class="meter-line"><i style="--v:${(t / 2420) * 100}%;--c:${c};--glow:${c}"></i></div><span class="tok">${t.toLocaleString()}</span></div>`).join("");
  let dragged;
  $$(".layer", layers).forEach((l) => {
    l.addEventListener("dragstart", () => { dragged = l; l.style.opacity = ".4"; });
    l.addEventListener("dragend", () => { l.style.opacity = ""; toast("Layer order saved"); });
    l.addEventListener("dragover", (e) => { e.preventDefault(); const r = l.getBoundingClientRect(); if (dragged && dragged !== l) layers.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? l : l.nextSibling); });
  });
  const SAMP = [["Temperature", "How adventurous each word is", 0, 2, 0.01, 0.9], ["Top P", "Keep the likeliest words", 0, 1, 0.01, 0.95], ["Min P", "Drop the unlikely ones", 0, 0.3, 0.01, 0.05], ["Repetition", "Discourage repeats", 1, 1.5, 0.01, 1.08], ["Reply length", "Most tokens per reply", 100, 1200, 10, 420]];
  $("#samplers").insertAdjacentHTML("beforeend", SAMP.map(([n, d, mn, mx, st, v]) => `<div class="slider-row"><div><b>${n}</b><small>${d}</small></div><input class="range" type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" /><output>${v}</output></div>`).join(""));
  $$("input.range").forEach((r) => {
    const upd = () => { r.style.setProperty("--p", ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100 + "%"); const o = r.nextElementSibling; if (o?.tagName === "OUTPUT") o.textContent = r.value; };
    r.addEventListener("input", upd); upd();
  });

  /* ------------------------------------------------------------- notebook */
  const QUOTES = [
    ["best", "wren", "Gull's Reach · ch. III", "“That's either very brave or very stupid, and I haven't decided which I'd prefer.”"],
    ["hl", "moth", "The Paper Library · ch. II", "Moth refiled the letter under <span class=\"hl\">Regrets, unsent</span>, which was the largest section in the library and the only one she dusted daily."],
    ["note", "wren", "Your note · Gull's Reach", "No confession before chapter V. Let the mugs do the talking."],
    ["best", "ilse", "Brass & Thunder · ch. VII", "“I don't owe you money. I owe you <em>an experience</em>, and frankly you've had it.”"],
    ["hl", "okonkwo", "Night Shift · ch. IV", "<span class=\"hl\" style=\"--hl:rgb(130 227 211 / 30%)\">At four in the morning the ward belongs to the people who are awake</span>, and Dr. Okonkwo had long ago stopped minding which side of that she was on."],
    ["best", "kestrel", "Ashfall · ch. I", "“The sky's been grey for a year. I'd forgotten it could be anything else, until you said blue like it was nothing.”"],
    ["hl", "wren", "Gull's Reach · ch. I", "The last entry in Tamsin's handwriting: <span class=\"hl\" style=\"--hl:rgb(255 158 192 / 30%)\">Wind SW, fair, leaving.</span>"],
    ["note", "moth", "Your note · Paper Library", "What's in the locked stacks? Moth goes quiet every time. Find out in chapter III."],
  ];
  const renderQuotes = (k) => {
    $("#quotes").innerHTML = QUOTES.filter((q) => k === "all" || q[0] === k).map(([t, a, src, txt]) => `<div class="quote card hair ${t}"><span class="mark">${t === "note" ? "✎" : "“"}</span>${t === "best" ? '<div class="eyebrow lamp" style="margin-bottom:10px">★ Best moment</div>' : t === "hl" ? '<div class="eyebrow rose" style="margin-bottom:10px">Highlight</div>' : '<div class="eyebrow" style="margin-bottom:10px">Note</div>'}<p>${txt}</p><div class="src"><span class="orb" data-art="${a}"></span>${src}<button class="ib sm" style="margin-left:auto" title="Open in the chat">${icon("arrow")}</button></div></div>`).join("");
    paintArt($("#quotes"));
  };
  renderQuotes("all");
  seg($("#nb-seg"), (b) => renderQuotes(b.dataset.k));

  /* ---------------------------------------------------------------- inbox */
  const INBOX = [
    ["Continuity", "var(--amber)", "alert", "Gull's Reach · ch. III", "Wren said she's <b>never</b> left the island.", "“I've never set foot off this rock, and I don't intend to start for a <mark>parcel of oil</mark>.”", "“I haven't set foot off this rock <del>never</del> <ins>since the market closed</ins>, and I don't intend to start for a parcel of oil.”"],
    ["Names", "var(--lilac)", "users", "Gull's Reach · ch. III", "The harbourmaster changed name.", "“Mr. <mark>Bell</mark> will be counting boats till dawn.”", "“Mr. <del>Bell</del> <ins>Pell</ins> will be counting boats till dawn.” <span class='tiny faint'>· chapter I calls him Pell</span>"],
    ["Puppeting", "var(--rose)", "shield", "Brass & Thunder · ch. VII", "Ilse's reply decided what you felt.", "Ilse grins. <mark>You feel your heart skip as she takes the wheel.</mark>", "Ilse grins and takes the wheel. <del>You feel your heart skip.</del> <ins>“Hold on to something you like.”</ins>"],
    ["Drift", "var(--sea)", "pulse", "Gull's Reach · ch. III", "Wren thanked Ash warmly. She never says thank you.", "“<mark>Thank you so much</mark>, truly. You're wonderful.”", "“<del>Thank you so much, truly. You're wonderful.</del> <ins>…The kettle's on. That's all you're getting.</ins>”"],
  ];
  let left = INBOX.length;
  $("#inbox").innerHTML = INBOX.map(([k, c, ic, src, sum, ex, fix]) => `<div class="inbox-item card hair"><span class="kind" style="--c:${c}">${icon(ic)}</span><div><div class="row"><span class="eyebrow" style="color:${c}">${k}</span><span class="tiny faint">${src}</span></div><div class="h3" style="margin-top:6px;font-size:16px">${sum}</div><div class="excerpt">${ex}</div><div class="fix">${fix}</div><div class="row" style="gap:8px"><button class="btn sm" data-r="keep">Keep it</button><button class="btn sm primary" data-r="fix">${icon("sparkles")}Use the fix</button><span class="grow"></span><a class="btn sm ghost" href="#/chat">Open in the chat ${icon("arrow")}</a></div></div></div>`).join("");
  function resolve(item, how, e) {
    item.classList.add("gone");
    left--;
    $("#inbox-count").textContent = left || "No";
    $("#inbox-badge").textContent = left; $("#inbox-badge").style.display = left ? "" : "none";
    if (e) sparkle(e.clientX, e.clientY, 8);
    toast(how === "fix" ? "Fixed in the chat" : "Kept as written");
    setTimeout(() => { item.remove(); if (!left) $("#inbox").innerHTML = `<div class="card pad hair" style="text-align:center;padding:50px 20px"><div style="font-size:42px;color:var(--lamp);text-shadow:0 0 20px var(--lamp)">✦</div><div class="h2" style="margin:10px 0 6px">All clear</div><div class="muted">Every story is consistent. Go write something.</div></div>`; }, 600);
  }
  $$(".inbox-item [data-r]").forEach((b) => b.addEventListener("click", (e) => resolve(b.closest(".inbox-item"), b.dataset.r, e)));
  $("#fix-all").addEventListener("click", (e) => $$(".inbox-item:not(.gone)").forEach((it, i) => setTimeout(() => resolve(it, "fix", i ? null : e), i * 140)));
  $("#keep-all").addEventListener("click", () => $$(".inbox-item:not(.gone)").forEach((it, i) => setTimeout(() => resolve(it, "keep"), i * 140)));

  /* ------------------------------------------------------------- settings */
  const SW = (on) => `<label class="switch"><input type="checkbox" ${on ? "checked" : ""} /><i></i></label>`;
  const row = (b, s, ctl) => `<div class="setrow"><div class="grow"><b>${b}</b>${s ? `<small>${s}</small>` : ""}</div>${ctl}</div>`;
  const group = (title, rows) => `<div class="set-group card hair"><span class="eyebrow">${title}</span>${rows.join("")}</div>`;
  const chatPreview = {
    cards: `<div style="position:absolute;inset:10px;display:flex;flex-direction:column;gap:6px"><div style="display:flex;gap:6px"><i style="width:14px;height:14px;border-radius:50%;background:var(--grad-warm)"></i><i style="flex:1;height:30px;border-radius:8px;background:rgb(255 255 255 / 8%);box-shadow:inset 0 0 0 1px rgb(255 158 192 / 35%)"></i></div><div style="display:flex;gap:6px"><i style="width:14px;height:14px;border-radius:50%;background:#9cc4ff"></i><i style="flex:1;height:22px;border-radius:8px;background:rgb(156 196 255 / 14%);box-shadow:inset 0 0 0 1px rgb(156 196 255 / 35%)"></i></div><div style="display:flex;gap:6px"><i style="width:14px;height:14px;border-radius:50%;background:var(--grad-warm)"></i><i style="flex:1;height:24px;border-radius:8px;background:rgb(255 255 255 / 8%);box-shadow:inset 0 0 0 1px rgb(255 158 192 / 35%)"></i></div></div>`,
    book: `<div style="position:absolute;inset:12px 26px;display:flex;flex-direction:column;gap:5px">${[100, 92, 96, 60].map((w) => `<i style="height:4px;width:${w}%;border-radius:2px;background:rgb(255 255 255 / 22%)"></i>`).join("")}<i style="height:4px;width:80%;margin-left:10%;border-radius:2px;background:rgb(156 196 255 / 40%)"></i>${[100, 88, 70].map((w) => `<i style="height:4px;width:${w}%;border-radius:2px;background:rgb(255 255 255 / 22%)"></i>`).join("")}</div>`,
    bubbles: `<div style="position:absolute;inset:10px;display:flex;flex-direction:column;gap:6px"><i style="width:62%;height:22px;border-radius:12px 12px 12px 4px;background:rgb(255 255 255 / 12%)"></i><i style="width:50%;height:18px;border-radius:12px 12px 4px 12px;margin-left:auto;background:linear-gradient(135deg,rgb(120 160 255 / 45%),rgb(199 180 255 / 35%))"></i><i style="width:70%;height:22px;border-radius:12px 12px 12px 4px;background:rgb(255 255 255 / 12%)"></i></div>`,
  };
  const SECTIONS = [
    ["appearance", "Appearance", "palette", () => {
      const cur = store.get("style", "cards");
      return group("Chat style", [`<div class="choice-grid">${[["cards", "Cards", "Soft glowing blocks with portraits"], ["book", "Book", "Flowing prose, names in the margin"], ["bubbles", "Bubbles", "A messenger look"]].map(([k, n, d]) => `<button class="choice ${k === cur ? "on" : ""}" data-style="${k}"><div class="pv" style="background:linear-gradient(160deg,#2a1f45,#1a1330)">${chatPreview[k]}</div><b>${n}<span class="tick">✓</span></b><small>${d}</small></button>`).join("")}</div>`])
        + group("Theme", [`<div class="choice-grid">${[["Lantern Night", "linear-gradient(135deg,#5d3596,#b8406f 60%,#19767d)", true], ["Dawn Glass", "linear-gradient(135deg,#ffd3e2,#e9dcff 55%,#c9f2ea)"], ["Mea Cozy", "linear-gradient(135deg,#fbf6f1,#f6ede7 50%,#e7a1b5)"], ["Ink & Paper", "linear-gradient(135deg,#f7efe2,#e6d6c3 60%,#3b2c33)"]].map(([n, g, on]) => `<button class="choice ${on ? "on" : ""}" data-theme><div class="pv" style="background:${g}"></div><b>${n}<span class="tick">✓</span></b></button>`).join("")}</div>`])
        + group("Reading", [row("Story text size", "Applies to every chat style", `<div style="width:200px"><input class="range" id="story-size" type="range" min="15" max="22" step="1" value="${parseInt(getComputedStyle(document.documentElement).getPropertyValue("--story-size")) || 18}" /></div>`), row("Story font", "", `<div class="row" style="gap:6px"><button class="chip on">Newsreader</button><button class="chip">Literata</button><button class="chip">Lora</button></div>`), row("Dyslexia-friendly font everywhere", "OpenDyslexic", SW(false))])
        + group("Atmosphere", [row("Fireflies", "Drifting lights in the sky", `<label class="switch"><input type="checkbox" id="opt-flies" ${store.get("flies", true) ? "checked" : ""} /><i></i></label>`), row("Film grain", "A whisper of texture", `<label class="switch"><input type="checkbox" id="opt-grain" ${store.get("grain", true) ? "checked" : ""} /><i></i></label>`), row("Reduce motion", "Calmer transitions, no drifting", `<label class="switch"><input type="checkbox" id="opt-motion" ${store.get("calm", false) ? "checked" : ""} /><i></i></label>`), row("Small delights", "A sparkle when a memory is saved, a heart on bookmarks", SW(true)), row("Discreet mode", "Blur avatars and previews, keep notifications vague", SW(false))]);
    }],
    ["models", "Models", "cpu", () => group("Connection", [`<div class="setrow"><span class="orb" style="--g:var(--grad);width:44px;height:44px;display:grid;place-items:center;color:#24142f;font-weight:800">N</span><div class="grow"><b>NanoGPT</b><small>Subscription · key encrypted at rest</small></div><span class="chip sea">● connected</span></div>`, row("Monthly quota", "62% used · resets in 12 days", `<div style="width:200px" class="meter-line"><i style="--v:62%"></i></div>`)]) + group("Models", [row("Story model", "Writes the replies", `<span class="chip lilac">Wayfarer 12B</span>`), row("Helper model", "Summaries, memories, guards", `<span class="chip">Mistral Small 3.2</span>`), row("Fallback", "When the story model is busy", `<span class="chip">Llama 3.3 70B</span>`)])],
    ["memory", "Memory", "brain", () => group("Memory", [row("Summarise scenes as they end", "", SW(true)), row("Save memories automatically", "Facts, feelings and promises", SW(true)), row("Memory budget", "Share of the context window", `<div style="width:200px"><input class="range" type="range" value="28" /></div>`), row("Recall depth", "How far back to look", `<span class="chip">deep</span>`)])],
    ["trackers", "Trackers", "list", () => group("Trackers", [row("Relationship meters", "Trust, warmth, tension", SW(true)), row("Time and weather", "", SW(true)), row("Inventory", "", SW(false))])],
    ["guards", "Guards", "shield", () => group("Accuracy guards", [row("Continuity", "Catch contradictions with what's happened", SW(true)), row("Names", "Notice when a name changes", SW(true)), row("Point of view and puppeting", "", SW(true)), row("Character drift", "Re-anchor voices that wander", SW(true)), row("Timeline", "", SW(false))])],
    ["writing", "Writing", "feather", () => group("Writing", [row("Post-pass editor", "Polish replies before you see them", SW(false)), row("Steering advisor", "Suggest nudges", SW(true)), row("Spell check in the composer", "", SW(true))])],
    ["prompts", "Helper prompts", "scroll", () => group("Helper prompts", [row("Scene summary", "Edited 3 days ago", `<button class="btn sm">Edit</button>`), row("Memory extraction", "Default", `<button class="btn sm">Edit</button>`), row("Archivist", "Default", `<button class="btn sm">Edit</button>`)])],
    ["regex", "Regex", "slash", () => group("Regex scripts", [row("Strip trailing ellipses", "on replies", SW(true)), row("Curly quotes", "on everything", SW(true))])],
    ["devices", "Devices", "phone", () => group("Devices", [row("This PC", "Windows · Chrome", `<span class="chip sea">this device</span>`), row("Pixel 8", "Paired 2 weeks ago · last seen tonight", `<button class="btn sm ghost">Unpair</button>`), row("New pairing code", "Scan the QR code on your phone", `<button class="btn sm primary">Pair a phone</button>`)])],
    ["notifications", "Notifications", "bell", () => group("Notifications", [row("When a reply finishes", "", SW(true)), row("Inbox catches", "", SW(false))])],
    ["data", "Backups & data", "db", () => group("Backups", [row("Nightly backup", "Last: tonight, 03:00 · 48 MB", SW(true)), row("Back up now", "", `<button class="btn sm">Back up</button>`), row("Export everything", "", `<button class="btn sm">Export</button>`)])],
    ["storage", "Storage & privacy", "lock", () => group("Storage & privacy", [row("Encryption at rest", "Your stories are locked with your key", `<span class="chip sea">on</span>`), row("App lock", "Ask for a PIN after 5 minutes away", SW(true)), row("Images", "212 MB", `<div style="width:160px" class="meter-line"><i style="--v:40%"></i></div>`)])],
    ["usage", "Usage", "gauge", () => group("This month", [row("Messages written", "", `<span style="font:400 28px var(--f-display);color:var(--lamp)">1,284</span>`), row("Tokens", "", `<span style="font:400 28px var(--f-display);color:var(--lamp)">4.1M</span>`)])],
    ["status", "Status", "pulse", () => group("Status", [row("Server", "Up 6 days · v0.1.0", `<span class="chip sea">● healthy</span>`), row("Background jobs", "2 summaries queued", `<span class="chip">working</span>`)])],
  ];
  function renderSettings(id) {
    $("#set-nav").innerHTML = SECTIONS.map(([k, n, ic]) => `<button data-k="${k}" class="${k === id ? "on" : ""}">${icon(ic)}${n}</button>`).join("");
    $("#set-body").innerHTML = SECTIONS.find((s) => s[0] === id)[3]();
    $("#set-body").animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "cubic-bezier(.22,1,.36,1)" });
    $$("#set-nav button").forEach((b) => b.addEventListener("click", () => renderSettings(b.dataset.k)));
    $$("#set-body .choice[data-style]").forEach((c) => c.addEventListener("click", () => setStyle(c.dataset.style)));
    $$("#set-body .choice[data-theme]").forEach((c) => c.addEventListener("click", () => { $$("#set-body .choice[data-theme]").forEach((x) => x.classList.toggle("on", x === c)); toast("Only Lantern Night is drawn in this prototype"); }));
    $$("#set-body .row .chip").forEach((c) => c.addEventListener("click", () => $$(".chip", c.parentElement).forEach((x) => x.classList.toggle("on", x === c))));
    $$("#set-body input.range").forEach((r) => { const u = () => r.style.setProperty("--p", ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0))) * 100 + "%"); r.addEventListener("input", u); u(); });
    $("#story-size")?.addEventListener("input", (e) => { document.documentElement.style.setProperty("--story-size", e.target.value + "px"); store.set("size", e.target.value); });
    $("#opt-flies")?.addEventListener("change", (e) => { store.set("flies", e.target.checked); applyAtmos(); });
    $("#opt-grain")?.addEventListener("change", (e) => { store.set("grain", e.target.checked); applyAtmos(); });
    $("#opt-motion")?.addEventListener("change", (e) => { store.set("calm", e.target.checked); applyAtmos(); });
  }
  function applyAtmos() {
    flies.style.display = store.get("flies", true) ? "" : "none";
    document.body.style.setProperty("--grain", store.get("grain", true) ? 1 : 0);
    document.documentElement.classList.toggle("no-grain", !store.get("grain", true));
    document.documentElement.classList.toggle("calm", store.get("calm", false));
  }
  const css = document.createElement("style");
  css.textContent = `.no-grain body::after{display:none}.calm *,.calm *::before,.calm *::after{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}`;
  document.head.appendChild(css);
  if (store.get("size")) document.documentElement.style.setProperty("--story-size", store.get("size") + "px");
  applyAtmos();
  renderSettings("appearance");

  /* ---------------------------------------------------------------- codex */
  const CODEX = {
    People: () => `<div class="two"><div class="people-grid">${[["wren", "Wren Halloway", "the keeper", true], ["ash", "Ash", "you"], ["stranger", "Tamsin Halloway", "her brother, gone"], ["okonkwo", "Mr. Pell", "the harbourmaster"], ["mara", "Old Nan Ives", "sells eggs, knows everything"]].map(([a, n, d, on]) => `<button class="person card hair ${on ? "on" : ""}"><span class="orb" data-art="${a}"></span><b>${n}</b><span>${d}</span></button>`).join("")}</div>
      <div class="card pad hair"><div class="row"><span class="orb" data-art="wren" style="width:58px;height:58px"></span><div><div class="h2">Wren Halloway</div><span class="tiny faint">appears in 212 messages · first in ch. I</span></div></div>
      <div class="eyebrow" style="margin:18px 0 10px">Known facts</div><div class="mini atom"><span class="s">●</span><div>Keeps the Gull's Reach light alone.</div></div><div class="mini atom"><span class="s">●</span><div>Calls the lens “the Old Eye.”</div></div><div class="mini atom"><span class="s" style="color:var(--amber)">!</span><div>Says she's never left the island <small>conflicts with ch. I</small></div></div>
      <div class="eyebrow" style="margin:18px 0 10px">Ties</div><div class="kw"><span class="chip rose">Ash · trust 62</span><span class="chip">Tamsin · brother</span><span class="chip">Mr. Pell · wary</span></div></div></div>`,
    Places: () => `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${[["The lamp room", "112 stairs up. Brass, glass, one stove."], ["The boathouse", "Locked since Tamsin left."], ["Harbour office", "Mr. Pell's ledgers and bad coffee."], ["The rocks", "Where the ferry turns back."]].map(([n, d]) => `<div class="card pad hair"><div class="h2" style="font-size:24px">${n}</div><p class="muted" style="margin:8px 0 0;line-height:1.5">${d}</p></div>`).join("")}</div>`,
    Things: () => `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${[["The Old Eye", "First-order Fresnel lens, 1891"], ["The second key", "On Wren's ring. Never used."], ["The good mug", "Unchipped. Given, not offered."]].map(([n, d]) => `<div class="card pad hair"><div class="h2" style="font-size:24px">${n}</div><p class="muted" style="margin:8px 0 0">${d}</p></div>`).join("")}</div>`,
    Timeline: () => `<div class="card pad hair"><div class="timeline">${[["Day 1", "Ash climbs the stairs for the first time.", "var(--lilac)"], ["Day 3", "The logbook: “Wind SW, fair, leaving.”", "var(--rose)"], ["Day 6", "The last ferry turns back at the rocks.", "var(--sky)"], ["Day 9 · now", "Ash rows the oil across in a gale.", "var(--lamp)"]].map(([w, t, c]) => `<div class="tl" style="--c:${c}"><span class="when">${w}</span><p style="color:var(--text);font-size:15px">${t}</p></div>`).join("")}</div></div>`,
    Threads: () => `<div class="stack">${[["Why did Tamsin leave?", "simmering", 40], ["The second key", "quiet", 18], ["Will the ferry return?", "rising", 62]].map(([t, s, v]) => `<div class="card pad hair"><div class="row"><b class="grow" style="font-size:15px">${t}</b><span class="chip">${s}</span></div><div class="meter-line" style="margin-top:12px"><i style="--v:${v}%"></i></div></div>`).join("")}</div>`,
    "Promises & secrets": () => `<div class="stack"><div class="card pad hair atom"><span class="s">⚑</span><div>Ash promised oil before the long dark. <span class="chip sea" style="margin-left:6px">kept</span></div></div><div class="card pad hair atom"><span class="s" style="color:var(--rose)">✧</span><div>Wren kept Tamsin's last letter. Ash doesn't know. <span class="chip rose" style="margin-left:6px">secret</span></div></div></div>`,
    Journals: () => `<div class="card pad hair serif" style="font-size:17px;line-height:1.7;font-style:italic">Wren's journal, day 9: “He rowed. I've written it three times and it still looks stupid. The kettle was too loud. I gave him the good mug. I don't know why I'm writing that down.”</div>`,
    Chronicle: () => `<div class="card pad hair muted" style="line-height:1.7">Chapter I: The Light. Chapter II: The Logbook. Chapter III: Oil &amp; Salt, in progress.</div>`,
    Checks: () => `<div class="stack"><div class="card pad hair atom"><span class="s" style="color:var(--sea)">✓</span><div>Names are consistent across 212 messages.</div></div><div class="card pad hair atom"><span class="s" style="color:var(--amber)">!</span><div>One contradiction about the mainland. <a href="#/inbox" class="grad-text">Review →</a></div></div></div>`,
  };
  const ctabs = Object.keys(CODEX);
  $("#codex-tabs").innerHTML = ctabs.map((t, i) => `<button class="${i ? "" : "on"}">${t}</button>`).join("");
  const codexShow = (t) => { $("#codex-body").innerHTML = CODEX[t](); paintArt($("#codex-body")); $("#codex-body").animate([{ opacity: 0 }, { opacity: 1 }], 300); };
  $$("#codex-tabs button").forEach((b) => b.addEventListener("click", () => { $$("#codex-tabs button").forEach((x) => x.classList.toggle("on", x === b)); codexShow(b.textContent); }));
  codexShow("People");

  /* --------------------------------------------------------------- memory */
  $("#heat").innerHTML = Array.from({ length: 40 }, (_, i) => `<i style="--o:${i > 35 ? 0.06 : (0.25 + ((i * 37) % 60) / 100).toFixed(2)}" title="${i > 35 ? "not summarised yet" : "summarised"}"></i>`).join("");
  const ATOMS = [["Ash rowed the oil across in a gale.", "feeling", "ch. III", 9, true], ["Her brother Tamsin left on the last ferry and never wrote.", "fact", "ch. I", 14], ["She calls the Fresnel lens “the Old Eye.”", "fact", "ch. I", 11], ["Ash takes his tea black, “like the sea at four bells.”", "fact", "ch. II", 6], ["Wren will not be thanked.", "feeling", "ch. II", 7], ["Ash promised oil before the long dark.", "promise", "ch. II", 5]];
  const typeChip = { fact: "lilac", feeling: "rose", promise: "lamp" };
  $("#atoms").innerHTML = ATOMS.map(([t, k, ch, r, pin]) => `<div class="card hair" style="padding:14px 18px;display:grid;grid-template-columns:1fr auto;gap:8px 14px;align-items:center"><div style="font-size:15px">${pin ? '<span style="color:var(--lamp);text-shadow:0 0 8px var(--lamp)">★</span> ' : ""}${t}</div><button class="ib sm" title="Edit">${icon("pen")}</button><div class="row" style="gap:6px"><span class="chip ${typeChip[k]}">${k}</span><span class="chip">${ch}</span><span class="tiny faint">recalled ${r}×</span></div><div class="meter-line" style="width:80px"><i style="--v:${r * 7}%"></i></div></div>`).join("");
  const pts = [[60, 60, "#ffd08f", 4], [132, 40, "#ff9ec0", 6], [214, 74, "#c7b4ff", 4], [150, 124, "#fff", 8], [88, 168, "#82e3d3", 4], [252, 150, "#ffd08f", 5], [180, 196, "#9cc4ff", 3.5], [36, 120, "#c7b4ff", 3], [270, 40, "#82e3d3", 3], [110, 96, "#ff9ec0", 3.5]];
  const links = [[0, 1], [1, 2], [1, 3], [2, 3], [3, 4], [4, 0], [3, 5], [4, 6], [6, 5], [7, 0], [7, 4], [2, 8], [9, 3], [9, 1]];
  $("#big-const").innerHTML = `<g stroke="rgb(199 180 255 / 35%)" class="lnk">${links.map(([a, b]) => `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`).join("")}</g>${pts.map(([x, y, c, r], i) => `<circle class="st" cx="${x}" cy="${y}" r="${r}" fill="${c}" style="animation-delay:${i * 0.3}s;filter:drop-shadow(0 0 ${r}px ${c})"/>`).join("")}`;

  /* -------------------------------------------------------------- palette */
  const P = [
    ...STORIES.map((s) => ({ g: "Stories", t: s.title, s: s.who, art: s.id, go: () => (location.hash = "#/chat") })),
    ...CHARS.map((c) => ({ g: "Characters", t: c.name, s: c.line, art: c.id, go: () => (location.hash = "#/character") })),
    ...[["Home", "home", "home"], ["Personas", "personas", "users"], ["Creator studio", "studio", "wand"], ["Lorebooks", "lore", "book"], ["Presets", "presets", "sliders"], ["Notebook", "notebook", "pen"], ["Review inbox", "inbox", "inbox"], ["Settings", "settings", "cog"], ["Codex", "codex", "library"], ["Memory", "memory", "brain"], ["The world off the page", "world", "globe"], ["Reading mode", "read", "bookopen"]].map(([t, h, ic]) => ({ g: "Go to", t, ic, go: () => (location.hash = "#/" + h) })),
    { g: "Actions", t: "Focus on the chat", ic: "focus", go: () => { location.hash = "#/chat"; setTimeout(() => { state.focus = true; applyShell(); }, 50); } },
    { g: "Actions", t: "Cards style", ic: "cards", go: () => setStyle("cards") },
    { g: "Actions", t: "Book style", ic: "book", go: () => setStyle("book") },
    { g: "Actions", t: "Bubbles style", ic: "bubble", go: () => setStyle("bubbles") },
    { g: "Actions", t: "Show or hide navigation", ic: "panelL", go: () => act.rail() },
    { g: "Actions", t: "Show or hide the side panel", ic: "panelR", go: () => act.dock() },
  ];
  let sel = 0, shown = [];
  function renderPalette() {
    const q = $("#pq").value.trim().toLowerCase();
    shown = P.filter((p) => !q || (p.t + " " + (p.s || "") + " " + p.g).toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let g = "";
    $("#pres").innerHTML = shown.map((p, i) => (p.g !== g ? `<div class="grp eyebrow">${(g = p.g)}</div>` : "") + `<button class="it ${i === sel ? "sel" : ""}" data-i="${i}">${p.art ? `<span class="orb" data-art="${p.art}"></span>` : `<span class="ic">${icon(p.ic)}</span>`}<span>${p.t}</span>${p.s ? `<small>${p.s}</small>` : ""}</button>`).join("") || `<div class="muted" style="padding:24px;text-align:center">Nothing by that name. Yet.</div>`;
    paintArt($("#pres"));
    $$("#pres .it").forEach((b) => { b.addEventListener("click", () => run(+b.dataset.i)); b.addEventListener("mousemove", () => { if (sel !== +b.dataset.i) { sel = +b.dataset.i; $$("#pres .it").forEach((x) => x.classList.toggle("sel", x === b)); } }); });
    $("#pres .sel")?.scrollIntoView({ block: "nearest" });
  }
  function run(i) { const p = shown[i]; closePalette(); p?.go(); }
  function openPalette() { $("#palette").classList.add("on"); $("#pq").value = ""; sel = 0; renderPalette(); setTimeout(() => $("#pq").focus(), 30); }
  function closePalette() { $("#palette").classList.remove("on"); }
  $("#pq").addEventListener("input", () => { sel = 0; renderPalette(); });
  $("#pq").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); renderPalette(); e.preventDefault(); }
    else if (e.key === "Enter") run(sel);
  });
  $("#palette").addEventListener("click", (e) => { if (e.target.id === "palette") closePalette(); });

  /* ---------------------------------------------------------------- boot */
  paintIcons();
  paintArt();
  if (!isDesk()) state.dock = false;
  route();
  document.fonts?.ready.then(() => { if (state.view === "chat") $("#feed").scrollTop = $("#feed").scrollHeight; });
})();
