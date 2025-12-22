"""FastMCP server implementation for Docker sandbox execution."""

import json
from contextlib import asynccontextmanager

from fastmcp import FastMCP
from loguru import logger

from .environment import DockerEnv
from .sandbox import Sandbox

# Global state for persistent sandbox
_sandbox_instance = None
_docker_env = None


@asynccontextmanager
async def lifespan(mcp: FastMCP):
    """Manage persistent sandbox lifecycle."""
    global _sandbox_instance, _docker_env

    # Get config from server context
    config_path = mcp.context.get("config_path")
    image = mcp.context.get("image", "sandbox:latest")
    container_name = mcp.context.get("container_name", "mcp-sandbox-persistent")

    logger.info("Initializing persistent sandbox...")
    logger.info(f"  Config: {config_path}")
    logger.info(f"  Image: {image}")
    logger.info(f"  Container: {container_name}")

    try:
        # Create persistent Docker environment
        _docker_env = DockerEnv.create(container_name=container_name, image=image)
        logger.success(f"✓ Docker environment created: {container_name}")

        # Create Sandbox with MCP config
        _sandbox_instance = Sandbox(environment=_docker_env, config_path=config_path)
        logger.success("✓ Sandbox initialized with MCP servers")

        yield  # Server runs here

    finally:
        # Cleanup on shutdown
        logger.info("Shutting down sandbox...")
        if _docker_env:
            _docker_env.cleanup()
            logger.success("✓ Docker environment cleaned up")


# Create FastMCP server with lifespan
mcp = FastMCP("mcp-server-sandbox", lifespan=lifespan)


@mcp.tool()
def execute_code(code: str, timeout: int = 30) -> dict:
    """
    Execute Python code in the isolated Docker sandbox environment.

    Args:
        code: Python code to execute
        timeout: Maximum execution time in seconds (default: 30)

    Returns:
        Dictionary with exit_code, stdout, and stderr
    """
    # Validate inputs
    if not code or not code.strip():
        return {"error": "Code cannot be empty", "exit_code": 1}

    if len(code) > 100_000:  # 100KB limit
        return {"error": "Code too large (max 100KB)", "exit_code": 1}

    if not _sandbox_instance:
        return {"error": "Sandbox not initialized", "exit_code": 1}

    try:
        logger.info(f"Executing code ({len(code)} chars, timeout={timeout}s)")

        # Execute in the persistent sandbox
        result = _sandbox_instance.run(code)

        logger.info(f"Execution complete: exit_code={result.exit_code}")

        return {
            "exit_code": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    except Exception as e:
        logger.error(f"Execution failed: {e}")
        return {"error": str(e), "exit_code": 1}


@mcp.tool()
def list_mcp_tools(server_name: str | None = None) -> dict:
    """
    List available MCP tools from loaded servers.

    Args:
        server_name: Optional server name to filter. If None, lists all tools.

    Returns:
        Dictionary mapping server names to their tools:
        {
            "server_name": [
                {"name": "tool_name", "description": "..."},
                ...
            ]
        }
    """
    if not _sandbox_instance:
        return {"error": "Sandbox not initialized"}

    try:
        logger.info(f"Listing MCP tools (server={server_name or 'all'})")

        result = _sandbox_instance.list_tools(server_name)

        if result.exit_code != 0:
            logger.error(f"list_tools failed: {result.stderr}")
            return {"error": result.stderr or "Failed to list tools"}

        # Parse JSON output
        tools = json.loads(result.stdout)
        logger.success(
            f"✓ Listed tools for {len(tools) if isinstance(tools, dict) else 1} server(s)"
        )

        return {"tools": tools}

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse tools JSON: {e}")
        return {"error": f"Invalid JSON response: {e}"}
    except Exception as e:
        logger.error(f"Failed to list tools: {e}")
        return {"error": str(e)}


@mcp.tool()
def get_mcp_tool_info(server_name: str, tool_name: str) -> dict:
    """
    Get detailed information about a specific MCP tool.

    Args:
        server_name: Name of the MCP server
        tool_name: Name of the tool

    Returns:
        Dictionary with tool details:
        {
            "name": "tool_name",
            "description": "short description",
            "doc": "full docstring with parameters"
        }
    """
    if not _sandbox_instance:
        return {"error": "Sandbox not initialized"}

    try:
        logger.info(f"Getting tool info: {server_name}.{tool_name}")

        result = _sandbox_instance.get_tool_info(server_name, tool_name)

        if result.exit_code != 0:
            logger.error(f"get_tool_info failed: {result.stderr}")
            return {"error": result.stderr or "Failed to get tool info"}

        # Parse JSON output
        tool_info = json.loads(result.stdout)

        if "error" in tool_info:
            logger.warning(f"Tool not found: {server_name}.{tool_name}")
        else:
            logger.success(f"✓ Retrieved info for {server_name}.{tool_name}")

        return tool_info

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse tool info JSON: {e}")
        return {"error": f"Invalid JSON response: {e}"}
    except Exception as e:
        logger.error(f"Failed to get tool info: {e}")
        return {"error": str(e)}


@mcp.tool()
def get_sandbox_info() -> dict:
    """
    Get information about the sandbox environment.

    Returns:
        Dictionary with sandbox configuration and status
    """
    if not _sandbox_instance or not _docker_env:
        return {"error": "Sandbox not initialized"}

    try:
        # Get MCP server config
        config = _sandbox_instance.config
        servers = list(config.get("mcpServers", {}).keys())

        return {
            "status": "ready",
            "container_name": _docker_env.container.name,
            "image": _docker_env.container.image.tags[0]
            if _docker_env.container.image.tags
            else "unknown",
            "mcp_servers": servers,
            "config_path": str(_sandbox_instance.config_path),
        }

    except Exception as e:
        logger.error(f"Failed to get sandbox info: {e}")
        return {"error": str(e)}


async def run_server(args):
    """Run the MCP server with the provided arguments."""
    # Store config in server context
    mcp.context["config_path"] = args.config
    mcp.context["image"] = args.image
    mcp.context["container_name"] = args.container_name

    # Run server using FastMCP's built-in stdio support
    logger.info("Starting MCP server in STDIO mode...")
    await mcp.run_async()
