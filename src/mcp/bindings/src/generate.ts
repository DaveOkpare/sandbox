#!/usr/bin/env node

import { fetchToolSchemas, writeToolFiles } from "./converter.js";
import * as fs from "fs/promises";
import * as path from "path";

interface MCPServerConfig {
  command: string;
  args: string[];
}

interface MCPConfig {
  [serverName: string]: MCPServerConfig;
}

function parseArgs(): { config: MCPConfig; output: string } {
  const args = process.argv.slice(2);
  let configStr = "{}";
  let outputDir = "../.generated";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --config=value format
    if (arg.startsWith("--config=")) {
      configStr = arg.substring("--config=".length);
    }
    // Handle --config value format
    else if (arg === "--config" && args[i + 1]) {
      configStr = args[i + 1];
      i++;
    }
    // Handle --output=value format
    else if (arg.startsWith("--output=")) {
      outputDir = arg.substring("--output=".length);
    }
    // Handle --output value format
    else if (arg === "--output" && args[i + 1]) {
      outputDir = args[i + 1];
      i++;
    }
  }

  try {
    const config = JSON.parse(configStr) as MCPConfig;
    return { config, output: outputDir };
  } catch (error) {
    console.error("❌ Invalid JSON config:", error);
    process.exit(1);
  }
}

/**
 * Generate a root index.ts that exports all servers
 * @param serverNames - Array of server names
 * @param outputDir - Output directory path
 */
async function generateRootIndex(serverNames: string[], outputDir: string): Promise<void> {
  const toKebabCase = (str: string) => str.replace(/_/g, "-");

  const exports = serverNames
    .map((name) => `export * as ${name.replace(/-/g, "_")} from "./${toKebabCase(name)}/index.js";`)
    .join("\n");

  const indexContent = `// Generated MCP server exports
${exports}
`;

  await fs.writeFile(path.join(outputDir, "index.ts"), indexContent, "utf-8");
  console.log(`\n✅ Generated root index.ts`);
}

/**
 * Generate tsconfig.json for the output directory
 * @param outputDir - Output directory path
 */
async function generateTsConfig(outputDir: string): Promise<void> {
  const tsConfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      esModuleInterop: true,
      skipLibCheck: true,
      strict: true,
      resolveJsonModule: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ["**/*.ts"],
    exclude: ["node_modules"],
  };

  await fs.writeFile(
    path.join(outputDir, "tsconfig.json"),
    JSON.stringify(tsConfig, null, 2),
    "utf-8"
  );
  console.log(`✅ Generated tsconfig.json`);
}

/**
 * Generate package.json for the output directory
 * @param outputDir - Output directory path
 */
async function generatePackageJson(outputDir: string): Promise<void> {
  const packageJson = {
    name: "mcp-generated",
    version: "1.0.0",
    type: "module",
    description: "Generated TypeScript bindings for MCP servers",
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.21.1",
    },
    devDependencies: {
      "@types/node": "^24.10.1",
      tsx: "^4.20.6",
      typescript: "^5.7.2",
    },
  };

  await fs.writeFile(
    path.join(outputDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf-8"
  );
  console.log(`✅ Generated package.json`);
}

/**
 * Copy client.ts to output directory
 * @param outputDir - Output directory path
 */
async function copyClient(outputDir: string): Promise<void> {
  const clientSource = path.join(process.cwd(), "src", "client.ts");
  const clientDest = path.join(outputDir, "client.ts");

  const clientContent = await fs.readFile(clientSource, "utf-8");
  await fs.writeFile(clientDest, clientContent, "utf-8");
  console.log(`✅ Copied client.ts to ${outputDir}/`);
}

async function main() {
  console.log("🚀 MCP Function Generator\n");

  const { config, output } = parseArgs();

  if (Object.keys(config).length === 0) {
    console.log("⚠️  No MCP servers configured. Skipping generation.");
    process.exit(0);
  }

  console.log(`📋 Configuration:`);
  console.log(`   Output directory: ${output}`);
  console.log(`   MCP servers: ${Object.keys(config).join(", ")}\n`);

  console.log("📡 Fetching tool schemas...\n");
  const serverToolsList = await fetchToolSchemas(config);

  await fs.mkdir(output, { recursive: true });

  console.log("\n📝 Writing tool files...\n");
  for (const { serverName, tools } of serverToolsList) {
    await writeToolFiles(serverName, tools, output);
  }

  console.log();
  await copyClient(output);

  const serverNames = serverToolsList.map((s) => s.serverName);
  await generateRootIndex(serverNames, output);
  await generateTsConfig(output);
  await generatePackageJson(output);

  console.log(`\n✨ Successfully generated ${serverToolsList.length} MCP server wrappers!`);
  console.log(`📁 Output location: ${output}/\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
