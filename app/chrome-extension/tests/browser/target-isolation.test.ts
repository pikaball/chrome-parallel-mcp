import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseBrowserToolExecutor } from '@/entrypoints/background/tools/base-browser';
import { targetRegistry } from '@/entrypoints/background/tools/browser/target-registry';
import { targetCreateTool, targetBindTool } from '@/entrypoints/background/tools/browser/window';
import { TOOL_NAMES, TOOL_SCHEMAS } from '../../../../packages/shared/src/tools';

class Resolver extends BaseBrowserToolExecutor {
  name = 'test';
  async execute(args: any): Promise<any> {
    return this.resolveTargetTab(args);
  }
}

describe('target isolation', () => {
  beforeEach(async () => {
    for (const binding of await targetRegistry.list()) targetRegistry.release(binding.targetId);
    vi.mocked(chrome.tabs.get).mockImplementation(
      async (id) => ({ id, windowId: 1 }) as chrome.tabs.Tab,
    );
  });

  it('resolves concurrent targets independently of the active tab', async () => {
    targetRegistry.bind('a', { id: 10, windowId: 1 } as chrome.tabs.Tab);
    targetRegistry.bind('b', { id: 20, windowId: 1 } as chrome.tabs.Tab);
    const tabs = await Promise.all(
      ['a', 'b'].map((targetId) => new Resolver().execute({ targetId })),
    );
    expect(tabs.map((tab) => tab.id)).toEqual([10, 20]);
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it('rejects unknown and empty targets even with an explicit tab', async () => {
    await expect(new Resolver().execute({ targetId: 'missing', tabId: 99 })).rejects.toThrow(
      'Unknown targetId',
    );
    await expect(new Resolver().execute({ targetId: ' ' })).rejects.toThrow('non-empty');
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it('rejects tab and window overrides', async () => {
    targetRegistry.bind('a', { id: 10, windowId: 1 } as chrome.tabs.Tab);
    await expect(new Resolver().execute({ targetId: 'a', tabId: 20 })).rejects.toThrow(
      'does not match',
    );
    await expect(new Resolver().execute({ targetId: 'a', windowId: 2 })).rejects.toThrow(
      'does not match',
    );
  });

  it('does not fall back after a tab closes', async () => {
    targetRegistry.bind('a', { id: 10 } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.get).mockRejectedValue(new Error('closed'));
    await expect(new Resolver().execute({ targetId: 'a' })).rejects.toThrow('closed');
    await expect(new Resolver().execute({ tabId: 10 })).rejects.toThrow('Tab not found');
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it('prevents rebinding and sharing the same tab between targets', async () => {
    targetRegistry.bind('a', { id: 10 } as chrome.tabs.Tab);
    expect(() => targetRegistry.bind('a', { id: 20 } as chrome.tabs.Tab)).toThrow('already bound');
    expect(() => targetRegistry.bind('b', { id: 10 } as chrome.tabs.Tab)).toThrow('already bound');
    expect((await targetBindTool.execute({ targetId: 'a', tabId: 10 })).isError).toBe(false);
  });

  it('allows only one concurrent create for an ID', async () => {
    vi.mocked(
      chrome.tabs.create as (options: object) => Promise<chrome.tabs.Tab>,
    ).mockResolvedValue({ id: 30, windowId: 1 } as chrome.tabs.Tab);
    const results = await Promise.all([
      targetCreateTool.execute({ targetId: 'new', windowId: 1 }),
      targetCreateTool.execute({ targetId: 'new', windowId: 1 }),
    ]);
    expect(results.map((result) => result.isError)).toEqual([false, true]);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
    expect((await targetRegistry.resolve('new'))?.id).toBe(30);
  });

  it('keeps discovery available and teaches setup on every page tool', () => {
    for (const name of [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS, TOOL_NAMES.BROWSER.TARGET_LIST]) {
      expect(TOOL_SCHEMAS.find((tool) => tool.name === name)?.inputSchema.required).toEqual([]);
    }
    for (const tool of TOOL_SCHEMAS.filter(
      (tool) =>
        !tool.name.includes('target_') && tool.name !== TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
    )) {
      expect(tool.inputSchema.required).toContain('targetId');
      expect(tool.description).toContain('REQUIRED BEFORE USE');
      expect(tool.description).toContain('chrome_target_bind');
    }
    expect(TOOL_SCHEMAS.some((tool) => tool.name === TOOL_NAMES.BROWSER.SCREENSHOT)).toBe(true);
  });
});
