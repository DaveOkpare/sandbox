/**
 * Mock MCP tool responses for testing
 * Based on realistic MCP server tool schemas
 */

export const simpleToolSchema = {
  name: 'get_user',
  description: 'Get user information by ID',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
        description: 'The user ID',
      },
    },
    required: ['user_id'],
  },
};

export const complexNestedSchema = {
  name: 'create_project',
  description: 'Create a new project with nested configuration',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name',
      },
      config: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Whether the project is enabled',
          },
          settings: {
            type: 'object',
            properties: {
              timeout: {
                type: 'number',
                description: 'Timeout in seconds',
              },
              retries: {
                type: 'number',
                description: 'Number of retries',
              },
            },
            required: ['timeout'],
          },
        },
        required: ['enabled'],
      },
      tags: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Project tags',
      },
    },
    required: ['name', 'config'],
  },
};

export const arrayToolSchema = {
  name: 'batch_update_items',
  description: 'Update multiple items in batch',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
            },
            value: {
              type: 'number',
            },
          },
          required: ['id', 'value'],
        },
      },
    },
    required: ['items'],
  },
};

export const optionalFieldsSchema = {
  name: 'search_documents',
  description: 'Search documents with optional filters',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
      },
      offset: {
        type: 'number',
        description: 'Result offset for pagination',
      },
      filters: {
        type: 'object',
        properties: {
          author: {
            type: 'string',
          },
          date_from: {
            type: 'string',
          },
          date_to: {
            type: 'string',
          },
        },
      },
    },
    required: ['query'],
  },
};

export const toolWithoutOutputSchema = {
  name: 'send_notification',
  description: 'Send a notification to user',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
      },
      message: {
        type: 'string',
      },
    },
    required: ['user_id', 'message'],
  },
};

export const toolWithOutputSchema = {
  name: 'calculate_stats',
  description: 'Calculate statistics for a dataset',
  inputSchema: {
    type: 'object',
    properties: {
      dataset_id: {
        type: 'string',
      },
    },
    required: ['dataset_id'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      mean: {
        type: 'number',
      },
      median: {
        type: 'number',
      },
      std_dev: {
        type: 'number',
      },
      count: {
        type: 'number',
      },
    },
    required: ['mean', 'median', 'std_dev', 'count'],
  },
};

export const emptyPropertiesSchema = {
  name: 'ping',
  description: 'Health check endpoint',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const toolWithSpecialChars = {
  name: 'get_data_v2',
  description: 'Get data (version 2)',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
      },
    },
    required: ['id'],
  },
};

/**
 * Mock MCP server configurations for testing
 */
export const mockServerConfig = {
  test_server: {
    command: 'node',
    args: ['test-server.js'],
  },
};

export const mockMultiServerConfig = {
  server_one: {
    command: 'node',
    args: ['server1.js'],
  },
  server_two: {
    command: 'node',
    args: ['server2.js'],
  },
};

/**
 * Mock server tool collections
 */
export const mockServerTools = [
  {
    serverName: 'test_server',
    tools: [simpleToolSchema, complexNestedSchema, arrayToolSchema],
  },
];

export const mockMultiServerTools = [
  {
    serverName: 'server_one',
    tools: [simpleToolSchema, optionalFieldsSchema],
  },
  {
    serverName: 'server_two',
    tools: [toolWithOutputSchema, toolWithoutOutputSchema],
  },
];

export const mockEmptyServerTools = [
  {
    serverName: 'empty_server',
    tools: [],
  },
];
