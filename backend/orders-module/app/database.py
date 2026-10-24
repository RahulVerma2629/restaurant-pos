import os
import threading

from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pos_orders.db")


def make_engine(url: str):
    kw = {}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False, "timeout": 15}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kw["poolclass"] = StaticPool
    eng = create_engine(url, **kw)
    if url.startswith("sqlite") and ":memory:" not in url and url != "sqlite://":
        @event.listens_for(eng, "connect")
        def _pragmas(conn, _):      # WAL = readers never block the writer; busy_timeout = wait instead of failing
            cur = conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=15000")
            cur.close()
    return eng


engine = make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# One restaurant = one writer at a time. Every non-GET request takes this lock, so two waiters tapping at the
# same moment can never corrupt an order (simple + safe for SQLite; use PostgreSQL + row locks to scale out).
_write_lock = threading.Lock()


def get_db(request: Request):
    locked = request.method != "GET"
    if locked:
        _write_lock.acquire()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        if locked:
            _write_lock.release()
