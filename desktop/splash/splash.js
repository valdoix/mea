// M4: the global __TAURI__ API isn't injected (it would reach Mea's own pages too); the splash talks
// to the app through Tauri's IPC bridge, and only its capability may call ensure_mea.
const invoke = (cmd, args) => (window.__TAURI__ ? window.__TAURI__.core.invoke(cmd, args) : window.__TAURI_INTERNALS__.invoke(cmd, args));
const status = document.getElementById("status");
const retry = document.getElementById("retry");
async function go() {
  retry.hidden = true;
  status.className = "";
  status.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  try {
    const url = await invoke("ensure_mea");
    location.replace(url);
  } catch (e) {
    status.className = "err";
    status.textContent = String(e);
    retry.hidden = false;
  }
}
retry.onclick = go;
go();
