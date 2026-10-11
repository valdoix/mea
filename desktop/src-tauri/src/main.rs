// Mea for Windows: a native window and tray icon around the Mea that runs on this computer.
// Mea itself keeps running as the "Mea" Scheduled Task (scripts/install-service.ps1), so the phone
// can reach it while this window is closed. The app only shows it, and starts the task when it's down.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn port() -> u16 {
    std::env::var("MEA_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(7766)
}

fn task_name() -> String {
    std::env::var("MEA_TASK").unwrap_or_else(|_| "Mea".into())
}

fn mea_url() -> String {
    format!("http://127.0.0.1:{}", port())
}

fn alive() -> bool {
    ureq::get(&format!("{}/api/ping", mea_url()))
        .timeout(Duration::from_millis(1500))
        .call()
        .is_ok()
}

fn schtasks(args: &[&str]) -> bool {
    Command::new("schtasks")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn wait_alive(limit: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if alive() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

/// Called by the splash screen: finds Mea, starting its Scheduled Task if it isn't answering.
#[tauri::command]
async fn ensure_mea() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if alive() {
            return Ok(mea_url());
        }
        let task = task_name();
        if !schtasks(&["/Run", "/TN", &task]) {
            return Err(format!(
                "Mea isn't running, and there's no \"{task}\" task to start. Run scripts\\install-service.ps1 once (as administrator), or start Mea with \"bun run start\"."
            ));
        }
        if wait_alive(Duration::from_secs(30)) {
            Ok(mea_url())
        } else {
            Err("Mea's task started but Mea didn't answer within 30 seconds. Check the logs in its data folder.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn restart_mea(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let task = task_name();
        schtasks(&["/End", "/TN", &task]);
        std::thread::sleep(Duration::from_secs(2));
        schtasks(&["/Run", "/TN", &task]);
        if wait_alive(Duration::from_secs(30)) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("location.reload()");
            }
        }
    });
}

static UPDATING: AtomicBool = AtomicBool::new(false);

/// Mea's folder: MEA_ROOT if set, else the folder the "Mea" task runs in (or above it, for dist\mea.exe).
fn mea_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("MEA_ROOT") {
        return Some(PathBuf::from(root));
    }
    let query = format!("(Get-ScheduledTask -TaskName '{}').Actions[0].WorkingDirectory", task_name().replace('\'', "''"));
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &query])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if dir.is_empty() {
        return None;
    }
    Path::new(&dir).ancestors().find(|p| p.join("scripts").join("update.ps1").exists()).map(Path::to_path_buf)
}

/// Runs scripts\update.ps1 (pull, build, restart), which shows its own result, then reloads the window.
fn update_mea(app: &AppHandle, item: MenuItem<Wry>) {
    if UPDATING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = item.set_text("Rebuilding Mea…");
        let _ = item.set_enabled(false);
        let port = port().to_string();
        let task = task_name();
        let ran = match mea_root() {
            Some(root) => Command::new("powershell")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(root.join("scripts").join("update.ps1"))
                .args(["-TaskName", &task, "-Port", &port, "-ShowResult"])
                .current_dir(&root)
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .is_ok(),
            None => false,
        };
        if !ran {
            // update.ps1 shows its own message box; without it, say where to look (no quotes: it's a PowerShell string).
            let msg = "Could not find the Mea folder to update. Set MEA_ROOT to it, or run scripts\\update.ps1 there.";
            let _ = Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('{msg}', 'Update and rebuild')")])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        if wait_alive(Duration::from_secs(30)) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("location.reload()");
            }
        }
        let _ = item.set_text("Update and rebuild");
        let _ = item.set_enabled(true);
        UPDATING.store(false, Ordering::SeqCst);
    });
}

/// Mea's own pages and the splash stay in the window; anything else opens in the default browser.
fn is_internal(url: &Url) -> bool {
    match url.host_str() {
        Some("127.0.0.1") | Some("localhost") => url.port_or_known_default() == Some(port()),
        Some("tauri.localhost") => true,
        _ => url.scheme() == "tauri" || url.scheme() == "about" || url.scheme() == "data",
    }
}

fn open_external(url: &Url) {
    let _ = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url.as_str()])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .invoke_handler(tauri::generate_handler![ensure_mea])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Mea")
                .inner_size(1280.0, 860.0)
                .min_inner_size(380.0, 480.0)
                .center()
                .background_color(tauri::window::Color(14, 10, 24, 255))
                .on_navigation(|url| {
                    if is_internal(url) {
                        true
                    } else {
                        open_external(url);
                        false
                    }
                })
                .build()?;

            // Closing the window keeps Mea in the tray (Mea itself keeps running either way).
            let w = window.clone();
            window.on_window_event(move |e| {
                if let WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    let _ = w.hide();
                }
            });

            let open = MenuItem::with_id(app, "open", "Open Mea", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", "Restart Mea", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Update and rebuild", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Close this window (Mea keeps running)", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &reload, &restart, &update, &sep, &quit])?;

            TrayIconBuilder::with_id("mea")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("Mea")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "reload" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("location.reload()");
                            show_main(app);
                        }
                    }
                    "restart" => restart_mea(app),
                    "update" => update_mea(app, update.clone()),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Mea");
}
