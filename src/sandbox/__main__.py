"""Main entry point for mcp-server-sandbox."""

import argparse
import asyncio
import sys
from pathlib import Path

from loguru import logger

from .server import run_server


def main():
    """Parse arguments and run the MCP server."""
    # Configure logging to stderr only (stdout is reserved for JSON-RPC)
    logger.remove()
    logger.add(sys.stderr, level="INFO")

    parser = argparse.ArgumentParser(
        description="MCP Server for Docker sandbox execution",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--config",
        type=str,
        required=True,
        help="Path to MCP server configuration JSON file",
    )
    parser.add_argument(
        "--image",
        type=str,
        default="sandbox:latest",
        help="Docker image to use for sandbox",
    )
    parser.add_argument(
        "--container-name",
        type=str,
        default="mcp-sandbox-persistent",
        help="Name for the persistent Docker container",
    )

    args = parser.parse_args()

    # Validate config file exists
    config_path = Path(args.config)
    if not config_path.exists():
        logger.error(f"Config file not found: {config_path}")
        sys.exit(1)

    logger.info("Starting MCP Sandbox Server")
    logger.info(f"Config: {config_path}")
    logger.info(f"Image: {args.image}")
    logger.info(f"Container: {args.container_name}")

    # Run the async server
    try:
        asyncio.run(run_server(args))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
