import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/image-utils', () => ({
  createImageBitmapFromUrl: vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })),
  cropAndResizeImage: vi.fn(),
  canvasToDataURL: vi.fn(),
  stitchImages: vi.fn(),
}));

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    withSession: vi.fn(async (_id, _owner, callback) => callback()),
    sendCommand: vi.fn(async (id, method) =>
      method === 'Page.captureScreenshot'
        ? { data: `image-for-${id}` }
        : { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } },
    ),
  },
}));

import { screenshotTool } from '@/entrypoints/background/tools/browser/screenshot';
import { cdpSessionManager } from '@/utils/cdp-session-manager';
import { targetRegistry } from '@/entrypoints/background/tools/browser/target-registry';
import { screenshotContextManager, scaleCoordinates } from '@/utils/screenshot-context';

describe('target screenshots', () => {
  beforeEach(() => {
    vi.mocked(chrome.tabs.get).mockImplementation(
      async (id) => ({ id, windowId: 1, url: 'https://example.com' }) as chrome.tabs.Tab,
    );
    targetRegistry.bind('shot-a', { id: 101, windowId: 1 } as chrome.tabs.Tab);
    targetRegistry.bind('shot-b', { id: 102, windowId: 1 } as chrome.tabs.Tab);
  });

  it('returns MCP images from each bound tab without capturing the active tab', async () => {
    const results = await Promise.all(
      ['shot-a', 'shot-b'].map((targetId) => screenshotTool.execute({ targetId })),
    );
    expect(results.map((result) => result.content[0])).toEqual([
      { type: 'image', data: 'image-for-101', mimeType: 'image/png' },
      { type: 'image', data: 'image-for-102', mimeType: 'image/png' },
    ]);
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    for (const [index, targetId] of ['shot-a', 'shot-b'].entries()) {
      expect(cdpSessionManager.sendCommand).toHaveBeenCalledWith(
        101 + index,
        'Page.captureScreenshot',
        {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        },
      );
      expect(results[index].content).toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(`"targetId":"${targetId}"`),
        }),
      );
    }
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(scaleCoordinates(800, 600, screenshotContextManager.getContext(101)!)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('fails instead of capturing an unrelated active tab when CDP fails', async () => {
    vi.mocked(cdpSessionManager.sendCommand).mockRejectedValueOnce(new Error('debugger busy'));
    const result = await screenshotTool.execute({ targetId: 'shot-a' });
    expect(result.isError).toBe(true);
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });
});
