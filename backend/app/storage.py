import io
import os
from abc import ABC, abstractmethod
from pathlib import Path
from app.core.config import settings

class StorageAdapter(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes) -> None:
        """Store encrypted payload by key."""
        pass

    @abstractmethod
    def get(self, key: str) -> bytes:
        """Retrieve encrypted payload by key."""
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete payload by key."""
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check if key exists."""
        pass


class LocalStorage(StorageAdapter):
    def __init__(self, root_path: str | Path | None = None):
        self.root = Path(root_path or settings.storage_path).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError(f"Path traversal detected: {key}")
        return target

    def put(self, key: str, data: bytes) -> None:
        target = self._resolve(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def get(self, key: str) -> bytes:
        target = self._resolve(key)
        if not target.exists():
            raise FileNotFoundError(f"Storage object not found: {key}")
        return target.read_bytes()

    def delete(self, key: str) -> None:
        target = self._resolve(key)
        target.unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._resolve(key).exists()


class S3Storage(StorageAdapter):
    def __init__(
        self,
        bucket_name: str,
        endpoint_url: str | None = None,
        region_name: str = "us-east-1",
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
    ):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise RuntimeError("boto3 is required for S3Storage adapter. Please install boto3.") from exc

        self.bucket_name = bucket_name
        kwargs = {"region_name": region_name or "us-east-1"}
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        if access_key_id and secret_access_key:
            kwargs["aws_access_key_id"] = access_key_id
            kwargs["aws_secret_access_key"] = secret_access_key

        self.client = boto3.client("s3", **kwargs)

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            ServerSideEncryption="AES256",
        )

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError
        try:
            resp = self.client.get_object(Bucket=self.bucket_name, Key=key)
            return resp["Body"].read()
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise FileNotFoundError(f"Storage object not found in S3: {key}") from e
            raise

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket_name, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False


def get_storage() -> StorageAdapter:
    if settings.storage_backend.lower() == "s3":
        if not settings.s3_bucket_name:
            raise ValueError("S3_BUCKET_NAME is required when STORAGE_BACKEND=s3")
        return S3Storage(
            bucket_name=settings.s3_bucket_name,
            endpoint_url=settings.s3_endpoint_url or None,
            region_name=settings.s3_region_name,
            access_key_id=settings.s3_access_key_id or None,
            secret_access_key=settings.s3_secret_access_key or None,
        )
    return LocalStorage()

storage = get_storage()
