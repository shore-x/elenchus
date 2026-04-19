// Elenchus GUI - Inline Content Renderer
// Renders lightweight inline formatting (backtick code, **bold**) and file path links
// in conversational messages. Intentionally does NOT render block-level Markdown
// (headings, lists, code blocks, tables) — see P29 (Message Channel Conversational Style).

import type { ReactNode } from "react";

// --- Segment types ---

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "file-path"; fullPath: string; displayName: string; lineRange?: string };

// --- File path detection ---

const FILE_EXTENSIONS = new Set([
  // Code
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp",
  ".cs", ".scala", ".clj", ".hs", ".elm", ".dart", ".lua", ".r", ".R",
  // Web / config
  ".html", ".htm", ".css", ".scss", ".less", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".xml", ".graphql", ".gql",
  // Shell / scripting
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  // Docs / data
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".org", ".tex",
  ".csv", ".tsv", ".sql",
  // Lock / manifest
  ".lock", ".toml", ".cfg", ".conf",
  // Other common
  ".dockerfile", ".makefile", ".cmake",
  ".gitignore", ".envrc", ".editorconfig",
  ".wasm", ".proto", ".thrift", ".avsc",
]);

function hasFileExtension(path: string): boolean {
  const segments = path.split("/");
  const lastSegment = segments[segments.length - 1] ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return false; // no extension or dotfile like .gitignore
  const ext = lastSegment.slice(dotIndex).toLowerCase();
  return FILE_EXTENSIONS.has(ext);
}

// Absolute path: starts with /, has at least one / separator, and the last segment has a known extension
// Optional line range suffix: :digits or :digits-digits
const BARE_PATH_RE = /(\/[^\s`*]+?[^\s`*])\/([^\s`*/]+)\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|scala|clj|hs|elm|dart|lua|r|html|htm|css|scss|less|vue|svelte|json|yaml|yml|toml|ini|env|xml|graphql|gql|sh|bash|zsh|fish|ps1|bat|cmd|md|mdx|txt|rst|adoc|org|tex|csv|tsv|sql|lock|cfg|conf|dockerfile|makefile|cmake|gitignore|envrc|editorconfig|wasm|proto|thrift|avsc)(?::(\d+(?:-\d+)?))?/g;

function isFilePath(text: string): boolean {
  return text.startsWith("/") && text.includes("/") && hasFileExtension(text);
}

function shortenPath(fullPath: string): string {
  const segments = fullPath.split("/").filter(Boolean);
  if (segments.length <= 2) return segments.join("/");
  return segments.slice(-2).join("/");
}

function stripLineRange(path: string): { path: string; lineRange?: string } {
  const m = path.match(/^(.+):(\d+(?:-\d+)?)$/);
  if (m) return { path: m[1]!, lineRange: m[2]! };
  return { path };
}

function pathFileName(fullPath: string): string {
  const segments = fullPath.split("/");
  return segments[segments.length - 1] ?? fullPath;
}

// --- Parsing ---

// Step 1: Split on backtick-delimited inline code
const BACKTICK_RE = /(`+)([^`]+)\1/g;

// Step 2: Split on **bold**
const BOLD_RE = /\*\*(.+?)\*\*/g;

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Phase 1: Extract backtick segments
  const parts: { text: string; isCode: boolean }[] = [];
  let lastIdx = 0;
  for (const m of text.matchAll(BACKTICK_RE)) {
    if (m.index > lastIdx) {
      parts.push({ text: text.slice(lastIdx, m.index), isCode: false });
    }
    parts.push({ text: m[2]!, isCode: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ text: text.slice(lastIdx), isCode: false });
  }

  // Phase 2: For non-code parts, extract bold and bare file paths
  for (const part of parts) {
    if (part.isCode) {
      // Code content: check if it's a file path
      const trimmed = part.text.trim();
      const { path: barePath, lineRange } = stripLineRange(trimmed);
      if (isFilePath(barePath)) {
        segments.push({ type: "file-path", fullPath: barePath, displayName: shortenPath(barePath), lineRange });
      } else {
        segments.push({ type: "code", value: part.text });
      }
      continue;
    }

    // Non-code: extract bold, then scan for bare file paths
    const subParts: { text: string; isBold: boolean }[] = [];
    let subLast = 0;
    for (const m of part.text.matchAll(BOLD_RE)) {
      if (m.index > subLast) {
        subParts.push({ text: part.text.slice(subLast, m.index), isBold: false });
      }
      subParts.push({ text: m[1]!, isBold: true });
      subLast = m.index + m[0].length;
    }
    if (subLast < part.text.length) {
      subParts.push({ text: part.text.slice(subLast), isBold: false });
    }

    for (const sub of subParts) {
      if (sub.isBold) {
        segments.push({ type: "bold", value: sub.text });
        continue;
      }

      // Scan for bare file paths in plain text
      const pathParts: { text: string; isPath: boolean; fullPath: string }[] = [];
      let pathLast = 0;
      for (const m of sub.text.matchAll(BARE_PATH_RE)) {
        const matched = m[0];
        if (m.index > pathLast) {
          pathParts.push({ text: sub.text.slice(pathLast, m.index), isPath: false, fullPath: "" });
        }
        pathParts.push({ text: matched, isPath: true, fullPath: matched });
        pathLast = m.index + matched.length;
      }
      if (pathLast < sub.text.length) {
        pathParts.push({ text: sub.text.slice(pathLast), isPath: false, fullPath: "" });
      }

      for (const pp of pathParts) {
        if (pp.isPath) {
          const { path: barePath, lineRange } = stripLineRange(pp.fullPath);
          segments.push({ type: "file-path", fullPath: barePath, displayName: shortenPath(barePath), lineRange });
        } else if (pp.text) {
          segments.push({ type: "text", value: pp.text });
        }
      }
    }
  }

  return segments;
}

// --- Rendering ---

export interface InlineRenderOptions {
  onOpenFile?: (path: string, name: string, startLine?: number) => void;
}

export function renderInlineContent(text: string, options?: InlineRenderOptions): ReactNode[] {
  const segments = parseSegments(text);
  const nodes: ReactNode[] = [];
  let keyIdx = 0;

  for (const seg of segments) {
    const key = `seg-${keyIdx++}`;

    switch (seg.type) {
      case "text":
        nodes.push(seg.value);
        break;

      case "code":
        nodes.push(
          <code key={key} className="inline-code">
            {seg.value}
          </code>
        );
        break;

      case "bold":
        nodes.push(
          <strong key={key}>{seg.value}</strong>
        );
        break;

      case "file-path": {
        const name = pathFileName(seg.fullPath);
        const displayText = seg.lineRange ? `${seg.displayName}:${seg.lineRange}` : seg.displayName;
        const titleText = seg.lineRange ? `${seg.fullPath}:${seg.lineRange}` : seg.fullPath;
        const startLine = seg.lineRange ? parseInt(seg.lineRange.split("-")[0]!, 10) : undefined;
        const opener = options?.onOpenFile;
        if (opener) {
          nodes.push(
            <button
              key={key}
              className="file-link"
              title={titleText}
              onClick={(e) => {
                e.stopPropagation();
                opener(seg.fullPath, name, startLine);
              }}
            >
              @{displayText}
            </button>
          );
        } else {
          nodes.push(
            <code key={key} className="inline-code" title={titleText}>
              @{displayText}
            </code>
          );
        }
        break;
      }
    }
  }

  return nodes;
}
