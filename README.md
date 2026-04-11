# Elenchus

Dual-Agent Deliberation Framework for LLM Hallucination Mitigation.

Two AI agents (Generator + Verifier) engage in Socratic dialogue with a proposal-vote mechanism, ensuring every action is critically examined before execution.

## Build & Install

```bash
# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build

# Link as a global CLI command
npm link
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

## Development

```bash
# Run directly from source (no build needed)
npm start

# Type-check without emitting
npm run check
```