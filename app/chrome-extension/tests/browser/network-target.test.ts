import { describe, expect, it, vi } from 'vitest';
import {
  networkDebuggerStartTool,
  networkDebuggerStopTool,
} from '@/entrypoints/background/tools/browser/network-capture-debugger';
import {
  networkCaptureStartTool,
  networkCaptureStopTool,
} from '@/entrypoints/background/tools/browser/network-capture-web-request';
import { networkCaptureTool } from '@/entrypoints/background/tools/browser/network-capture';

describe('network capture target isolation', () => {
  it.each([
    ['debugger', networkDebuggerStartTool, networkDebuggerStopTool],
    ['webRequest', networkCaptureStartTool, networkCaptureStopTool],
  ] as const)('stops only the requested tab with %s', async (_name, start, stop) => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 1, windowId: 1 } as chrome.tabs.Tab);
    const captures = (start as any).captureData as Map<number, unknown>;
    captures.set(1, {});
    captures.set(2, {});
    const stopSpy = vi
      .spyOn(start as { stopCapture: (id: number) => Promise<any> }, 'stopCapture')
      .mockImplementation(async (id) => {
        captures.delete(id);
        return { success: true, data: {} } as any;
      });
    try {
      const result = await stop.execute({ tabId: 1 });
      expect(result.isError).toBe(false);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledWith(1);
      expect(captures.has(2)).toBe(true);
    } finally {
      captures.clear();
    }
  });

  it('does not stop another tab when this target has no capture', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 1, windowId: 1 } as chrome.tabs.Tab);
    networkCaptureStartTool.captureData.set(2, {} as any);
    const stop = vi.spyOn(networkCaptureStartTool, 'stopCapture');
    try {
      expect((await networkCaptureTool.execute({ tabId: 1, action: 'stop' })).isError).toBe(true);
      expect(stop).not.toHaveBeenCalled();
    } finally {
      networkCaptureStartTool.captureData.clear();
    }
  });
});
