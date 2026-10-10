fn main() {
    // M4: ensure_mea is declared, so only a capability that allows it (the splash's) can call it.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["ensure_mea"])))
        .expect("failed to run tauri-build");
}
