# Chrome Parallel MCP 工具参考

本分支安装、更新和并发限制见 [README](../README_zh.md)。当前 [工具 schema](../packages/shared/src/tools.ts) 为准；下方继承的旧示例可能省略现在必需的 `targetId`，或包含未向 MCP 暴露的内部工具。

两种截图输出模式都要求新版扩展返回 target 捕获元数据。兼容旧图片格式不意味着允许未经验证的活动页截图；更新后须重新加载两端。

所有可用工具及其参数的完整参考。

## Target 初始化与截图

截图默认使用推荐的 `output: "file"`：native server 将 PNG 或 JPEG 写入 `/tmp/chrome-mcp-screenshots`，返回绝对路径 `filePath` 和 `mimeType`，扩展名对应为 `.png` 或 `.jpg`。兼容 MCP 图片内容和旧版 JSON `base64Data` 返回结构。先用读图工具读取该文件；如果无法访问 native server 所在机器的路径，再用 `output: "base64"` 重试，直接获取原始图片响应。此选项同时适用于 `chrome_screenshot` 和 `chrome_computer(action="screenshot")`。显式 `output` 优先于旧参数 `storeBase64`；省略 `output` 且 `storeBase64: true` 时返回 base64。文件保留至主动删除或主机清理；`savePng` 是额外的浏览器下载选项。

页面操作前，先调用 `chrome_target_create({"targetId":"agent-a-main","url":"https://example.com"})`，它会同时创建并绑定新标签页，无须再 bind。使用已有页面时，先调用 `get_windows_and_tabs({})`，再调用 `chrome_target_bind({"targetId":"agent-a-main","tabId":123})`。等待成功后，后续工具始终传入同一个 ID。并发 agent 各用独立 ID 和标签页。`get_windows_and_tabs` 和 `chrome_target_list` 无须 target 参数。

未知、空白、已关闭或不匹配的 target 会报错，不会回退到活动页。通常省略 `tabId`、`windowId`；若提供，必须与绑定一致。已存在的 ID 需 release 后才能绑定其他页，同一页不能绑定两个 ID。目前绑定只在扩展 service worker 生命周期内有效，重启后需重新创建或绑定。

调用 `chrome_screenshot({"targetId":"agent-a-main"})` 或 `chrome_computer({"targetId":"agent-a-main","action":"screenshot"})` 可获得截图文件路径。前者还支持 `fullPage`、`selector`、`width`、`height`、`maxHeight`、`output`（默认 file）和 `savePng`（默认 false）。截图通过 CDP 指向绑定页面，调试器失败时返回错误。目前 GIF 录制仅支持一个活动 target，其他 target 的操作会被拒绝。`chrome_close_tabs` 携带 target 时只关闭绑定页，须省略 `url` 和 `tabIds`。

## 📋 目录

