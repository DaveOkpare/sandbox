import { fetchToolSchemas } from "./converter.js";
import { runExecutor, originalConsole } from "./executor-utils.js";

declare const global: any;

interface ToolInfo {
  serverName: string;
  toolName: string;
  functionName: string;
  description?: string;
  inputSchema: any;
  outputSchema?: any;
}

const toolsMetadata: ToolInfo[] = [];
let isInitialized = false;

// ============================================
// Helper Functions
// ============================================

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function getMCPConfigFromEnv(): Record<string, any> {
  const config: Record<string, any> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MCP_SERVER_")) {
      const serverName = key.replace("MCP_SERVER_", "").toLowerCase();
      try {
        config[serverName] = JSON.parse(value!);
      } catch (error: any) {
        originalConsole.error(`Failed to parse config for ${serverName}`);
      }
    }
  }

  return config;
}

async function callTool(serverName: string, toolName: string, input: any): Promise<any> {
  const { callMCPTool } = await import("./client.js");
  return callMCPTool(`${serverName}__${toolName}`, input);
}

async function initializeMCPTools(): Promise<void> {
  if (isInitialized) {
    return;
  }

  originalConsole.error("🚀 Initializing MCP tools...");

  const mcpConfig = getMCPConfigFromEnv();

  if (Object.keys(mcpConfig).length === 0) {
    originalConsole.error("⚠️  No MCP servers configured");
    isInitialized = true;
    return;
  }

  const schemas = await fetchToolSchemas(mcpConfig);

  for (const { serverName, tools } of schemas) {
    originalConsole.error(`✅ ${serverName}: ${tools.length} tools`);

    const serverTools: Record<string, Function> = {};

    for (const tool of tools) {
      const functionName = toCamelCase(tool.name);

      toolsMetadata.push({
        serverName,
        toolName: tool.name,
        functionName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      });

      serverTools[functionName] = async (input: any) => {
        // Auto-wrap primitive values if schema expects an object with a single required property
        let processedInput = input;

        if (input !== null && typeof input !== 'object' && tool.inputSchema) {
          const required = tool.inputSchema.required || [];

          // If there's exactly one required property, auto-wrap the value
          if (required.length === 1) {
            const paramName = required[0];
            processedInput = { [paramName]: input };
          }
        }

        return await callTool(serverName, tool.name, processedInput);
      };
    }

    (global as any)[serverName] = serverTools;
  }

  (global as any).__tools = {
    servers: () => Object.keys(mcpConfig),

    list: () => toolsMetadata.map(t => ({
      server: t.serverName,
      function: `${t.serverName}.${t.functionName}`,
      description: t.description,
    })),

    info: (serverName: string, functionName: string): ToolInfo | undefined => {
      return toolsMetadata.find(
        t => t.serverName === serverName && t.functionName === functionName
      );
    },

    search: (keyword: string) => {
      return toolsMetadata.filter(t =>
        t.description?.toLowerCase().includes(keyword.toLowerCase()) ||
        t.functionName.toLowerCase().includes(keyword.toLowerCase())
      );
    },
  };

  isInitialized = true;
  originalConsole.error("✨ MCP tools ready!\n");
}

// ============================================
// Main Execution Handler
// ============================================

runExecutor(async (code: string) => {
  await initializeMCPTools();

  const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
  const fn = new AsyncFunction(code);
  return await fn();
});
