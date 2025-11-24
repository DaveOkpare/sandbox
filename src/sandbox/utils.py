from pathlib import Path

import docker


def build_image(
    tag: str = "sandbox:latest",
    dockerfile_path: str = "docker/sandbox.Dockerfile",
) -> None:
    client = docker.from_env()

    project_root = Path(__file__).resolve().parent.parent.parent
    dockerfile_path = project_root.joinpath(dockerfile_path)
    if not dockerfile_path.exists():
        raise FileNotFoundError(f"Dockerfile not found at {dockerfile_path}")

    print(f"Building Docker image '{tag}' from {dockerfile_path}...")

    try:
        image, _ = client.images.build(
            path=str(project_root),
            tag=tag,
            dockerfile=str(dockerfile_path),
            rm=True,
        )
        print(f"Successfully built image: {tag}")
        print(f"Image ID: {image.id}")
    except docker.errors.BuildError as e:
        error_message = e.msg["message"]
        print(f"Error building image: {error_message}")
        for log in e.build_log:
            if "stream" in log:
                print(log["stream"], end="")
        raise
    except Exception as e:
        print(f"Unexpected error: {e}")
        raise
