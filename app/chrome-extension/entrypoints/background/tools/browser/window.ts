import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { targetRegistry } from './target-registry';

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      let tabCount = 0;

      const structuredWindows = windows.map((window) => {
        const tabs =
          window.tabs?.map((tab) => {
            tabCount++;
            return {
              tabId: tab.id || 0,
              url: tab.url || '',
              title: tab.title || '',
              active: tab.active || false,
            };
          }) || [];

        return {
          windowId: window.id || 0,
          tabs: tabs,
        };
      });

      const result = {
        windowCount: windows.length,
        tabCount: tabCount,
        windows: structuredWindows,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in WindowTool.execute:', error);
      return createErrorResponse(
        `Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const windowTool = new WindowTool();

interface TargetCreateParams {
  targetId: string;
  url?: string;
  newWindow?: boolean;
  windowId?: number;
  background?: boolean;
  width?: number;
  height?: number;
}

class TargetCreateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.TARGET_CREATE;

  async execute(args: TargetCreateParams): Promise<ToolResult> {
    let reservedTargetId: string | undefined;
    try {
      const targetId = targetRegistry.normalizeTargetId(args?.targetId);
      if (!targetId) return createErrorResponse('targetId must be a non-empty string');
      targetRegistry.reserveCreate(targetId);
      reservedTargetId = targetId;

      const url = args?.url || 'about:blank';
      const background = args?.background !== false;
      let tab: chrome.tabs.Tab | undefined;

      if (args?.newWindow) {
        const win = await chrome.windows.create({
          url,
          focused: !background,
          width: args.width,
          height: args.height,
        });
        tab = win.tabs?.[0];
      } else {
        let windowId = args?.windowId;
        if (typeof windowId !== 'number') {
          const win = await chrome.windows.getLastFocused({ populate: false });
          windowId = win.id;
        }
        tab = await chrome.tabs.create({ url, windowId, active: !background });
        if (!background && typeof tab.windowId === 'number') {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
      }

      if (!tab || typeof tab.id !== 'number') {
        return createErrorResponse('Failed to create target tab');
      }

      const binding = targetRegistry.bind(targetId, tab, true);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              targetId,
              tabId: binding.tabId,
              windowId: binding.windowId,
              url: tab.url,
              active: tab.active,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Error creating target: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (reservedTargetId) targetRegistry.finishCreate(reservedTargetId);
    }
  }
}

class TargetBindTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.TARGET_BIND;

  async execute(args: { targetId: string; tabId: number }): Promise<ToolResult> {
    try {
      const targetId = targetRegistry.normalizeTargetId(args?.targetId);
      if (!targetId) return createErrorResponse('targetId must be a non-empty string');
      const tab = await this.tryGetTab(args?.tabId);
      if (!tab) return createErrorResponse(`Tab not found: ${args?.tabId}`);
      const binding = targetRegistry.bind(targetId, tab);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              targetId,
              tabId: binding.tabId,
              windowId: binding.windowId,
              url: tab.url,
              active: tab.active,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Error binding target: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class TargetListTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.TARGET_LIST;

  async execute(): Promise<ToolResult> {
    try {
      const targets = await targetRegistry.list();
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, targets }) }],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Error listing targets: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

class TargetReleaseTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.TARGET_RELEASE;

  async execute(args: { targetId: string; closeTab?: boolean }): Promise<ToolResult> {
    try {
      const binding = targetRegistry.release(args?.targetId);
      if (binding && args?.closeTab === true) {
        try {
          await chrome.tabs.remove(binding.tabId);
        } catch {
          // Tab may already be closed; releasing the mapping still succeeds.
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              released: Boolean(binding),
              targetId: targetRegistry.normalizeTargetId(args?.targetId),
              tabId: binding?.tabId,
              closed: Boolean(binding && args?.closeTab === true),
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Error releasing target: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const targetCreateTool = new TargetCreateTool();
export const targetBindTool = new TargetBindTool();
export const targetListTool = new TargetListTool();
export const targetReleaseTool = new TargetReleaseTool();
