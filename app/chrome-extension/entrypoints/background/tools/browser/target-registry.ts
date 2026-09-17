export interface TargetBinding {
  targetId: string;
  tabId: number;
  windowId?: number;
  createdAt: number;
  lastUsedAt: number;
}

const bindings = new Map<string, TargetBinding>();
const pendingCreates = new Set<string>();

function normalizeTargetId(targetId: unknown): string {
  return typeof targetId === 'string' ? targetId.trim() : '';
}

export const targetRegistry = {
  normalizeTargetId,

  reserveCreate(targetId: string): void {
    if (bindings.has(targetId) || pendingCreates.has(targetId)) {
      throw new Error(
        `Target ${targetId} already exists or is being created. Use a unique targetId or release it first.`,
      );
    }
    pendingCreates.add(targetId);
  },

  finishCreate(targetId: string): void {
    pendingCreates.delete(targetId);
  },

  bind(targetIdInput: unknown, tab: chrome.tabs.Tab, fromCreate = false): TargetBinding {
    const targetId = normalizeTargetId(targetIdInput);
    if (!targetId) {
      throw new Error('targetId must be a non-empty string');
    }
    if (typeof tab.id !== 'number') {
      throw new Error('Cannot bind targetId to a tab without an id');
    }

    const existing = bindings.get(targetId);
    if (pendingCreates.has(targetId) && !fromCreate) {
      throw new Error(`Target ${targetId} is being created`);
    }
    if (existing && existing.tabId !== tab.id) {
      throw new Error(
        `Target ${targetId} is already bound to tab ${existing.tabId}. Release it before rebinding.`,
      );
    }
    for (const binding of bindings.values()) {
      if (binding.targetId !== targetId && binding.tabId === tab.id) {
        throw new Error(
          `Tab ${tab.id} is already bound to target ${binding.targetId}. Use a separate tab for isolation.`,
        );
      }
    }
    const now = Date.now();
    const binding: TargetBinding = {
      targetId,
      tabId: tab.id,
      windowId: tab.windowId,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now,
    };
    bindings.set(targetId, binding);
    return binding;
  },

  async resolve(targetIdInput: unknown): Promise<chrome.tabs.Tab | null> {
    const targetId = normalizeTargetId(targetIdInput);
    if (!targetId) return null;

    const binding = bindings.get(targetId);
    if (!binding) {
      throw new Error(
        `Unknown targetId: ${targetId}. Create it with chrome_target_create or bind an existing tab with chrome_target_bind.`,
      );
    }

    try {
      const tab = await chrome.tabs.get(binding.tabId);
      binding.windowId = tab.windowId;
      binding.lastUsedAt = Date.now();
      bindings.set(targetId, binding);
      return tab;
    } catch {
      bindings.delete(targetId);
      throw new Error(
        `Target ${targetId} points to closed or unavailable tab ${binding.tabId}. Recreate it with chrome_target_create.`,
      );
    }
  },

  release(targetIdInput: unknown): TargetBinding | null {
    const targetId = normalizeTargetId(targetIdInput);
    if (!targetId) {
      throw new Error('targetId must be a non-empty string');
    }
    if (pendingCreates.has(targetId)) throw new Error(`Target ${targetId} is being created`);
    const binding = bindings.get(targetId) ?? null;
    bindings.delete(targetId);
    return binding;
  },

  async list(): Promise<
    Array<TargetBinding & { url?: string; title?: string; active?: boolean; exists: boolean }>
  > {
    const items: Array<
      TargetBinding & { url?: string; title?: string; active?: boolean; exists: boolean }
    > = [];
    for (const [targetId, binding] of bindings.entries()) {
      try {
        const tab = await chrome.tabs.get(binding.tabId);
        binding.windowId = tab.windowId;
        bindings.set(targetId, binding);
        items.push({
          ...binding,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          exists: true,
        });
      } catch {
        bindings.delete(targetId);
        items.push({ ...binding, exists: false });
      }
    }
    return items;
  },
};
