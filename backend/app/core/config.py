from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_secret: str = ""
    # Development-only key. Production must set KEK_BASE64 from a secret manager.
    kek_base64: str = "QXq4lGcvD6FaRXp3DqL4W9xJvPG3+7aM5vZ25lDsbQ0="
    database_url: str = "sqlite:///./data/secureshare.db"
    
    # Storage settings
    storage_backend: str = "local"  # "local" or "s3"
    storage_path: str = "./storage"
    s3_bucket_name: str = ""
    s3_endpoint_url: str = ""
    s3_region_name: str = "us-east-1"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    
    frontend_origin: str = "http://localhost:3000,https://frontend-five-fawn-27.vercel.app"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    session_days: int = 7
    max_upload_bytes: int = 50 * 1024 * 1024  # 50 MB
    account_quota_bytes: int = 1024 * 1024 * 1024  # Includes trash and pending uploads.
    max_chunk_bytes: int = 5 * 1024 * 1024
    storage_grant_seconds: int = 300
    upload_intent_seconds: int = 900
    transfer_timeout_seconds: int = 300
    max_pending_uploads: int = 20
    maintenance_interval_seconds: int = 300
    
    # Email / SMTP settings
    mail_mode: str = "console"  # "console" or "smtp"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    mail_from: str = "noreply@secureshare.local"
    public_app_url: str = "http://localhost:3000"
    
    run_migrations_on_start: bool = True
    demo_login_enabled: bool = True

    @property
    def normalized_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and not url.startswith("postgresql+"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
