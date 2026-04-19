// Elenchus - Tauri v2 Shell
// Manages the sidecar process lifecycle and persists LLM configuration.
// On app start: checks workspace for existing session data, recovers config if present.
// On sidecar start: spawns the Node.js sidecar, reads its port from stdout,
//   and saves workspace-level config (without API key) for cross-session recovery.
// On app close: kills the sidecar process gracefully.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LlmConfig {
    provider: String,
    model_name: String,
    api_key: String,
    base_url: Option<String>,
    project_root: String,
}

/// Workspace-level config persisted alongside session data (no API key).
/// Stored at ~/Elenchus/.elenchus-state/workspace-config.json
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceConfig {
    provider: String,
    model_name: String,
    base_url: Option<String>,
    project_root: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WorkspaceStatus {
    has_session: bool,
    config: Option<WorkspaceConfig>,
}

struct AppState {
    sidecar_port: Mutex<Option<u16>>,
    sidecar_child: Mutex<Option<CommandChild>>,
    config: Mutex<Option<LlmConfig>>,
}

fn default_workspace_root() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")).join("Elenchus")
}

fn workspace_config_path(workspace_root: &PathBuf) -> PathBuf {
    workspace_root.join(".elenchus-state").join("workspace-config.json")
}

fn session_db_path(workspace_root: &PathBuf) -> PathBuf {
    workspace_root.join(".elenchus-state").join("state.db")
}

/// Check if the default workspace has existing session data and saved config.
/// This runs before the sidecar starts, so it directly checks the filesystem.
#[tauri::command]
fn check_workspace_status() -> WorkspaceStatus {
    let workspace_root = default_workspace_root();
    let db_path = session_db_path(&workspace_root);
    let config_path = workspace_config_path(&workspace_root);

    let has_session = db_path.exists() && db_path.metadata().map(|m| m.len() > 0).unwrap_or(false);

    let config = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|content| serde_json::from_str::<WorkspaceConfig>(&content).ok())
    } else {
        None
    };

    WorkspaceStatus { has_session, config }
}

/// Save workspace-level config (without API key) to the workspace directory.
fn save_workspace_config(config: &LlmConfig) {
    let workspace_root = default_workspace_root();
    let state_dir = workspace_root.join(".elenchus-state");
    if let Err(e) = std::fs::create_dir_all(&state_dir) {
        eprintln!("[tauri] Failed to create state dir: {e}");
        return;
    }
    let ws_config = WorkspaceConfig {
        provider: config.provider.clone(),
        model_name: config.model_name.clone(),
        base_url: config.base_url.clone(),
        project_root: config.project_root.clone(),
    };
    let config_path = workspace_config_path(&workspace_root);
    if let Err(e) = std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&ws_config).unwrap_or_default(),
    ) {
        eprintln!("[tauri] Failed to write workspace config: {e}");
    }
}

#[tauri::command]
async fn save_config(
    app: tauri::AppHandle,
    config: LlmConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Persist to Tauri store
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    store.set("llm_config", serde_json::to_value(&config).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;

    // Also keep in memory
    *state.config.lock().map_err(|e| e.to_string())? = Some(config);
    Ok(())
}

#[tauri::command]
async fn load_persisted_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LlmConfig>, String> {
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    if let Some(value) = store.get("llm_config") {
        let config: LlmConfig = serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid config: {e}"))?;
        *state.config.lock().map_err(|e| e.to_string())? = Some(config.clone());
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<Option<LlmConfig>, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn get_sidecar_port(state: State<AppState>) -> Result<u16, String> {
    state
        .sidecar_port
        .lock()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Sidecar not running".to_string())
}

#[tauri::command]
async fn start_sidecar(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: LlmConfig,
) -> Result<u16, String> {
    // Store config in memory and persist workspace-level config
    *state.config.lock().map_err(|e| e.to_string())? = Some(config.clone());
    save_workspace_config(&config);

    // Also persist full config (with API key) to Tauri store
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    store.set("llm_config", serde_json::to_value(&config).map_err(|e| e.to_string())?);
    let _ = store.save();

    // Use Tauri sidecar (externalBin) to spawn the bundled sidecar binary
    let mut cmd = app.shell().sidecar("elenchus-sidecar")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?;
    cmd = cmd.args([
        "--serve",
        "--provider",
        &config.provider,
        "--model",
        &config.model_name,
        "--api-key",
        &config.api_key,
        "--project-root",
        &config.project_root,
    ]);
    if let Some(ref base_url) = config.base_url {
        cmd = cmd.args(["--base-url", base_url]);
    }

    // Spawn and capture stdout
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    *state.sidecar_child.lock().map_err(|e| e.to_string())? = Some(child);

    // Read stdout lines until we find ELENCHUS_PORT=
    let port = tokio::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        let mut timeout = tokio::time::interval(std::time::Duration::from_secs(10));
        timeout.tick().await; // first tick is immediate

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(CommandEvent::Stdout(line)) => {
                            let line = String::from_utf8_lossy(&line);
                            if let Some(port_str) = line.strip_prefix("ELENCHUS_PORT=") {
                                if let Ok(port) = port_str.trim().parse::<u16>() {
                                    return Ok(port);
                                }
                            }
                        }
                        Some(CommandEvent::Stderr(line)) => {
                            let line = String::from_utf8_lossy(&line);
                            eprintln!("[sidecar stderr] {line}");
                        }
                        Some(CommandEvent::Terminated(status)) => {
                            return Err(format!("Sidecar exited prematurely with status: {status:?}"));
                        }
                        Some(CommandEvent::Error(err)) => {
                            return Err(format!("Sidecar error: {err}"));
                        }
                        None => {
                            return Err("Sidecar stdout channel closed".to_string());
                        }
                        _ => {}
                    }
                }
                _ = timeout.tick() => {
                    return Err("Timeout waiting for sidecar port".to_string());
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    // Store port
    *state.sidecar_port.lock().map_err(|e| e.to_string())? = Some(port);

    Ok(port)
}

fn kill_sidecar(state: &AppState) {
    if let Ok(mut child_guard) = state.sidecar_child.lock() {
        if let Some(child) = child_guard.take() {
            let _ = child.kill();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState {
            sidecar_port: Mutex::new(None),
            sidecar_child: Mutex::new(None),
            config: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_workspace_status,
            save_config,
            load_persisted_config,
            get_config,
            get_sidecar_port,
            start_sidecar
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                kill_sidecar(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
