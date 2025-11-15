from dataclasses import dataclass
from typing import Optional
import docker
from docker.errors import ImageNotFound


@dataclass
class ExecutionResult:
    exit_code: int
    stdout: str
    stderr: str


class Sandbox:
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

    def cleanup(self, remove_volume: bool = True):
        """Stop and remove the container."""
        if self.container:
            try:
                self.container.stop()
                self.container.remove(v=remove_volume)
            except Exception:
                pass

    @classmethod
    def create(
        cls,
        packages: Optional[list[str]] = None,
        volumes: Optional[dict[str, str]] = None,
        environment: Optional[dict[str, str]] = None,
        image: str = "sandbox:latest",
        *,
        cpu_quota: int = 50000,
        mem_limit: str = "512m",
        network_mode: str = "bridge",
        remove: bool = True,
    ):
        """
        Create a new sandbox instance.
        Args:
            packages: List of pip packages to install
            environment: Dict of environment variables to set
            volumes: Dict mapping host paths to container paths (e.g., {"/local": "/workspace"})
            image: Docker image to use (default: "sandbox:latest")
            cpu_quota: CPU quota for the container (default: 50000)
            mem_limit: Memory limit for the container (default: "512m")
            network_mode: Network mode for the container (default: "bridge")
            remove: Remove the container when it has finished running (default: True)

        Returns:
            Sandbox instance
        """
        client = docker.from_env()

        _volumes = {}
        if volumes:
            for host_path, container_path in volumes.items():
                _volumes[host_path] = {"bind": container_path, "mode": "ro"}

        try:
            container = client.containers.run(
                image=image,
                detach=True,
                environment=environment,
                cpu_quota=cpu_quota,
                mem_limit=mem_limit,
                network_mode=network_mode,
                remove=remove,
                volumes=_volumes,
                working_dir="/workspace",
            )
        except ImageNotFound:
            raise RuntimeError(
                f"Docker image {image} not found."
                "Please build the image first using 'sandbox-build' or 'docker build -t sandbox:latest .'"
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

        # When demux=True, exec_result is a tuple: (exit_code, (stdout_bytes, stderr_bytes))
        exit_code, (stdout_bytes, stderr_bytes) = exec_result
        stdout = stdout_bytes.decode("utf-8") if stdout_bytes else ""
        stderr = stderr_bytes.decode("utf-8") if stderr_bytes else ""

        return ExecutionResult(exit_code=exit_code, stdout=stdout, stderr=stderr)
