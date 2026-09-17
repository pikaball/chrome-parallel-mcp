import { describe, expect, it, vi } from 'vitest';
vi.mock('@/entrypoints/background/tools', () => ({ handleCallTool: vi.fn() }));
import { ensureTab } from '@/entrypoints/background/record-replay/rr-utils';

describe('flow initial target', () => {
  it('navigates the supplied tab without consulting active tabs', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 42 } as chrome.tabs.Tab);
    vi.mocked(
      chrome.tabs.update as (id: number, options: object) => Promise<chrome.tabs.Tab>,
    ).mockResolvedValue({
      id: 42,
      url: 'https://example.com',
    } as chrome.tabs.Tab);
    expect(await ensureTab({ tabId: 42, startUrl: 'https://example.com' })).toEqual({
      tabId: 42,
      url: 'https://example.com',
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { url: 'https://example.com' });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });
});
