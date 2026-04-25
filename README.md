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

## GUI (Electron Desktop App)

Elenchus provides an Electron desktop GUI with a three-column layout (Agent Tree, Chat Panel, Preview Panel).

### Architecture

The GUI uses `electron-vite` for a three-way build:

- **Main Process** (`electron/index.ts`): Runs the core Elenchus deliberation engine directly — no sidecar, no child_process for agent logic. Handles IPC, session management, and tool execution.
- **Preload** (`electron/preload.ts`): Bridge between main and renderer with `contextIsolation: true`.
- **Renderer** (`gui/src/`): React + TailwindCSS frontend.

The workspace directory (`~/Elenchus` by default) stores session data:

| File | Purpose |
|------|---------|
| `state.db` | SQLite database with session history, unit snapshots, messages |
| `workspace-config.json` | LLM provider/model/baseUrl/projectRoot (no API key) |

### Prerequisites

- Node.js ≥ 18

### Dev Mode

```bash
# Install dependencies (first time only)
npm install

# Start Electron dev mode (HMR for renderer, auto-reload for main process)
npm run dev
```

Configuration is done through the onboarding page in the GUI. The first launch will prompt for provider, model, API key, and project root.

Press Ctrl+C to shut down. DevTools opens automatically in dev mode.

### Build & Release

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Build all three targets (main + preload + renderer)
npm run build

# 3. Package for distribution
npm run dist
```

The built application is output to `dist/`:

| Platform | Output |
|----------|--------|
| macOS    | `.dmg` and `.app` in `dist/` |
| Windows  | `.msi` and `.exe` in `dist/` |
| Linux    | `.deb` and `.AppImage` in `dist/` |

> **Note:** `npm run build` compiles TypeScript and bundles the renderer. `npm run dist` additionally packages it into an installer via `electron-builder`. Native modules (better-sqlite3) are automatically rebuilt.

### Debugging

- **Renderer DevTools**: Opens automatically in dev mode. In production builds, use `View → Toggle Developer Tools` or `Cmd+Option+I`.
- **Main process logs**: Printed to the terminal where `npm run dev` was started. Uncaught exceptions also show a dialog box.
- **IPC inspection**: Use Electron DevTools → Console to inspect `window.electronAPI` calls.
- **Type checking**: Run `npm run check` to verify TypeScript across the entire project.

### Known Issues

- **`spawn /bin/sh ENOENT`**: If the project root contains `~` (e.g. `~/Elenchus`), the tilde must be expanded to the home directory. The IPC handler now handles this automatically.

## Development

```bash
# Type-check the entire project (core + electron + GUI)
npm run check
```