- [浏览器管理](#浏览器管理)
- [网络监控](#网络监控)
- [内容分析](#内容分析)
- [交互操作](#交互操作)
- [数据管理](#数据管理)
- [响应格式](#响应格式)

## 📊 浏览器管理

### `get_windows_and_tabs`

列出当前打开的所有浏览器窗口和标签页。

**参数**：无

**响应**：

```json
{
  "windowCount": 2,
  "tabCount": 5,
  "windows": [
    {
      "windowId": 123,
      "tabs": [
        {
          "tabId": 456,
          "url": "https://example.com",
          "title": "示例页面",
          "active": true
        }
      ]
    }
  ]
}
```

### `chrome_navigate`

导航到指定 URL，可选择控制视口。

**参数**：

- `url` (字符串，必需)：要导航到的 URL
- `newWindow` (布尔值，可选)：创建新窗口（默认：false）
- `width` (数字，可选)：视口宽度（像素，默认：1280）
- `height` (数字，可选)：视口高度（像素，默认：720）

**示例**：

```json
{
  "url": "https://example.com",
  "newWindow": true,
  "width": 1920,
  "height": 1080
}
```

### `chrome_close_tabs`

关闭指定的标签页或窗口。

**参数**：

- `tabIds` (数组，可选)：要关闭的标签页 ID 数组
- `windowIds` (数组，可选)：要关闭的窗口 ID 数组

**示例**：

```json
{
  "tabIds": [123, 456],
  "windowIds": [789]
}
```

### `chrome_switch_tab`

切换到指定的浏览器标签页。

**参数**：

- `tabId` (数字，必需)：要切换到的标签页的 ID。
- `windowId` (数字，可选)：该标签页所在窗口的 ID。

**示例**：

```json
{
  "tabId": 456,
  "windowId": 123
}
```

### 多 agent 目标隔离

渗透或自动化探索场景下，多个 subagent 不应依赖“当前活动标签页”。推荐每个 subagent 先创建或绑定自己的逻辑目标，然后所有页面相关工具都传同一个 `targetId`。

#### `chrome_target_create`

创建一个标签页或窗口，并绑定到逻辑 `targetId`。

**参数**：

- `targetId` (字符串，必需)：逻辑目标 ID，例如 `agent-a-main`。
- `url` (字符串，可选)：初始 URL，默认 `about:blank`。
- `newWindow` (布尔值，可选)：是否创建新窗口。
- `windowId` (数字，可选)：在指定窗口中创建标签页。
- `background` (布尔值，可选)：是否避免激活标签页或聚焦窗口，默认 `true`。

**示例**：

```json
{
  "targetId": "agent-a-main",
  "url": "https://example.com",
  "background": true
}
```

#### `chrome_target_bind`

把已有标签页绑定到逻辑 `targetId`。

```json
{
  "targetId": "agent-b-main",
  "tabId": 456
}
```

#### `chrome_target_list`

列出当前 `targetId -> tabId` 绑定。

#### `chrome_target_release`

释放目标绑定，可选关闭对应标签页。

```json
{
  "targetId": "agent-a-main",
  "closeTab": false
}
```

页面工具必须传入已创建或绑定的 `targetId`；`tabId`、`windowId` 仅用于一致性校验，不能覆盖 target。不要依赖 `chrome_switch_tab` 路由操作。

### `chrome_go_back_or_forward`

浏览器历史导航。

**参数**：

- `direction` (字符串，必需)："back" 或 "forward"
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "direction": "back",
  "tabId": 123
}
```

## 🌐 网络监控

### `chrome_network_capture_start`

使用 webRequest API 开始捕获网络请求。

**参数**：

- `url` (字符串，可选)：要导航并捕获的 URL
- `maxCaptureTime` (数字，可选)：最大捕获时间（毫秒，默认：30000）
- `inactivityTimeout` (数字，可选)：无活动后停止时间（毫秒，默认：3000）
- `includeStatic` (布尔值，可选)：包含静态资源（默认：false）

**示例**：

```json
{
  "url": "https://api.example.com",
  "maxCaptureTime": 60000,
  "includeStatic": false
}
```

### `chrome_network_capture_stop`

停止网络捕获并返回收集的数据。

**参数**：无

**响应**：

```json
{
  "success": true,
  "capturedRequests": [
    {
      "url": "https://api.example.com/data",
      "method": "GET",
      "status": 200,
      "requestHeaders": {...},
      "responseHeaders": {...},
      "responseTime": 150
    }
  ],
  "summary": {
    "totalRequests": 15,
    "captureTime": 5000
  }
}
```

### `chrome_network_debugger_start`

使用 Chrome Debugger API 开始捕获（包含响应体）。

**参数**：

- `url` (字符串，可选)：要导航并捕获的 URL

### `chrome_network_debugger_stop`

停止调试器捕获并返回包含响应体的数据。

### `chrome_network_request`

发送自定义 HTTP 请求。

**参数**：

- `url` (字符串，必需)：请求 URL
- `method` (字符串，可选)：HTTP 方法（默认："GET"）
- `headers` (对象，可选)：请求头
- `body` (字符串，可选)：请求体

**示例**：

```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"key\": \"value\"}"
}
```

## 🔍 内容分析

### `search_tabs_content`

跨浏览器标签页的 AI 驱动语义搜索。

**参数**：

- `query` (字符串，必需)：搜索查询

**示例**：

```json
{
  "query": "机器学习教程"
}
```

**响应**：

```json
{
  "success": true,
  "totalTabsSearched": 10,
  "matchedTabsCount": 3,
  "vectorSearchEnabled": true,
  "indexStats": {
    "totalDocuments": 150,
    "totalTabs": 10,
    "semanticEngineReady": true
  },
  "matchedTabs": [
    {
      "tabId": 123,
      "url": "https://example.com/ml-tutorial",
      "title": "机器学习教程",
      "semanticScore": 0.85,
      "matchedSnippets": ["机器学习简介..."],
      "chunkSource": "content"
    }
  ]
}
```

### `chrome_get_web_content`

从网页提取 HTML 或文本内容。

**参数**：

- `format` (字符串，可选)："html" 或 "text"（默认："text"）
- `selector` (字符串，可选)：特定元素的 CSS 选择器
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "format": "text",
  "selector": ".article-content"
}
```

### `chrome_get_interactive_elements`

查找页面上可点击和交互的元素。

**参数**：

- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**响应**：

```json
{
  "elements": [
    {
      "selector": "#submit-button",
      "type": "button",
      "text": "提交",
      "visible": true,
      "clickable": true
    }
  ]
}
```

## 🎯 交互操作

### `chrome_click_element`

使用 CSS 选择器点击元素。

**参数**：

- `selector` (字符串，必需)：目标元素的 CSS 选择器
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "selector": "#submit-button"
}
```

### `chrome_fill_or_select`

填充表单字段或选择选项。

**参数**：

- `selector` (字符串，必需)：目标元素的 CSS 选择器
- `value` (字符串，必需)：要填充或选择的值
- `tabId` (数字，可选)：特定标签页 ID（默认：活动标签页）

**示例**：

```json
{
  "selector": "#email-input",
  "value": "user@example.com"
}
```

### `chrome_keyboard`

模拟键盘输入和快捷键。

**参数**：

- `keys` (字符串，必需)：按键组合（如："Ctrl+C"、"Enter"）
- `selector` (字符串，可选)：目标元素选择器
- `delay` (数字，可选)：按键间延迟（毫秒，默认：0）

**示例**：

```json
{
  "keys": "Ctrl+A",
  "selector": "#text-input",
  "delay": 100
}
```

## 📚 数据管理

### `chrome_history`

使用过滤器搜索浏览器历史记录。

**参数**：

- `text` (字符串，可选)：在 URL/标题中搜索文本
- `startTime` (字符串，可选)：开始日期（ISO 格式）
- `endTime` (字符串，可选)：结束日期（ISO 格式）
- `maxResults` (数字，可选)：最大结果数（默认：100）
- `excludeCurrentTabs` (布尔值，可选)：排除当前标签页（默认：true）

**示例**：

```json
{
  "text": "github",
  "startTime": "2024-01-01",
  "maxResults": 50
}
```

### `chrome_bookmark_search`

按关键词搜索书签。

**参数**：

- `query` (字符串，可选)：搜索关键词
- `maxResults` (数字，可选)：最大结果数（默认：100）
- `folderPath` (字符串，可选)：在特定文件夹内搜索

**示例**：

```json
{
  "query": "文档",
  "maxResults": 20,
  "folderPath": "工作/资源"
}
```

### `chrome_bookmark_add`

添加支持文件夹的新书签。

**参数**：

- `url` (字符串，可选)：要收藏的 URL（默认：当前标签页）
- `title` (字符串，可选)：书签标题（默认：页面标题）
- `parentId` (字符串，可选)：父文件夹 ID 或路径
- `createFolder` (布尔值，可选)：如果不存在则创建文件夹（默认：false）

**示例**：

```json
{
  "url": "https://example.com",
  "title": "示例网站",
  "parentId": "工作/资源",
  "createFolder": true
}
```

### `chrome_bookmark_delete`

按 ID 或 URL 删除书签。

**参数**：

- `bookmarkId` (字符串，可选)：要删除的书签 ID
- `url` (字符串，可选)：要查找并删除的 URL

**示例**：

```json
{
  "url": "https://example.com"
}
```

## 📋 响应格式

所有工具都返回以下格式的响应：

```json
{
  "content": [
    {
      "type": "text",
      "text": "包含实际响应数据的 JSON 字符串"
    }
  ],
  "isError": false
}
```

对于错误：

```json
{
  "content": [
    {
      "type": "text",
      "text": "描述出错原因的错误消息"
    }
  ],
  "isError": true
}
```

## 🔧 使用示例

### 完整工作流示例

```javascript
// 1. 导航到页面
await callTool('chrome_navigate', {
  url: 'https://example.com',
});

// 2. 开始网络监控
await callTool('chrome_network_capture_start', {
  maxCaptureTime: 30000,
});

// 3. 与页面交互
await callTool('chrome_click_element', {
  selector: '#load-data-button',
});

// 4. 语义搜索内容
const searchResults = await callTool('search_tabs_content', {
  query: '用户数据分析',
});

// 5. 停止网络捕获
const networkData = await callTool('chrome_network_capture_stop');

// 6. 保存书签
await callTool('chrome_bookmark_add', {
  title: '数据分析页面',
  parentId: '工作/分析',
});
```

此 API 提供全面的浏览器自动化功能，具有 AI 增强的内容分析和语义搜索特性。
