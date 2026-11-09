import sqlite3
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

class Base(DeclarativeBase): pass


@event.listens_for(Engine, "connect")
def configure_sqlite(connection, _):
    if isinstance(connection, sqlite3.Connection):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()

connect_args = {"check_same_thread": False} if settings.normalized_database_url.startswith("sqlite") else {}
engine = create_engine(settings.normalized_database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
