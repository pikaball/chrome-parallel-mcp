import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import {
  NativeMessageType,
  TARGET_SETUP_DESCRIPTION,
  TOOL_NAMES,
  TOOL_SCHEMAS,
} from 'chrome-mcp-shared';
import {
  formatScreenshotOutput,
  screenshotOutputMode,
  verifyScreenshotTarget,
} from './screenshot-output';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const toolSchemaByName = new Map(TOOL_SCHEMAS.map((tool) => [tool.name, tool]));

async function listDynamicFlowTools(): Promise<Tool[]> {
  try {
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {},
      'rr_list_published_flows',
      20000,
    );
    if (response && response.status === 'success' && Array.isArray(response.items)) {
      const tools: Tool[] = [];
      for (const item of response.items) {
        const name = `flow.${item.slug}`;
        const description =
          (item.meta && item.meta.tool && item.meta.tool.description) ||
          item.description ||
          'Recorded flow';
        const properties: Record<string, any> = {};
        const required: string[] = [];
        for (const v of item.variables || []) {
          const desc = v.label || v.key;
          const typ = (v.type || 'string').toLowerCase();
          const prop: any = { description: desc };
          if (typ === 'boolean') prop.type = 'boolean';
          else if (typ === 'number') prop.type = 'number';
          else if (typ === 'enum') {
            prop.type = 'string';
            if (v.rules && Array.isArray(v.rules.enum)) prop.enum = v.rules.enum;
          } else if (typ === 'array') {
            // default array of strings; can extend with itemType later
            prop.type = 'array';
            prop.items = { type: 'string' };
          } else {
            prop.type = 'string';
          }
          if (v.default !== undefined) prop.default = v.default;
          if (v.rules && v.rules.required) required.push(v.key);
          properties[v.key] = prop;
        }
        // Run options
        properties['tabTarget'] = { type: 'string', enum: ['current', 'new'], default: 'current' };
        properties['refresh'] = { type: 'boolean', default: false };
        properties['captureNetwork'] = { type: 'boolean', default: false };
        properties['returnLogs'] = { type: 'boolean', default: false };
        properties['timeoutMs'] = { type: 'number', minimum: 0 };
        properties['targetId'] = {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description: TARGET_SETUP_DESCRIPTION,
        };
        required.push('targetId');
        const tool: Tool = {
          name,
          description: `${TARGET_SETUP_DESCRIPTION}\n\n${description}`,
          inputSchema: { type: 'object', properties, required },
        };
        tools.push(tool);
      }
      return tools;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export const setupTools = (server: Server) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools();
    return { tools: [...TOOL_SCHEMAS, ...dynamicTools] };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  try {
    if (
      toolSchemaByName.get(name)?.inputSchema.required?.includes('targetId') &&
      (typeof args?.targetId !== 'string' || !args.targetId.trim())
    ) {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${name} requires a non-empty targetId. First call chrome_target_create({targetId: "unique-agent-id"}) to create and bind a new tab, OR get_windows_and_tabs({}) then chrome_target_bind({targetId: "unique-agent-id", tabId: <existing tab>}). Reuse that targetId in subsequent calls.`,
          },
        ],
        isError: true,
      };
    }

    // If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
    if (name && name.startsWith('flow.')) {
      if (typeof args?.targetId !== 'string' || !args.targetId.trim()) {
        return {
          content: [{ type: 'text', text: `Error calling tool: ${name} requires targetId.` }],
          isError: true,
        };
      }
      // We need to resolve flow by slug to ID
      try {
        const resp = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          {},
          'rr_list_published_flows',
          20000,
        );
        const items = (resp && resp.items) || [];
        const slug = name.slice('flow.'.length);
        const match = items.find((it: any) => it.slug === slug);
        if (!match) throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.id, args, targetId: args.targetId };
        const proxyRes = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          { name: 'record_replay_flow_run', args: flowArgs },
          NativeMessageType.CALL_TOOL,
          120000,
        );
        if (proxyRes.status === 'success') return proxyRes.data;
        return {
          content: [{ type: 'text', text: `Error calling dynamic flow tool: ${proxyRes.error}` }],
          isError: true,
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    const isScreenshot =
      name === TOOL_NAMES.BROWSER.SCREENSHOT ||
      (name === TOOL_NAMES.BROWSER.COMPUTER && args?.action === 'screenshot');
    const output = isScreenshot ? screenshotOutputMode(args) : undefined;
    // The extension supplies image bytes; only the native host can write /tmp files.
    const extensionArgs = isScreenshot ? { ...args, storeBase64: true, background: true } : args;
    // 发送请求到Chrome扩展并等待响应
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name: isScreenshot ? TOOL_NAMES.BROWSER.SCREENSHOT : name,
        args: extensionArgs,
      },
      NativeMessageType.CALL_TOOL,
      120000, // 延长到 120 秒，避免性能分析等长任务超时
    );
    if (response.status === 'success') {
      if (isScreenshot) verifyScreenshotTarget(response.data, args.targetId);
      return output ? await formatScreenshotOutput(response.data, output) : response.data;
    } else {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling tool: ${response.error}`,
          },
        ],
        isError: true,
      };
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error calling tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};
