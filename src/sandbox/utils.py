import os
import subprocess
from pathlib import Path


def build_image(
    tag: str = "sandbox:latest",
    dockerfile_path: str = "docker/sandbox.Dockerfile",
) -> None:
    """
    Build Docker image using Docker CLI for optimal performance.
    """
    project_root = Path(__file__).resolve().parent.parent.parent
    dockerfile_path = project_root.joinpath(dockerfile_path)

    if not dockerfile_path.exists():
        raise FileNotFoundError(f"Dockerfile not found at {dockerfile_path}")

    print(f"Building Docker image '{tag}' from {dockerfile_path}...")

    # Enable BuildKit for faster builds and better caching
    env = os.environ.copy()
    env["DOCKER_BUILDKIT"] = "1"

    # Build using Docker CLI with optimized flags
    result = subprocess.run(
        [
            "docker",
            "build",
            "-t",
            tag,
            "-f",
            str(dockerfile_path),
            "--rm",  # Remove intermediate containers
            "--progress=auto",  # Show progress bar in terminals
            str(project_root),
        ],
        env=env,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"Docker build failed with exit code {result.returncode}. "
            f"Check the output above for details."
        )

    print(f"✓ Successfully built image: {tag}")
