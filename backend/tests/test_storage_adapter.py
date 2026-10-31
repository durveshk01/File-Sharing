import tempfile
from pathlib import Path
from unittest.mock import MagicMock
import pytest
from app.storage import LocalStorage, S3Storage

def test_local_storage_adapter():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = LocalStorage(root_path=tmpdir)
        key = "test_key_123"
        data = b"encrypted binary payload"

        assert storage.exists(key) is False
        storage.put(key, data)
        assert storage.exists(key) is True
        assert storage.get(key) == data

        storage.delete(key)
        assert storage.exists(key) is False

        with pytest.raises(FileNotFoundError):
            storage.get(key)

def test_s3_storage_adapter(monkeypatch):
    mock_boto_client = MagicMock()
    mock_boto3 = MagicMock()
    mock_boto3.client.return_value = mock_boto_client
    monkeypatch.setattr("boto3.client", mock_boto3.client)

    adapter = S3Storage(bucket_name="my-test-bucket", region_name="us-east-1")
    
    # 1. put
    adapter.put("obj123", b"s3_data")
    mock_boto_client.put_object.assert_called_with(
        Bucket="my-test-bucket",
        Key="obj123",
        Body=b"s3_data",
        ServerSideEncryption="AES256",
    )

    # 2. get
    mock_body = MagicMock()
    mock_body.read.return_value = b"s3_data"
    mock_boto_client.get_object.return_value = {"Body": mock_body}
    assert adapter.get("obj123") == b"s3_data"

    # 3. exists
    mock_boto_client.head_object.return_value = {}
    assert adapter.exists("obj123") is True

    # 4. delete
    adapter.delete("obj123")
    mock_boto_client.delete_object.assert_called_with(
        Bucket="my-test-bucket",
        Key="obj123",
    )
