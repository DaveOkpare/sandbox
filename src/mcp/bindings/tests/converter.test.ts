import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  simpleToolSchema,
  complexNestedSchema,
  arrayToolSchema,
  optionalFieldsSchema,
  toolWithOutputSchema,
  toolWithoutOutputSchema,
  emptyPropertiesSchema,
  mockServerConfig,
  mockMultiServerConfig,
} from "./fixtures/mock-mcp-responses.js";

// Mock the SDK modules
const mockClient = {
  connect: jest.fn() as any,
  listTools: jest.fn() as any,
  close: jest.fn() as any,
};

const mockTransport = {
  close: jest.fn() as any,
};

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => mockTransport),
}));

// Mock fs module - must use unstable_mockModule for ES modules
const mockMkdir = jest.fn() as any;
const mockWriteFile = jest.fn() as any;
const mockReadFile = jest.fn() as any;

jest.unstable_mockModule("fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
  },
}));

describe("converter.ts", () => {
  let fetchToolSchemas: any;
  let convertSchemaToTypeScript: any;
  let writeToolFiles: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup default mock implementations
    mockClient.connect.mockResolvedValue(undefined);
    mockTransport.close.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue("content");

    // Import the converter module
    const converterModule = await import("../src/converter.js");
    fetchToolSchemas = converterModule.fetchToolSchemas;
    convertSchemaToTypeScript = converterModule.convertSchemaToTypeScript;
    writeToolFiles = converterModule.writeToolFiles;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.skip("fetchToolSchemas", () => {
    it("should successfully fetch tools from a single server", async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [simpleToolSchema, complexNestedSchema],
      });

      const result = await fetchToolSchemas(mockServerConfig);

      expect(result).toHaveLength(1);
      expect(result[0].serverName).toBe("test_server");
      expect(result[0].tools).toHaveLength(2);
      expect(result[0].tools[0].name).toBe("get_user");
      expect(result[0].tools[1].name).toBe("create_project");

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "node",
        args: ["test-server.js"],
      });
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it("should successfully fetch tools from multiple servers", async () => {
      mockClient.listTools
        .mockResolvedValueOnce({ tools: [simpleToolSchema] })
        .mockResolvedValueOnce({ tools: [toolWithOutputSchema] });

      const result = await fetchToolSchemas(mockMultiServerConfig);

      expect(result).toHaveLength(2);
      expect(result[0].serverName).toBe("server_one");
      expect(result[0].tools).toHaveLength(1);
      expect(result[1].serverName).toBe("server_two");
      expect(result[1].tools).toHaveLength(1);

      expect(mockClient.connect).toHaveBeenCalledTimes(2);
      expect(mockTransport.close).toHaveBeenCalledTimes(2);
    });

    it("should handle servers with no tools", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });

      const result = await fetchToolSchemas(mockServerConfig);

      expect(result).toHaveLength(1);
      expect(result[0].tools).toHaveLength(0);
    });

    it("should throw error on connection failure", async () => {
      mockClient.connect.mockRejectedValue(new Error("Connection refused"));

      await expect(fetchToolSchemas(mockServerConfig)).rejects.toThrow("Connection refused");
    });

    it("should throw error on listTools failure", async () => {
      mockClient.listTools.mockRejectedValue(new Error("Failed to list tools"));

      await expect(fetchToolSchemas(mockServerConfig)).rejects.toThrow("Failed to list tools");
    });

    it("should map tool schemas correctly including outputSchema", async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [toolWithOutputSchema],
      });

      const result = await fetchToolSchemas(mockServerConfig);

      expect(result[0].tools[0]).toMatchObject({
        name: "calculate_stats",
        description: "Calculate statistics for a dataset",
        inputSchema: expect.any(Object),
        outputSchema: expect.any(Object),
      });
    });
  });

  describe("convertSchemaToTypeScript", () => {
    it("should convert simple object schema to TypeScript interface", async () => {
      const schema = {
        type: "object",
        properties: {
          user_id: { type: "string" },
          name: { type: "string" },
        },
        required: ["user_id"],
      };

      const result = await convertSchemaToTypeScript(schema, "GetUserInput");

      expect(result).toContain("export interface GetUserInput");
      expect(result).toContain("user_id: string");
      expect(result).toContain("name?: string");
    });

    it("should handle nested object schemas", async () => {
      const schema = complexNestedSchema.inputSchema;

      const result = await convertSchemaToTypeScript(schema, "CreateProjectInput");

      expect(result).toContain("export interface CreateProjectInput");
      expect(result).toContain("name: string");
      expect(result).toContain("config:");
    });

    it("should handle array types", async () => {
      const schema = arrayToolSchema.inputSchema;

      const result = await convertSchemaToTypeScript(schema, "BatchUpdateInput");

      expect(result).toContain("export interface BatchUpdateInput");
      expect(result).toContain("items:");
    });

    it("should handle optional fields correctly", async () => {
      const schema = optionalFieldsSchema.inputSchema;

      const result = await convertSchemaToTypeScript(schema, "SearchInput");

      expect(result).toContain("export interface SearchInput");
      expect(result).toContain("query: string");
      expect(result).toContain("limit?: number");
      expect(result).toContain("offset?: number");
    });

    it("should handle empty properties schema", async () => {
      const schema = emptyPropertiesSchema.inputSchema;

      const result = await convertSchemaToTypeScript(schema, "PingInput");

      expect(result).toContain("export interface PingInput");
    });

    it("should return fallback interface on conversion error", async () => {
      // Invalid schema that might cause compilation error
      const invalidSchema = {
        type: "invalid-type",
        properties: null,
      };

      const result = await convertSchemaToTypeScript(invalidSchema, "InvalidInput");

      expect(result).toContain("export interface InvalidInput");
      expect(result).toContain("[k: string]: unknown");
    });

    it("should handle schemas with no properties field", async () => {
      const schema = {
        type: "object",
      };

      const result = await convertSchemaToTypeScript(schema, "EmptyInput");

      expect(result).toContain("export interface EmptyInput");
    });

    it("should remove property titles to generate inline types", async () => {
      const schema = {
        type: "object",
        properties: {
          data: {
            type: "object",
            title: "DataObject", // This should be removed
            properties: {
              value: { type: "string" },
            },
          },
        },
      };

      const result = await convertSchemaToTypeScript(schema, "TestInput");

      // Should not export a separate DataObject interface
      expect(result).not.toContain("export interface DataObject");
      expect(result).toContain("export interface TestInput");
    });
  });

  describe("writeToolFiles", () => {
    beforeEach(() => {
      // Mock fs.promises functions
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
    });

    it("should create server directory with kebab-case naming", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      expect(mockMkdir).toHaveBeenCalledWith("/output/test-server", { recursive: true });
    });

    it("should generate correct number of files", async () => {
      await writeToolFiles("test_server", [simpleToolSchema, complexNestedSchema], "/output");

      // Should write 2 tool files + 1 index.ts
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
    });

    it("should generate files with camelCase function names", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFilePath = writeFileCalls.find((call) => call[0].includes("getUser.ts"));

      expect(toolFilePath).toBeDefined();
    });

    it("should include correct import statement in generated files", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) => call[0].includes("getUser.ts"))?.[1];

      expect(toolFileContent).toContain('import { callMCPTool } from "../client.js"');
    });

    it("should include JSDoc comments from tool description", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) => call[0].includes("getUser.ts"))?.[1];

      expect(toolFileContent).toContain("/* Get user information by ID */");
    });

    it("should generate input interfaces", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) => call[0].includes("getUser.ts"))?.[1];

      expect(toolFileContent).toContain("export interface GetUserInput");
    });

    it("should handle tools without output schemas", async () => {
      await writeToolFiles("test_server", [toolWithoutOutputSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) =>
        call[0].includes("sendNotification.ts")
      )?.[1];

      expect(toolFileContent).toContain("Promise<any>");
      expect(toolFileContent).not.toContain("Response");
    });

    it("should include output interfaces when outputSchema is provided", async () => {
      await writeToolFiles("test_server", [toolWithOutputSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) =>
        call[0].includes("calculateStats.ts")
      )?.[1];

      expect(toolFileContent).toContain("export interface CalculateStatsResponse");
      expect(toolFileContent).toContain("Promise<CalculateStatsResponse>");
    });

    it("should generate correct tool call with server and tool name", async () => {
      await writeToolFiles("test_server", [simpleToolSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) => call[0].includes("getUser.ts"))?.[1];

      expect(toolFileContent).toContain("callMCPTool<any>('test_server__get_user', input)");
    });

    it("should generate barrel export index.ts file", async () => {
      await writeToolFiles("test_server", [simpleToolSchema, complexNestedSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const indexFileContent = writeFileCalls.find((call) => call[0].includes("index.ts"))?.[1];

      expect(indexFileContent).toContain('export { getUser, GetUserInput } from "./getUser.js"');
      expect(indexFileContent).toContain(
        'export { createProject, CreateProjectInput } from "./createProject.js"'
      );
    });

    it("should handle empty tools array", async () => {
      await writeToolFiles("test_server", [], "/output");

      expect(mockMkdir).toHaveBeenCalled();
      // Should still create index.ts even with no tools
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("index.ts"),
        "\n",
        "utf-8"
      );
    });

    it("should handle file system errors gracefully", async () => {
      mockWriteFile.mockRejectedValue(new Error("Permission denied"));

      await expect(writeToolFiles("test_server", [simpleToolSchema], "/output")).rejects.toThrow(
        "Permission denied"
      );
    });

    it("should handle tools with special characters in names", async () => {
      const toolWithSpecialName = {
        name: "get_data_v2",
        description: "Get data version 2",
        inputSchema: { type: "object", properties: {} },
      };

      await writeToolFiles("test_server", [toolWithSpecialName], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFilePath = writeFileCalls.find((call) => call[0].includes("getDataV2.ts"));

      expect(toolFilePath).toBeDefined();
    });
  });

  describe("Edge cases and integration", () => {
    it("should handle complex nested schema conversion and file writing", async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeToolFiles("test_server", [complexNestedSchema], "/output");

      const writeFileCalls = mockWriteFile.mock.calls;
      const toolFileContent = writeFileCalls.find((call) =>
        call[0].includes("createProject.ts")
      )?.[1];

      expect(toolFileContent).toContain("export interface CreateProjectInput");
      expect(toolFileContent).toContain("export async function createProject");
    });

    it("should handle multiple servers with same tool names", async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeToolFiles("server_one", [simpleToolSchema], "/output");
      await writeToolFiles("server_two", [simpleToolSchema], "/output");

      expect(mockMkdir).toHaveBeenCalledWith("/output/server-one", { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith("/output/server-two", { recursive: true });
    });
  });
});
