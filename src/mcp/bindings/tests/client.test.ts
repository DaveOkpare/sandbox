import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// We need to mock the modules before importing the client
const mockClient = {
  connect: jest.fn() as any,
  callTool: jest.fn() as any,
  close: jest.fn() as any,
};

const mockTransport = {
  close: jest.fn() as any,
};

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => mockTransport),
}));

describe.skip('client.ts', () => {
  let callMCPTool: any;
  let closeAllConnections: any;

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Clear module cache to get fresh imports
    jest.resetModules();

    // Re-import the client module
    const clientModule = await import('../src/client.js');
    callMCPTool = clientModule.callMCPTool;
    closeAllConnections = clientModule.closeAllConnections;

    // Reset environment variables
    delete process.env.MCP_SERVER_TEST_SERVER;
    delete process.env.MCP_SERVER_SERVER_ONE;
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.MCP_SERVER_TEST_SERVER;
    delete process.env.MCP_SERVER_SERVER_ONE;
  });

  describe('callMCPTool', () => {
    it('should throw error for invalid tool name format (missing __)', async () => {
      await expect(callMCPTool('invalid_tool_name', {})).rejects.toThrow(
        'Invalid tool name format: invalid_tool_name. Expected format: "servername__toolname"'
      );
    });

    it('should throw error for invalid tool name format (too many parts)', async () => {
      await expect(callMCPTool('server__tool__extra', {})).rejects.toThrow(
        'Invalid tool name format: server__tool__extra. Expected format: "servername__toolname"'
      );
    });

    it('should throw error when environment variable not found', async () => {
      await expect(callMCPTool('test_server__get_user', {})).rejects.toThrow(
        'MCP server configuration not found for: test_server. Expected environment variable: MCP_SERVER_TEST_SERVER'
      );
    });

    it('should throw error on invalid JSON in environment variable', async () => {
      process.env.MCP_SERVER_TEST_SERVER = 'invalid-json';

      await expect(callMCPTool('test_server__get_user', {})).rejects.toThrow();
    });

    it('should successfully call tool with valid configuration', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      const mockResult = {
        content: [{ type: 'text', text: 'success' }],
      };

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await callMCPTool('test_server__get_user', { user_id: '123' });

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: 'node',
        args: ['test-server.js'],
      });
      expect(Client).toHaveBeenCalledWith({
        name: 'sandbox-mcp-client',
        version: '1.0.0',
      });
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'get_user',
        arguments: { user_id: '123' },
      });
      expect(result).toEqual(mockResult.content);
    });

    it('should reuse existing client connection for same server', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      const mockResult = {
        content: [{ type: 'text', text: 'success' }],
      };

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue(mockResult);

      // First call
      await callMCPTool('test_server__get_user', { user_id: '123' });

      // Second call
      await callMCPTool('test_server__get_data', { id: '456' });

      // Client should only be created once
      expect(Client).toHaveBeenCalledTimes(1);
      expect(StdioClientTransport).toHaveBeenCalledTimes(1);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);

      // But tool should be called twice
      expect(mockClient.callTool).toHaveBeenCalledTimes(2);
    });

    it('should handle type casting correctly', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      interface UserResponse {
        id: string;
        name: string;
      }

      const mockResult = {
        content: { id: '123', name: 'John' },
      };

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await callMCPTool<UserResponse>('test_server__get_user', { user_id: '123' });

      expect(result).toEqual(mockResult.content);
    });
  });

  describe('closeAllConnections', () => {
    it('should close all connections and clear registries', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue({ content: [] });
      mockTransport.close.mockResolvedValue(undefined);

      // Create a connection
      await callMCPTool('test_server__get_user', {});

      // Close all connections
      await closeAllConnections();

      expect(mockTransport.close).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during close gracefully', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue({ content: [] });
      mockTransport.close.mockRejectedValue(new Error('Close failed'));

      // Spy on console.error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Create a connection
      await callMCPTool('test_server__get_user', {});

      // Close all connections (should not throw)
      await closeAllConnections();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error closing connection to test_server:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle empty registries', async () => {
      // Should not throw when there are no connections
      await expect(closeAllConnections()).resolves.not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle server names with special characters in env var', async () => {
      process.env.MCP_SERVER_SERVER_ONE = JSON.stringify({
        command: 'node',
        args: ['server1.js'],
      });

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockResolvedValue({ content: [] });

      await callMCPTool('server_one__get_data', {});

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'get_data',
        arguments: {},
      });
    });

    it('should handle connection failures', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      mockClient.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(callMCPTool('test_server__get_user', {})).rejects.toThrow('Connection failed');
    });

    it('should handle tool call failures', async () => {
      process.env.MCP_SERVER_TEST_SERVER = JSON.stringify({
        command: 'node',
        args: ['test-server.js'],
      });

      mockClient.connect.mockResolvedValue(undefined);
      mockClient.callTool.mockRejectedValue(new Error('Tool not found'));

      await expect(callMCPTool('test_server__invalid_tool', {})).rejects.toThrow('Tool not found');
    });
  });
});
