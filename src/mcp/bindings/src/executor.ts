import { fetchToolSchemas } from "./converter.js";
import { closeAllConnections } from "./client.js";

declare const global: any;

interface ToolInfo {
  serverName: string;
  toolName: string;
  functionName: string;
  description?: string;
  inputSchema: any;
  outputSchema?: any;
}

interface ExecutionResult {
  result: any;
  logs: string[];
  exitCode: 0 | 1;
  error?: string;
}

const toolsMetadata: ToolInfo[] = [];
let isInitialized = false;

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
};

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
        return await callTool(serverName, tool.name, input);
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
// Console Capture
// ============================================

function createLogCapture(): { logs: string[], start: () => void, stop: () => void } {
  const logs: string[] = [];

  const start = () => {
    console.log = (...args: any[]) => {
      logs.push(args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    };

    console.error = (...args: any[]) => {
      logs.push('[ERROR] ' + args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    };

    console.warn = (...args: any[]) => {
      logs.push('[WARN] ' + args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '));
    };
  };

  const stop = () => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
  };

  return { logs, start, stop };
}

// ============================================
// Code Execution
// ============================================

async function executeCode(code: string): Promise<ExecutionResult> {
  await initializeMCPTools();

  const logCapture = createLogCapture();
  logCapture.start();

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(code);
    const result = await fn();

    logCapture.stop();

    return {
      result,
      logs: logCapture.logs,
      exitCode: 0,
    };

  } catch (error) {
    logCapture.stop();

    return {
      result: null,
      logs: logCapture.logs,
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// CLI Entry Point
// ============================================

async function main() {
  const code = process.argv[2];

  if (!code) {
    originalConsole.error("Usage: tsx executor.ts '<code>'");
    process.exit(1);
  }

  try {
    const result = await executeCode(code);
    originalConsole.log(JSON.stringify(result));
    process.exit(result.exitCode);

  } catch (error) {
    originalConsole.error("Fatal error:", error);
    process.exit(1);

  } finally {
    await closeAllConnections();
  }
}

// Run if executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
