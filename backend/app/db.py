import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./gemma.db")
_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if _sqlite else {})

if _sqlite:
    @event.listens_for(engine, "connect")
    def _foreign_keys_on(conn, _):  # SQLite ignores ON DELETE CASCADE unless asked on every connection
        conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    with SessionLocal() as db:
        yield db
