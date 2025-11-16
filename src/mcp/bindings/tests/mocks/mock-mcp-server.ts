import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Mock MCP Client for testing
 */
export class MockMCPClient {
  private tools: Array<{ name: string; description?: string; inputSchema: any }> = [];
  private connected = false;

  constructor(tools: Array<{ name: string; description?: string; inputSchema: any }> = []) {
    this.tools = tools;
  }

  async connect() {
    this.connected = true;
    return Promise.resolve();
  }

  async listTools() {
    if (!this.connected) {
      throw new Error('Client not connected');
    }
    return {
      tools: this.tools,
    };
  }

  async callTool(params: { name: string; arguments?: any }) {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const tool = this.tools.find((t) => t.name === params.name);
    if (!tool) {
      throw new Error(`Tool ${params.name} not found`);
    }

    // Return mock response
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: params.arguments }),
        },
      ],
    };
  }

  async close() {
    this.connected = false;
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Mock StdioClientTransport for testing
 */
export class MockStdioTransport {
  private closed = false;

  async start() {
    return Promise.resolve();
  }

  async close() {
    this.closed = true;
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Creates a mock Client instance
 */
export function createMockClient(tools: Array<{ name: string; description?: string; inputSchema: any }> = []): Client {
  const mockClient = new MockMCPClient(tools);
  return mockClient as unknown as Client;
}

/**
 * Creates a mock StdioClientTransport instance
 */
export function createMockTransport(): StdioClientTransport {
  const mockTransport = new MockStdioTransport();
  return mockTransport as unknown as StdioClientTransport;
}
