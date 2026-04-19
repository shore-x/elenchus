# Elenchus

Dual-Agent Deliberation Framework for LLM Hallucination Mitigation.

Two AI agents (Generator + Verifier) engage in Socratic dialogue with a proposal-vote mechanism, ensuring every action is critically examined before execution.

## CLI Usage

```bash
# Install dependencies
npm install

# Run directly from source (no build needed)
npm start

# Or compile and link as a global command
npm run build && npm link
```

After `npm link`, you can run `elenchus` from **any directory**:

```bash
cd /path/to/your/project
elenchus
```

The agent's environment tools (Bash, ReadFile, WriteFile) will operate in the **current working directory**, not in the elenchus source tree.

## Configuration

All configuration is done via environment variables.

### API Key (Required)

Set the API key for your LLM provider. Default provider is Anthropic:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Base URL (Optional)

Override the API endpoint for proxies or custom deployments:

```bash
# Provider-specific
export ANTHROPIC_BASE_URL="https://your-proxy.example.com"

# Or use the framework-level override (takes precedence)
export ELENCHUS_BASE_URL="https://your-proxy.example.com"
```

### Model & Provider (Optional)

```bash
export ELENCHUS_PROVIDER="anthropic"          # LLM provider (default: anthropic)
export ELENCHUS_MODEL="claude-sonnet-4-20250514"  # Model name (default: claude-sonnet-4-20250514)
```

### Tool Level (Optional)

Controls the agent's capability tier:

| Level | Description |
|-------|-------------|
| `L0`  | Coordination — child management only (default) |
| `L1`  | Planning + Execution — full capabilities |
| `L2`  | Execution — environment tools only |

```bash
export ELENCHUS_LEVEL="L1"
```

### Verbosity (Optional)

```bash
export ELENCHUS_VERBOSE="1"   # 0 = minimal, 1 = normal (default), 2 = debug (includes FSM transitions)
```

### Quick Start Example

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export ELENCHUS_LEVEL="L1"
elenchus
```

## GUI (Tauri Desktop App)

Elenchus provides a Tauri v2 desktop GUI with a three-column layout (Agent Tree, Chat Panel, Preview Panel).

### Architecture

The GUI consists of two processes:

- **Tauri Shell (Rust)**: Manages window lifecycle, spawns the sidecar, persists configuration.
- **Sidecar (Node.js)**: Runs the core Elenchus deliberation engine, exposes a REST API + WebSocket event stream on `127.0.0.1:<random-port>`. The sidecar prints `ELENCHUS_PORT=<port>` to stdout on startup so the Tauri shell can discover it.

The workspace directory (`~/Elenchus` by default) stores session data in `~/Elenchus/.elenchus-state/`:

| File | Purpose |
|------|---------|
| `state.db` | SQLite database with session history, unit snapshots, messages |
| `workspace-config.json` | LLM provider/model/baseUrl/projectRoot (no API key) |

### Prerequisites

- [Rust toolchain](https://www.rust-lang.org/tools/install) (for Tauri backend)
- Node.js ≥ 18

### Dev Mode

Use the one-command dev script to start both the sidecar backend and Vite frontend:

```bash
# Set your API key (provider-specific env vars also work)
ANTHROPIC_API_KEY=sk-ant-... ./dev.sh

# Or via npm
ANTHROPIC_API_KEY=sk-ant-... npm run dev

# Specify a different provider
ELENCHUS_PROVIDER=openai ELENCHUS_API_KEY=sk-... ./dev.sh

# Full configuration
ELENCHUS_PROVIDER=anthropic \
ELENCHUS_MODEL=claude-sonnet-4-20250514 \
ELENCHUS_API_KEY=sk-ant-... \
ELENCHUS_BASE_URL=https://your-proxy.example.com \
ELENCHUS_PROJECT_ROOT=~/Elenchus \
./dev.sh
```

The script auto-discovers the sidecar port and injects it into the Vite dev server. Press Ctrl+C to shut down both processes cleanly.

Alternatively, you can start the sidecar and Vite manually in two terminals (the onboarding page will prompt for the sidecar port if `VITE_SIDECAR_PORT` is not set).

### Build & Release

The sidecar is bundled as a standalone binary (via esbuild + pkg) and packaged into the Tauri app via `externalBin`. You must build the sidecar **before** running `tauri build`.

```bash
# 1. Install dependencies (first time only)
npm install
cd gui && npm install && cd ..

# 2. Build sidecar binary
bash scripts/build-sidecar.sh

# 3. Build Tauri app
cd gui && npm run tauri build && cd ..
```

The built application is output to `gui/src-tauri/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS    | `.dmg` and `.app` in `bundle/macos/` |
| Windows  | `.msi` and `.exe` in `bundle/msi/` |
| Linux    | `.deb` and `.AppImage` in `bundle/deb/` |

> **Note:** The sidecar binary must be rebuilt whenever the core engine (`src/`) changes. The build script places the binary at `gui/src-tauri/binaries/elenchus-sidecar-<target-triple>`.

**Environment variables** (all optional, used by `dev.sh` and CLI):

| Variable | Default | Description |
|----------|---------|-------------|
| `ELENCHUS_PROVIDER` | `anthropic` | LLM provider |
| `ELENCHUS_MODEL` | `claude-sonnet-4-20250514` | Model name |
| `ELENCHUS_API_KEY` | — | API key (or use provider-specific like `ANTHROPIC_API_KEY`) |
| `ELENCHUS_BASE_URL` | — | Base URL for third-party providers |
| `ELENCHUS_PROJECT_ROOT` | `$(pwd)` | Agent working directory |
| `ELENCHUS_LEVEL` | — | Agent level: L0, L1, L2 |
| `ELENCHUS_WORKSPACE_ROOT` | `~/Elenchus` | Workspace storage directory |

## Development

```bash
# Type-check core engine
npm run check

# Type-check GUI frontend
cd gui && npx tsc --noEmit
```