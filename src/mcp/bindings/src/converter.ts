import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
 * Connect to MCP servers and fetch tool schemas
 * @param mcpConfig - Configuration for all MCP servers
 * @returns Array of server tools with their schemas
 */
export async function fetchToolSchemas(mcpConfig: MCPConfig): Promise<ServerTools[]> {
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

    try {
      await client.connect(transport);
      console.log(`✅ Connected to ${serverName}`);

      const toolsResponse = await client.listTools();
      console.log(`📋 Found ${toolsResponse.tools.length} tools in ${serverName}`);

      const tools: ToolSchema[] = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: (tool as any).outputSchema,
      }));

      serverToolsList.push({
        serverName,
        tools,
      });

      await transport.close();
    } catch (error) {
      console.error(`❌ Error connecting to ${serverName}:`, error);
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
    // Remove titles from properties to generate inline types instead of separate exports
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

    // Generate the tool function file
    const toolContent = `import { callMCPTool } from "../client.js";

${inputInterface}
${outputInterface ? `\n${outputInterface}\n` : ""}
${tool.description ? `/* ${tool.description} */\n` : ""}export async function ${functionName}(input: ${inputInterfaceName}): Promise<${outputType}> {
  return callMCPTool<${outputType}>('${serverName}__${tool.name}', input);
}
`;

    // Write tool file
    const toolFilePath = path.join(serverDir, `${functionName}.ts`);
    await fs.writeFile(toolFilePath, toolContent, "utf-8");
    console.log(`  ✓ ${functionName}.ts`);
  }

  // Generate index.ts barrel export with proper interface names
  const indexContent =
    functionNames
      .map((name) => {
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);
        return `export { ${name}, ${capitalizedName}Input } from "./${name}.js";`;
      })
      .join("\n") + "\n";

  await fs.writeFile(path.join(serverDir, "index.ts"), indexContent, "utf-8");
  console.log(`  ✓ index.ts`);
}
