# Chrome Parallel MCP

[English](README.md) | [中文](README_zh.md)

A fork of [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) for concurrent browser automation, with explicit tab binding and file-first screenshots. It uses your existing Chrome/Chromium browser and login sessions through a Chrome extension and a local native messaging host.

## Changes in This Fork

- Separate MCP server instances for concurrent client sessions.
- Explicit `targetId` bindings for page tools; unknown targets and conflicting tab/window arguments fail.
- Target-scoped network capture start/stop and initial tab selection for recorded flows.
- CDP screenshots of the bound tab, without requiring it to be active. The native host rejects captures without matching target metadata.
- File-first screenshots under `/tmp/chrome-mcp-screenshots`, with explicit base64 fallback.
- Tool schemas that explain target creation/binding before page operations.

This is tab routing isolation, not a security boundary. Agents still share browser cookies, storage, permissions, history, and bookmarks.

## Install From Source

Requirements: Node.js 20+, pnpm, Chrome/Chromium. File output currently uses a literal `/tmp` path; use `output: "base64"` if that path is unavailable to your agent.

Build both components from this repository. The upstream npm package and release ZIPs do not include these changes. The inherited `releases/` directory is not a build of this fork.

```bash
git clone https://github.com/pikaball/chrome-parallel-mcp.git
cd chrome-parallel-mcp
pnpm install
pnpm build:shared
pnpm build:native
pnpm build:extension
```

1. Open `chrome://extensions`, enable Developer mode, and load `app/chrome-extension/.output/chrome-mv3` unpacked.
2. Copy its extension ID into `EXTENSION_ID` in `app/native-server/src/scripts/constant.ts`. Unpacked IDs may differ between machines/directories.
3. Rebuild and register the local native host:

```bash
pnpm build:native
pnpm --filter mcp-chrome-bridge register:dev
```

4. Open the extension popup and connect. Keep this checkout in place: host registration points to its build directory.

Internal workspace names and the native host identifier are retained. Registration may replace an upstream host registration; the two installations cannot be assumed to run independently under the same identifier.

## Connect

Start/connect the extension first, then configure your MCP client for Streamable HTTP:

```json
{
  "mcpServers": {
    "chrome-parallel-mcp": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:12306/mcp"
    }
  }
}
```

For stdio-only clients, use `node` with the absolute path to `app/native-server/dist/mcp/mcp-server-stdio.js` in this checkout. Client configuration fields may vary.

## Concurrent Workflow

Each agent chooses a unique ID and creates its own tab:

```text
chrome_target_create({"targetId":"agent-a-main","url":"https://example.com"})
chrome_navigate({"targetId":"agent-a-main","url":"https://example.com/docs","background":true})
chrome_screenshot({"targetId":"agent-a-main","output":"file"})
```

Create both creates and binds; no separate bind call is needed. For an existing tab, first call `get_windows_and_tabs({})`, then `chrome_target_bind({"targetId":"agent-a-main","tabId":123})`. Wait for success before page tools. `chrome_target_list({})` needs no target.

Reuse the exact ID on subsequent calls. Normally omit `tabId` and `windowId`; if supplied they must match the binding. Each agent should use a separate tab. Do not use `chrome_switch_tab` for routing. Finish with `chrome_target_release({"targetId":"agent-a-main","closeTab":true})` when the tab should also close.

## Screenshots

Both `chrome_screenshot` and `chrome_computer(action="screenshot")` accept:

| Output                          | Behavior                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `"file"` (default, recommended) | Writes an image under `/tmp/chrome-mcp-screenshots` on the native-host machine; returns `filePath` and `mimeType`. |
| `"base64"`                      | Returns image data directly when the agent cannot read the file.                                                   |

Read the returned path with your image-reading tool first; if inaccessible, retry with `output: "base64"`. Not every client displays inline MCP images. Unique filenames use `.png` or `.jpg` according to MIME. Files remain until removed or cleaned by the host.

The target tab need not be active. Old extensions without capture metadata are rejected instead of silently returning active-tab pixels. The file writer supports MCP images and legacy JSON payloads, but format compatibility does not bypass target verification.

## Updates and Limitations

- Build shared, native, and extension components together. Reload the extension, restart the native host, and reconnect MCP to refresh schemas. Updating only the native host is insufficient for screenshot isolation.
- Bindings live in service-worker memory; recreate/rebind after a worker or extension restart.
- IDs are shared across clients, not session-private or authorization tokens. Choose unique IDs.
- GIF recording supports one active target at a time.
- Recorded flows can explicitly open/switch tabs; binding determines the starting tab, not a sandbox for every step.
- Browser-wide operations and profile state remain global. Some interactions can change focus; prefer background options where supported.
- Full-page/element screenshots may scroll or temporarily modify the target page. Avoid simultaneous operations on the same tab.
- Restricted pages or competing debugger clients may prevent capture; errors must not fall back to another active tab.

## Development

```bash
pnpm --filter chrome-mcp-server test tests/browser tests/record-replay/tab-cursor.integration.test.ts
pnpm --filter mcp-chrome-bridge exec jest --runInBand --coverage=false src/mcp/screenshot-output.test.ts
pnpm --filter mcp-chrome-bridge exec tsc --noEmit
```

The full extension typecheck currently has existing errors outside these focused checks. Successful builds do not imply all repository checks pass.

[Tool reference](docs/TOOLS.md) | [中文工具说明](docs/TOOLS_zh.md) | [Architecture](docs/ARCHITECTURE.md) | [Visual editor](docs/VisualEditor.md)

Inherited detailed documents may describe upstream behavior; this README and current `packages/shared/src/tools.ts` schemas take precedence for fork-specific setup and targeting.

## License and Attribution

MIT, see [LICENSE](LICENSE). Based on hangye and the contributors to [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome). Original copyright notices are retained.
