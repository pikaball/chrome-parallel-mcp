import { readFile, unlink } from 'node:fs/promises';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  formatScreenshotOutput,
  screenshotOutputMode,
  verifyScreenshotTarget,
} from './screenshot-output';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const result: CallToolResult = { content: [{ type: 'image', data: png, mimeType: 'image/png' }] };

describe('screenshot output', () => {
  it('refuses legacy or mismatched captures before exposing their pixels', () => {
    expect(() => verifyScreenshotTarget(result, 'a')).toThrow('Reload');
    const capture: CallToolResult = {
      content: [
        ...result.content,
        {
          type: 'text',
          text: JSON.stringify({ captureBackend: 'cdp-tab-v1', targetId: 'a', tabId: 101 }),
        },
      ],
    };
    expect(() => verifyScreenshotTarget(capture, 'b')).toThrow('isolation');
    expect(() => verifyScreenshotTarget(capture, 'a')).not.toThrow();
  });
  it('defaults to file and supports the legacy alias and explicit override', () => {
    expect(screenshotOutputMode({})).toBe('file');
    expect(screenshotOutputMode({ storeBase64: true })).toBe('base64');
    expect(screenshotOutputMode({ output: 'file', storeBase64: true })).toBe('file');
    expect(() => screenshotOutputMode({ output: 'invalid' })).toThrow('output');
  });

  it('saves concurrent screenshots to unique /tmp PNGs without returning image bytes', async () => {
    const paths: string[] = [];
    try {
      const outputs = await Promise.all([
        formatScreenshotOutput(result, 'file'),
        formatScreenshotOutput(result, 'file'),
      ]);
      for (const output of outputs) {
        const first = output.content[0];
        if (first.type !== 'text') throw new Error('Expected file metadata');
        const metadata = JSON.parse(first.text);
        paths.push(metadata.filePath);
        expect(metadata.filePath).toMatch(/^\/tmp\/chrome-mcp-screenshots\/.+\.png$/);
        expect(await readFile(metadata.filePath)).toEqual(Buffer.from(png, 'base64'));
        expect(output.content.some((item) => item.type === 'image')).toBe(false);
        expect(metadata.fallback).toContain('output="base64"');
      }
      expect(new Set(paths).size).toBe(2);
    } finally {
      await Promise.all(paths.map((path) => unlink(path)));
    }
  });

  it('passes base64 images and tool errors through unchanged', async () => {
    expect(await formatScreenshotOutput(result, 'base64')).toBe(result);
    const error = { content: [], isError: true };
    expect(await formatScreenshotOutput(error, 'file')).toBe(error);
  });

  it.each(['image', 'legacy-json'] as const)(
    'saves JPEG from %s without leaking base64 into file output',
    async (format) => {
      const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
      const input: CallToolResult = {
        content: [
          format === 'image'
            ? { type: 'image', data: jpeg, mimeType: 'image/jpeg' }
            : {
                type: 'text',
                text: JSON.stringify({ base64Data: jpeg, mimeType: 'image/jpeg', tabId: 42 }),
              },
          { type: 'text', text: 'Screenshot captured' },
        ],
      };
      const output = await formatScreenshotOutput(input, 'file');
      const first = output.content[0];
      if (first.type !== 'text') throw new Error('Expected file metadata');
      const metadata = JSON.parse(first.text);
      try {
        expect(metadata.filePath).toMatch(/^\/tmp\/chrome-mcp-screenshots\/.+\.jpg$/);
        expect(metadata.mimeType).toBe('image/jpeg');
        expect(await readFile(metadata.filePath)).toEqual(Buffer.from(jpeg, 'base64'));
        expect(JSON.stringify(output)).not.toContain(jpeg);
        expect(output.content).toContainEqual({ type: 'text', text: 'Screenshot captured' });
        if (format === 'legacy-json') {
          expect(output.content).toContainEqual({
            type: 'text',
            text: JSON.stringify({ tabId: 42 }),
          });
        }
        expect(await formatScreenshotOutput(input, 'base64')).toBe(input);
      } finally {
        await unlink(metadata.filePath);
      }
    },
  );

  it('accepts legacy JSON PNG output', async () => {
    const output = await formatScreenshotOutput(
      {
        content: [
          { type: 'text', text: JSON.stringify({ base64Data: png, mimeType: 'image/png' }) },
        ],
      },
      'file',
    );
    const first = output.content[0];
    if (first.type !== 'text') throw new Error('Expected file metadata');
    const { filePath } = JSON.parse(first.text);
    try {
      expect(filePath).toMatch(/\.png$/);
      expect(await readFile(filePath)).toEqual(Buffer.from(png, 'base64'));
      expect(output.content).toHaveLength(1);
    } finally {
      await unlink(filePath);
    }
  });

  it('rejects file output when no image was captured', async () => {
    await expect(formatScreenshotOutput({ content: [] }, 'file')).rejects.toThrow('PNG');
  });
});
