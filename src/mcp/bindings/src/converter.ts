import { compile } from "json-schema-to-typescript";
import * as fs from "fs/promises";
import * as path from "path";

interface MCPServerConfig {
  command: string;
  args: string[];
}

interface MCPConfig {
  [serverName: string]: MCPServerConfig;
}

interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: any;
  outputSchema?: any;
}

interface ServerTools {
  serverName: string;
  tools: ToolSchema[];
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toKebabCase(str: string): string {
  return str.replace(/_/g, "-");
}

/**
 * Normalize incomplete schemas from MCP servers
 * Some servers return schemas with only $schema field, missing type/properties
 */
function normalizeSchema(schema: any): any {
  if (!schema) {
    return { type: "object", properties: {}, required: [] };
  }

  if (!schema.type) {
    return {
      ...schema,
      type: "object",
      properties: schema.properties || {},
      required: schema.required || [],
    };
  }

  return schema;
}

/**
 * Connect to MCP servers and fetch tool schemas
 * Intercepts raw messages before SDK validation to handle incomplete schemas
 * @param mcpConfig - Configuration for all MCP servers
 * @returns Array of server tools with their schemas
 */
export async function fetchToolSchemas(mcpConfig: MCPConfig): Promise<ServerTools[]> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const serverToolsList: ServerTools[] = [];

  for (const [serverName, config] of Object.entries(mcpConfig)) {
    console.log(`📡 Connecting to MCP server: ${serverName}...`);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
    });

    const client = new Client({
      name: "mcp-generator",
      version: "1.0.0",
    });

    let rawToolsData: any = null;

    const originalOnMessage = (transport as any).onmessage;
    (transport as any).onmessage = function (message: any) {
      if (message?.result?.tools) {
        rawToolsData = message.result.tools;
      }
      if (originalOnMessage) {
        return originalOnMessage.call(this, message);
      }
    };

    try {
      await client.connect(transport);
      console.log(`✅ Connected to ${serverName}`);

      try {
        const toolsResponse = await client.listTools();
        rawToolsData = toolsResponse.tools;
      } catch (error: any) {
        if (!rawToolsData) {
          throw error;
        }
        console.log(`⚠️  SDK validation failed, using intercepted data...`);
      }

      if (!rawToolsData) {
        throw new Error("Failed to retrieve tools data");
      }

      console.log(`📋 Found ${rawToolsData.length} tools in ${serverName}`);

      const tools: ToolSchema[] = rawToolsData.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: normalizeSchema(tool.inputSchema),
        outputSchema: tool.outputSchema ? normalizeSchema(tool.outputSchema) : undefined,
      }));

      serverToolsList.push({
        serverName,
        tools,
      });

      await transport.close();
    } catch (error) {
      console.error(`❌ Error connecting to ${serverName}:`, error);
      try {
        await transport.close();
      } catch { }
      throw error;
    }
  }

  return serverToolsList;
}

/**
 * Convert JSON Schema to TypeScript interface with inline types
 * @param schema - JSON Schema object
 * @param interfaceName - Interface name to use
 * @returns TypeScript interface definition as string
 */
export async function convertSchemaToTypeScript(
  schema: any,
  interfaceName: string
): Promise<string> {
  try {
    const cleanedSchema = {
      ...schema,
      title: interfaceName,
      properties: schema.properties
        ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, prop]: [string, any]) => [
            key,
            { ...prop, title: undefined },
          ])
        )
        : undefined,
    };

    const tsOutput = await compile(cleanedSchema, interfaceName, {
      bannerComment: "",
      style: { semi: true, singleQuote: false },
    });

    return tsOutput.trim();
  } catch (error) {
    console.error(`Error converting schema for ${interfaceName}:`, error);
    return `export interface ${interfaceName} {\n  [k: string]: any;\n}`;
  }
}

/**
 * Generate TypeScript function files for each MCP tool
 * @param serverName - Name of the MCP server
 * @param tools - Array of tool schemas
 * @param outputDir - Base output directory (e.g., ".servers")
 */
export async function writeToolFiles(
  serverName: string,
  tools: ToolSchema[],
  outputDir: string
): Promise<void> {
  const serverDir = path.join(outputDir, toKebabCase(serverName));
  await fs.mkdir(serverDir, { recursive: true });

  console.log(`📁 Creating ${tools.length} files in ${serverDir}/`);

  const functionNames: string[] = [];

  for (const tool of tools) {
    const functionName = toCamelCase(tool.name);
    functionNames.push(functionName);

    const capitalizedFunctionName = functionName.charAt(0).toUpperCase() + functionName.slice(1);
    const inputInterfaceName = `${capitalizedFunctionName}Input`;
    const inputInterface = await convertSchemaToTypeScript(tool.inputSchema, inputInterfaceName);

    let outputInterface = "";
    let outputType = "any";
    if (tool.outputSchema) {
      const outputInterfaceName = `${capitalizedFunctionName}Response`;
      outputInterface = await convertSchemaToTypeScript(tool.outputSchema, outputInterfaceName);
      outputType = outputInterfaceName;
    }

    const toolContent = `import { callMCPTool } from "../client";

${inputInterface}
${outputInterface ? `\n${outputInterface}\n` : ""}
${tool.description ? `/* ${tool.description} */\n` : ""}export async function ${functionName}(input: ${inputInterfaceName}): Promise<${outputType}> {
  return callMCPTool<${outputType}>('${serverName}__${tool.name}', input);
}
`;

    const toolFilePath = path.join(serverDir, `${functionName}.ts`);
    await fs.writeFile(toolFilePath, toolContent, "utf-8");
    console.log(`  ✓ ${functionName}.ts`);
  }

  const indexContent =
    functionNames
      .map((name) => {
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
        return `export { ${name}, ${capitalizedName}Input } from "./${name}";`;
      })
      .join("\n") + "\n";

  await fs.writeFile(path.join(serverDir, "index.ts"), indexContent, "utf-8");
  console.log(`  ✓ index.ts`);
}
