import json
from pathlib import Path
from .environment import Environment, ExecutionResult


class Sandbox:
    """
    Sandbox orchestrator that combines an execution environment with MCP tool integration.

    The Sandbox class:
    - Accepts an Environment instance (e.g., DockerEnv) for code execution
    - Loads MCP server configurations from a JSON file
    - Generates initialization code that loads MCP servers inside the environment
    - Supports environment variables for MCP server configuration
    - Executes user code synchronously within the isolated environment
    """

    def __init__(
        self,
        environment: Environment,
        config_path: Path | str,
    ) -> None:
        """
        Initialize the Sandbox.

        Args:
            environment: Environment instance for code execution (e.g., DockerEnv)
            config_path: Path to MCP config JSON file
        """
        self.environment = environment
        self.config_path = Path(config_path)

        if not self.config_path.exists():
            raise FileNotFoundError(f"Config file {self.config_path} not found")

        with self.config_path.open("r", encoding="utf-8") as f:
            self.config = json.load(f)

    def run(self, code: str) -> ExecutionResult:
        """
        Execute code synchronously in the environment with MCP tools available.

        The MCP servers are loaded inside the execution environment (e.g., Docker container)
        using auto-generated initialization code.

        Args:
            code: Python code to execute

        Returns:
            ExecutionResult with exit_code, stdout, stderr

        Note:
            This requires mcp2py and any necessary MCP servers to be available
            in the execution environment (e.g., installed in Docker image).
        """
        setup_code = self._create_setup_code()
        full_code = f"{setup_code}\n{code}"

        # Execute in the environment using a list to avoid shell quoting issues
        # Pass as list: ["python3", "-c", "<code>"]
        return self.environment.run(["python3", "-c", full_code])

    def list_tools(self, server_name: str | None = None) -> ExecutionResult:
        """
        List available MCP tools from loaded servers.

        Args:
            server_name: Optional server name to filter. If None, lists all tools from all servers.

        Returns:
            ExecutionResult with JSON output containing tool metadata:
            {
                "server_name": [
                    {"name": "tool_name", "description": "..."},
                    ...
                ],
                ...
            }
        """
        if server_name:
            # List tools for a specific server
            introspection_code = f"""
import json

tools_info = []
if '{server_name}' in globals() and hasattr(globals()['{server_name}'], 'tools'):
    for tool in {server_name}.tools:
        tools_info.append({{
            'name': tool.__name__,
            'description': tool.__doc__ or ''
        }})

print(json.dumps(tools_info, indent=2))
"""
        else:
            # List tools for all servers
            server_names = list(self.config.get("mcpServers", {}).keys())
            introspection_code = f"""
import json

all_tools = {{}}
server_names = {server_names}

for server_name in server_names:
    if server_name in globals() and hasattr(globals()[server_name], 'tools'):
        tools_info = []
        for tool in globals()[server_name].tools:
            tools_info.append({{
                'name': tool.__name__,
                'description': tool.__doc__ or ''
            }})
        all_tools[server_name] = tools_info

print(json.dumps(all_tools, indent=2))
"""

        return self.run(introspection_code)

    def get_tool_info(self, server_name: str, tool_name: str) -> ExecutionResult:
        """
        Get detailed information about a specific MCP tool.

        Args:
            server_name: Name of the MCP server
            tool_name: Name of the tool

        Returns:
            ExecutionResult with JSON output containing tool details:
            {
                "name": "tool_name",
                "description": "...",
                "doc": "full docstring with parameter info"
            }
        """
        introspection_code = f"""
import json

tool_info = {{'error': 'Tool not found'}}

if '{server_name}' in globals() and hasattr(globals()['{server_name}'], 'tools'):
    for tool in {server_name}.tools:
        if tool.__name__ == '{tool_name}':
            tool_info = {{
                'name': tool.__name__,
                'description': (tool.__doc__ or '').split('\\n')[0] if tool.__doc__ else '',
                'doc': tool.__doc__ or ''
            }}
            break

print(json.dumps(tool_info, indent=2))
"""

        return self.run(introspection_code)

    def _create_setup_code(self) -> str:
        """
        Create Python code to set up the execution environment.

        This generates Python code that will run inside the container to:
        1. Import necessary modules (os, json, Path, mcp2py)
        2. Set environment variables for each MCP server (if specified)
        3. Load MCP servers using mcp2py.load()
        """
        setup_lines = [
            "# Auto-generated setup code for Sandbox execution",
            "import os",
            "import json",
            "from pathlib import Path",
            "from mcp2py import load",
            "",
        ]

        # Generate code to load each MCP server
        setup_lines.append("# Load MCP servers")
        for server_name, server_config in self.config.get("mcpServers", {}).items():
            command = server_config["command"]
            args = server_config.get("args", [])
            env = server_config.get("env", {})
            full_command = f"{command} {' '.join(args)}" if args else command

            # Set environment variables if specified
            if env:
                for key, value in env.items():
                    setup_lines.append(f"os.environ['{key}'] = '{value}'")

            setup_lines.append(f"{server_name} = load('{full_command}')")
            setup_lines.append("")

        # Add tool discovery helpers
        server_names = list(self.config.get("mcpServers", {}).keys())

        setup_lines.append("# Tool discovery helpers")
        setup_lines.append("def _list_all_tools():")
        setup_lines.append(
            '    """Dynamically list all MCP tools from loaded servers."""'
        )
        setup_lines.append("    tools = {}")
        setup_lines.append(f"    for server_name in {server_names}:")
        setup_lines.append(
            "        if server_name in globals() and hasattr(globals()[server_name], 'tools'):"
        )
        setup_lines.append("            tools[server_name] = [")
        setup_lines.append(
            "                {'name': t.__name__, 'description': t.__doc__ or ''}"
        )
        setup_lines.append("                for t in globals()[server_name].tools")
        setup_lines.append("            ]")
        setup_lines.append("    return tools")
        setup_lines.append("")

        # Pre-compute _all_tools variable
        setup_lines.append("# Pre-computed tool listing (computed at setup time)")
        setup_lines.append("_all_tools = _list_all_tools()")
        setup_lines.append("")

        return "\n".join(setup_lines)
