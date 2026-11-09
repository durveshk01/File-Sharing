from logging.config import fileConfig
from alembic import context
from sqlalchemy import Column, MetaData, String, Table, engine_from_config, inspect, pool, text
from app.core.config import settings
from app.database import Base
from app import models

config = context.config
# Use existing config URL if explicitly provided (e.g. in tests/CLI), otherwise fallback to settings.database_url
db_url = config.get_main_option("sqlalchemy.url")
if not db_url or db_url.startswith("sqlite:///./data/secureshare.db"):
    db_url = settings.normalized_database_url
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
config.set_main_option("sqlalchemy.url", db_url.replace("%", "%%"))

if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline():
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # Existing revision IDs exceed Alembic's default VARCHAR(32).
        version = Table("alembic_version", MetaData(), Column("version_num", String(128), primary_key=True))
        version.create(connection, checkfirst=True)
        if connection.dialect.name == "postgresql":
            column = inspect(connection).get_columns("alembic_version")[0]
            if getattr(column["type"], "length", 0) < 128:
                connection.execute(text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table="alembic_version",
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
