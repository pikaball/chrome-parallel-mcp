import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function screenshotOutputMode(args: Record<string, unknown>): 'file' | 'base64' {
  const output = args.output ?? (args.storeBase64 === true ? 'base64' : 'file');
  if (output !== 'file' && output !== 'base64') {
    throw new Error('output must be "file" (recommended) or "base64"');
  }
  return output;
}

export function verifyScreenshotTarget(result: CallToolResult, targetId: string): void {
  if (result.isError) return;
  const verified = result.content.some((item) => {
    if (item.type !== 'text') return false;
    try {
      const metadata = JSON.parse(item.text);
      return (
        metadata?.captureBackend === 'cdp-tab-v1' &&
        metadata.targetId === targetId.trim() &&
        Number.isInteger(metadata.tabId)
      );
    } catch {
      return false;
    }
  });
  if (!verified) {
    throw new Error(
      'Screenshot target isolation could not be verified. No image returned or saved. Reload the updated Chrome extension (not just the native server), recreate/rebind targetId, and retry. Legacy active-tab screenshots are refused.',
    );
  }
}

export async function formatScreenshotOutput(
  result: CallToolResult,
  output: 'file' | 'base64',
): Promise<CallToolResult> {
  if (result.isError || output === 'base64') return result;
  let image: { data: string; mimeType: string } | undefined;
  const metadataContent: CallToolResult['content'] = [];
  for (const item of result.content) {
    if (item.type === 'image') {
      image ??= item;
      continue;
    }
    if (item.type === 'text') {
      let payload: unknown;
      try {
        payload = JSON.parse(item.text);
      } catch {
        // Non-JSON text is ordinary screenshot metadata.
      }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const { base64Data, mimeType, ...metadata } = payload as Record<string, unknown>;
        if (typeof base64Data === 'string' && typeof mimeType === 'string') {
          image ??= { data: base64Data, mimeType };
          if (Object.keys(metadata).length) {
            metadataContent.push({ type: 'text', text: JSON.stringify(metadata) });
          }
          continue;
        }
      }
    }
    metadataContent.push(item);
  }
  if (!image?.data || !['image/png', 'image/jpeg'].includes(image.mimeType)) {
    throw new Error('Screenshot did not return a supported PNG or JPEG image to save');
  }
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const directory = '/tmp/chrome-mcp-screenshots';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = join(directory, `${randomUUID()}.${extension}`);
  await writeFile(filePath, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 });
  return {
    ...result,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          output: 'file',
          filePath,
          mimeType: image.mimeType,
          fallback:
            'Read this image file with your image-reading tool. If this native-server path is inaccessible, repeat the screenshot call with output="base64".',
        }),
      },
      ...metadataContent,
    ],
  };
}
