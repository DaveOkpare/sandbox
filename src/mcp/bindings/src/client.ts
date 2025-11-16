import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface MCPServerConfig {
  command: string;
  args: string[];
}

const clientRegistry = new Map<string, Client>();
const transportRegistry = new Map<string, StdioClientTransport>();

async function getOrCreateClient(serverName: string, config: MCPServerConfig): Promise<Client> {
  if (clientRegistry.has(serverName)) {
    return clientRegistry.get(serverName)!;
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
  });

  const client = new Client({
    name: "sandbox-mcp-client",
    version: "1.0.0",
  });

  await client.connect(transport);

  clientRegistry.set(serverName, client);
  transportRegistry.set(serverName, transport);

  return client;
}

/**
 * Call MCP tool with type-safe input/output
 * @param toolName - Full tool name in format "servername__toolname"
 * @param input - Tool input parameters
 * @returns Tool execution result
 */
export async function callMCPTool<T = any>(toolName: string, input: any): Promise<T> {
  const parts = toolName.split("__");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid tool name format: ${toolName}. Expected format: "servername__toolname"`
    );
  }

  const [serverName, actualToolName] = parts;

  const serverConfigJson = process.env[`MCP_SERVER_${serverName.toUpperCase()}`];
  if (!serverConfigJson) {
    throw new Error(
      `MCP server configuration not found for: ${serverName}. ` +
        `Expected environment variable: MCP_SERVER_${serverName.toUpperCase()}`
    );
  }

  const serverConfig: MCPServerConfig = JSON.parse(serverConfigJson);
  const client = await getOrCreateClient(serverName, serverConfig);

  const result = await client.callTool({
    name: actualToolName,
    arguments: input,
  });

  return result.content as T;
}

export async function closeAllConnections(): Promise<void> {
  for (const [serverName, transport] of transportRegistry.entries()) {
    try {
      await transport.close();
      clientRegistry.delete(serverName);
      transportRegistry.delete(serverName);
    } catch (error) {
      console.error(`Error closing connection to ${serverName}:`, error);
    }
  }
}

process.on("beforeExit", async () => {
  await closeAllConnections();
});
