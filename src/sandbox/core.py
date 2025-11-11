from dataclasses import dataclass
from typing import Optional
import docker


@dataclass
class ExecutionResult:
    exit_code: int
    stdout: str
    stderr: str


class Sanbox:
    def __init__(self, client, container) -> None:
        self.client = client
        self.container = container

    def __enter__(self):
        """Enter the context manager."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and clean up the container."""
        self.cleanup()
        return False

    def cleanup(self):
        """Stop and remove the container."""
        if self.container:
            try:
                self.container.stop()
            except Exception:
                pass

    @classmethod
    def create(
        cls,
        packages: Optional[list[str]] = None,
        volumes: Optional[dict[str, str]] = None,
        image: str = "sandbox:latest",
        *,
        remove: bool = True,
    ):
        """
        Create a new sandbox instance.
        Args:
            packages: List of pip packages to install
            volumes: Dict mapping host paths to container paths (e.g., {"/local": "/workspace"})
            image: Docker image to use (default: "sandbox:latest")
            remove: Remove the container when it has finished running (default: True)

        Returns:
            Sandbox instance
        """
        client = docker.from_env()

        _volumes = {}
        if volumes:
            for host_path, container_path in volumes.items():
                _volumes[host_path] = {"bind": container_path, "mode": "ro"}

        container = client.containers.run(
            image=image,
            detach=True,
            remove=remove,
            volumes=_volumes,
            working_dir="/workspace",
        )

        if packages:
            install_cmd = f"pip install --quiet {' '.join(packages)}"
            exit_code, output = container.exec_run(install_cmd)
            if exit_code != 0:
                container.stop()
                raise RuntimeError(
                    f"Failed to install packages: {output.decode('utf-8')}"
                )

        return cls(client, container)

    def run(self, code: str) -> ExecutionResult:
        """
        Execute raw Python code in the sandbox.

        Args:
            code: Raw Python code to execute

        Returns:
            ExecutionResult with stdout, stderr, and exit_code
        """
        exec_result = self.container.exec_run(
            ["python3", "-c", code], workdir="/workspace", demux=True
        )

        exit_code = exec_result.exit_code
        stdout = exec_result[0].decode() if exec_result[0] else ""
        stderr = exec_result[1].decode() if exec_result[1] else ""

        return ExecutionResult(exit_code=exit_code, stdout=stdout, stderr=stderr)
