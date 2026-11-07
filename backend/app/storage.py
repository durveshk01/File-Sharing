import io
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any
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

    @abstractmethod
    def generate_presigned_upload(
        self, object_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600
    ) -> dict[str, Any]:
        """Generate direct upload authorization (S3 presigned PUT or direct raw endpoint)."""
        pass

    @abstractmethod
    def generate_presigned_download(
        self, object_key: str, filename: str | None = None, expires_in: int = 3600
    ) -> dict[str, Any]:
        """Generate direct download authorization (S3 presigned GET or direct raw endpoint)."""
        pass

    @abstractmethod
    def initiate_multipart_upload(self, object_key: str, content_type: str = "application/octet-stream") -> str:
        """Initiate direct multipart upload."""
        pass

    @abstractmethod
    def generate_presigned_part_upload(
        self, object_key: str, upload_id: str, part_number: int, expires_in: int = 3600
    ) -> str:
        """Generate presigned URL for a single part."""
        pass

    @abstractmethod
    def complete_multipart_upload(self, object_key: str, upload_id: str, parts: list[dict[str, Any]]) -> None:
        """Complete multipart upload."""
        pass

    @abstractmethod
    def abort_multipart_upload(self, object_key: str, upload_id: str) -> None:
        """Abort multipart upload."""
        pass


class LocalStorage(StorageAdapter):
    def __init__(self, root_path: str | Path | None = None):
        self.root = Path(root_path or settings.storage_path).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        normalized = key.replace("\\", "/")
        target = (self.root / normalized).resolve()
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

    def generate_presigned_upload(
        self, object_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600
    ) -> dict[str, Any]:
        return {
            "mode": "direct_backend",
            "upload_url": f"/api/storage/raw/{object_key}",
            "method": "PUT",
            "headers": {"Content-Type": "application/octet-stream"},
            "expires_in": expires_in,
        }

    def generate_presigned_download(
        self, object_key: str, filename: str | None = None, expires_in: int = 3600
    ) -> dict[str, Any]:
        return {
            "mode": "direct_backend",
            "download_url": f"/api/storage/raw/{object_key}",
            "method": "GET",
            "expires_in": expires_in,
        }

    def initiate_multipart_upload(self, object_key: str, content_type: str = "application/octet-stream") -> str:
        upload_id = f"local_{object_key}"
        parts_dir = self.root / "_parts" / upload_id
        parts_dir.mkdir(parents=True, exist_ok=True)
        return upload_id

    def generate_presigned_part_upload(
        self, object_key: str, upload_id: str, part_number: int, expires_in: int = 3600
    ) -> str:
        return f"/api/storage/raw/{object_key}/part/{part_number}?upload_id={upload_id}"

    def complete_multipart_upload(self, object_key: str, upload_id: str, parts: list[dict[str, Any]]) -> None:
        parts_dir = self.root / "_parts" / upload_id
        target = self._resolve(object_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as out_f:
            for p in sorted(parts, key=lambda x: x["PartNumber"]):
                part_file = parts_dir / f"part_{p['PartNumber']}"
                if part_file.exists():
                    out_f.write(part_file.read_bytes())
                    part_file.unlink()
        try:
            parts_dir.rmdir()
        except OSError:
            pass

    def abort_multipart_upload(self, object_key: str, upload_id: str) -> None:
        parts_dir = self.root / "_parts" / upload_id
        if parts_dir.exists():
            for f in parts_dir.glob("*"):
                f.unlink(missing_ok=True)
            try:
                parts_dir.rmdir()
            except OSError:
                pass


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

    def generate_presigned_upload(
        self, object_key: str, content_type: str = "application/octet-stream", expires_in: int = 3600
    ) -> dict[str, Any]:
        url = self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket_name, "Key": object_key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )
        return {
            "mode": "direct_s3",
            "upload_url": url,
            "method": "PUT",
            "headers": {"Content-Type": content_type},
            "expires_in": expires_in,
        }

    def generate_presigned_download(
        self, object_key: str, filename: str | None = None, expires_in: int = 3600
    ) -> dict[str, Any]:
        params = {"Bucket": self.bucket_name, "Key": object_key}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename.replace(chr(34), "")}"'
        url = self.client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
        return {
            "mode": "direct_s3",
            "download_url": url,
            "method": "GET",
            "expires_in": expires_in,
        }

    def initiate_multipart_upload(self, object_key: str, content_type: str = "application/octet-stream") -> str:
        resp = self.client.create_multipart_upload(
            Bucket=self.bucket_name,
            Key=object_key,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return resp["UploadId"]

    def generate_presigned_part_upload(
        self, object_key: str, upload_id: str, part_number: int, expires_in: int = 3600
    ) -> str:
        return self.client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": self.bucket_name,
                "Key": object_key,
                "UploadId": upload_id,
                "PartNumber": part_number,
            },
            ExpiresIn=expires_in,
        )

    def complete_multipart_upload(self, object_key: str, upload_id: str, parts: list[dict[str, Any]]) -> None:
        self.client.complete_multipart_upload(
            Bucket=self.bucket_name,
            Key=object_key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )

    def abort_multipart_upload(self, object_key: str, upload_id: str) -> None:
        self.client.abort_multipart_upload(
            Bucket=self.bucket_name,
            Key=object_key,
            UploadId=upload_id,
        )


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
