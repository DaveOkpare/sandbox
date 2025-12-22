from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import docker
from docker.errors import ImageNotFound
from loguru import logger

from sandbox.utils import build_image


@dataclass
class ExecutionResult:
    exit_code: int
    stdout: str
    stderr: str


class Environment(ABC):
    def __enter__(self):
        """Enter the context manager."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager and clean up the container."""
        self.cleanup()
        return False

    @abstractmethod
    def cleanup(self, *args, **kwargs): ...

    @classmethod
    @abstractmethod
    def create(cls, *args, **kwargs): ...

    @abstractmethod
    def run(self, command: str) -> ExecutionResult: ...


class DockerEnv(Environment):
    def __init__(self, container) -> None:
        self.container = container

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
        volumes: Optional[dict[str, str]] = None,
        environment: Optional[dict[str, str]] = None,
        image: str = "sandbox:latest",
        dockerfile_path: str = "docker/sandbox.Dockerfile",
        *,
        cpu_quota: int = 50000,
        mem_limit: str = "512m",
        network_mode: str = "bridge",
        remove: bool = False,
        container_name: str = "sandbox",
    ):
        """
        Create a new Docker environment.
        Args:
            volumes: Dict mapping host paths to container paths (e.g., {"/local": "/workspace"})
            environment: Dict of environment variables to set
            image: Docker image to use (default: "sandbox:latest")
            dockerfile_path: Path to Dockerfile (default: "docker/sandbox.Dockerfile")
            cpu_quota: CPU quota for the container (default: 50000)
            mem_limit: Memory limit for the container (default: "512m")
            network_mode: Network mode for the container (default: "bridge")
            remove: Remove the container when it has finished running (default: False)
            container_name: Name of the container (default: sandbox)

        Returns:
            Docker environment instance
        """
        client = docker.from_env()

        try:
            client.images.get(image)
        except ImageNotFound:
            logger.info(f"Image {image} not found...")
            logger.info(f"Building image {image} from {dockerfile_path}...")
            build_image(tag=image, dockerfile_path=dockerfile_path)
            logger.info(f"Image {image} built successfully.")

        _volumes = {}
        if volumes:
            for host_path, container_path in volumes.items():
                _volumes[host_path] = {"bind": container_path, "mode": "ro"}

        # Prepare environment variables
        _environment = environment or {}

        try:
            container = client.containers.get(container_name)
            logger.info(f"Container {container_name} found, using...")
            if container.status != "running":
                container.start()
        except docker.errors.NotFound:
            logger.info(f"Container {container_name} not found, creating...")
            container = client.containers.run(
                image=image,
                detach=True,
                environment=_environment,
                cpu_quota=cpu_quota,
                mem_limit=mem_limit,
                network_mode=network_mode,
                remove=remove,
                volumes=_volumes,
                working_dir="/workspace",
                name=container_name,
            )

        return cls(container)

    def run(self, code: str | list) -> ExecutionResult:
        """
        Execute raw code in the Docker environment.

        Args:
            code: Command to execute (string or list of arguments)

        Returns:
            ExecutionResult with stdout, stderr, and exit_code
        """
        exec_result = self.container.exec_run(code, workdir="/workspace", demux=True)

        # When demux=True, exec_result is a tuple: (exit_code, (stdout_bytes, stderr_bytes))
        exit_code, (stdout_bytes, stderr_bytes) = exec_result
        stdout = stdout_bytes.decode("utf-8") if stdout_bytes else ""
        stderr = stderr_bytes.decode("utf-8") if stderr_bytes else ""

        return ExecutionResult(exit_code=exit_code, stdout=stdout, stderr=stderr)
