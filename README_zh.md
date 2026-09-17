# Chrome Parallel MCP

[English](README.md) | [中文](README_zh.md)

基于 [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) 的分支，面向多 Agent 并发浏览器自动化，提供显式标签页绑定和文件优先的截图输出。通过 Chrome 扩展与本地 native messaging host，复用现有 Chrome/Chromium 浏览器及登录状态。

## 本分支的改动

- 每个 MCP 客户端会话使用独立 server 实例。
- 页面工具通过 `targetId` 绑定标签页；未知 target 和不匹配的 tab/window 参数会报错。
- 网络抓取按目标启动、停止；录制流程的起始标签页接入绑定。
- 截图通过绑定 tab 的 CDP 会话捕获，无须激活目标页；native host 拒绝没有匹配 target 元数据的截图。
- 截图默认保存到 `/tmp/chrome-mcp-screenshots`，支持显式切换为 base64。
- 工具 schema 明确说明页面操作前如何创建或绑定 target。

这里的隔离是标签页路由隔离，不是浏览器安全边界。各 Agent 仍共享 Cookie、存储、权限、历史和书签。

## 从源码安装

需要 Node.js 20+、pnpm 和 Chrome/Chromium。文件输出使用固定 `/tmp` 路径；该路径不可用或 Agent 无法访问时，使用 `output: "base64"`。

扩展和 native server 必须都从本仓库构建。上游 npm 包和 Release ZIP 不包含本分支改动；继承的 `releases/` 目录也不是本分支的构建产物。

```bash
git clone https://github.com/pikaball/chrome-parallel-mcp.git
cd chrome-parallel-mcp
pnpm install
pnpm build:shared
pnpm build:native
pnpm build:extension
```

1. 打开 `chrome://extensions`，开启开发者模式，加载已解压的扩展目录 `app/chrome-extension/.output/chrome-mv3`。
2. 复制扩展 ID，修改 `app/native-server/src/scripts/constant.ts` 中的 `EXTENSION_ID`。未打包扩展的 ID 可能因机器或目录不同而变化。
3. 重新构建并注册本地 native host：

```bash
pnpm build:native
pnpm --filter mcp-chrome-bridge register:dev
```

4. 打开扩展弹窗并连接。注册指向当前仓库的构建目录，请保留该目录。

内部 workspace 包名和 native host 标识保持兼容。注册可能覆盖原先的上游 host 注册，不能假设两套安装在同一标识下独立运行。

## 连接 Agent

先连接扩展，再配置 Streamable HTTP：

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

仅支持 stdio 的客户端可使用 `node`，参数为本仓库 `app/native-server/dist/mcp/mcp-server-stdio.js` 的绝对路径。不同客户端配置字段可能不同。

## 并发使用流程

每个 Agent 选择唯一 ID，创建自己的标签页：

```text
chrome_target_create({"targetId":"agent-a-main","url":"https://example.com"})
chrome_navigate({"targetId":"agent-a-main","url":"https://example.com/docs","background":true})
chrome_screenshot({"targetId":"agent-a-main","output":"file"})
```

Create 同时创建并绑定，无须再 bind。使用已有页时，先调用 `get_windows_and_tabs({})`，再调用 `chrome_target_bind({"targetId":"agent-a-main","tabId":123})`，等待成功后执行页面操作。`chrome_target_list({})` 无须 target 参数。

后续始终传同一个 ID，通常省略 `tabId`、`windowId`；若提供，必须与绑定一致。不同 Agent 使用独立标签页，不要通过 `chrome_switch_tab` 路由操作。完成后可调用 `chrome_target_release({"targetId":"agent-a-main","closeTab":true})` 释放绑定并关闭标签页。

## 截图

`chrome_screenshot` 和 `chrome_computer(action="screenshot")` 均支持：

| 输出选项               | 行为                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `"file"`（默认、推荐） | 在 native host 所在机器的 `/tmp/chrome-mcp-screenshots` 保存图片，返回 `filePath` 和 `mimeType`。 |
| `"base64"`             | 直接返回图片数据，供无法读取文件时使用。                                                          |

优先用 Agent 的读图工具读取路径；无法访问时，再用 `output: "base64"` 重试。并非所有客户端都能显示内联 MCP 图片。文件名唯一，根据 MIME 使用 `.png` 或 `.jpg`，保留至主动删除或主机清理。

截图不要求目标页处于 active。旧扩展缺少捕获元数据时会明确报错，不会静默返回活动页像素。存盘器兼容 MCP 图片和旧 JSON 结构，但格式兼容不会绕过 target 校验。

## 更新与限制

- shared、native server 和扩展需要一起构建。重新加载扩展、重启 native host、重连 MCP 以刷新 schema。仅更新 native host 不足以启用截图隔离。
- 绑定保存在 service worker 内存中，worker 或扩展重启后需重新创建或绑定。
- ID 跨客户端共享，并非会话私有或授权凭据，应选择唯一 ID。
- GIF 录制仅支持一个活动 target。
- 录制流程可以显式打开或切换页；绑定决定起始页，不是对每一步的沙箱约束。
- 浏览器全局操作和 profile 状态仍共享。部分交互会改变焦点，支持时优先使用后台选项。
- 全页或元素截图可能滚动、临时修改目标页，避免对同一 tab 同时执行操作。
- 特殊页面或其他调试器占用目标时，截图可能失败；不能回退到其他活动页。

## 开发

```bash
pnpm --filter chrome-mcp-server test tests/browser tests/record-replay/tab-cursor.integration.test.ts
pnpm --filter mcp-chrome-bridge exec jest --runInBand --coverage=false src/mcp/screenshot-output.test.ts
pnpm --filter mcp-chrome-bridge exec tsc --noEmit
```

扩展全量类型检查目前仍有这些专项检查之外的已有错误，构建成功不代表整个仓库的检查全部通过。

[中文工具说明](docs/TOOLS_zh.md) | [English tool reference](docs/TOOLS.md) | [架构说明](docs/ARCHITECTURE_zh.md) | [可视化编辑器](docs/VisualEditor_zh.md)

继承的详细文档可能描述上游行为，本分支的安装和 target 使用以本 README 及当前 `packages/shared/src/tools.ts` schema 为准。

## 许可证与致谢

MIT，见 [LICENSE](LICENSE)。基于 hangye 和 [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome) 贡献者的工作，保留原版权声明。
