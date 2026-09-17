import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { setupTools } from './register-tools';

/**
 * Create a fresh MCP Server instance per session.
 * Tool handlers are stateless (they forward calls to the Chrome extension via native messaging),
 * so sharing them across instances is safe and allows concurrent multi-agent connections.
 */
export const createMcpServer = (): Server => {
  const server = new Server(
    {
      name: 'ChromeMcpServer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  setupTools(server);
  return server;
};
