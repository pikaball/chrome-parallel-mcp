import { createErrorResponse } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import * as browserTools from './browser';
import { flowRunTool, listPublishedFlowsTool } from './record-replay';
import { targetRegistry } from './browser/target-registry';

const tools = { ...browserTools, flowRunTool, listPublishedFlowsTool } as any;
const toolsMap = new Map(Object.values(tools).map((tool: any) => [tool.name, tool]));
const targetRegistryToolNames = new Set([
  browserTools.targetCreateTool.name,
  browserTools.targetBindTool.name,
  browserTools.targetListTool.name,
  browserTools.targetReleaseTool.name,
]);

/**
 * Tool call parameter interface
 */
export interface ToolCallParam {
  name: string;
  args: any;
}

/**
 * Handle tool execution
 */
export const handleCallTool = async (param: ToolCallParam) => {
  const tool = toolsMap.get(param.name);
  if (!tool) {
    return createErrorResponse(`Tool ${param.name} not found`);
  }

  try {
    const args = await resolveTargetArgs(param.name, param.args);
    return await tool.execute(args);
  } catch (error) {
    console.error(`Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
    );
  }
};

async function resolveTargetArgs(name: string, args: any) {
  if (!args || typeof args !== 'object' || targetRegistryToolNames.has(name)) {
    return args;
  }
  if (args.targetId === undefined) {
    return args;
  }

  const tab = await targetRegistry.resolve(args.targetId);
  if (!tab?.id) throw new Error('targetId must be a non-empty string');
  if (args.tabId !== undefined && args.tabId !== tab.id) {
    throw new Error(`tabId ${args.tabId} does not match targetId ${args.targetId}`);
  }
  if (args.windowId !== undefined && args.windowId !== tab.windowId) {
    throw new Error(`windowId ${args.windowId} does not match targetId ${args.targetId}`);
  }
  return { ...args, tabId: tab.id, windowId: tab.windowId };
}
