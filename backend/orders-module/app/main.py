import json
import os
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models  # noqa: F401  (register tables)
from .database import Base, engine, get_db
from .errors import AppError, app_error_handler, validation_error_handler
from .models import Event
from .routers import deliveries, kot, menu, orders, tables


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("AUTO_CREATE_DB", "1") == "1":
        Base.metadata.create_all(engine)
    if os.getenv("AUTO_SEED", "0") == "1":      # start scripts set this: first run gets sample tables + menu
        from scripts.seed import run as seed
        seed()
    yield


app = FastAPI(title="Restaurant POS — Order & Front-of-House Module", version="1.0.0", lifespan=lifespan,
              description="Intern 1 module: tables, menu, orders, lifecycle, KOT, kitchen, dine-in/takeaway/delivery.")
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

for r in (tables.router, menu.router, orders.router, kot.router, deliveries.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


@app.get("/api/v1/events", tags=["system"])
def events(name: str | None = None, after_id: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Event outbox (read by Billing, Inventory, Audit, event bus)."""
    q = select(Event).where(Event.id > after_id).order_by(Event.id).limit(min(limit, 500))
    if name:
        q = q.where(Event.name == name)
    return [{"id": e.id, "name": e.name, "payload": json.loads(e.payload), "created_at": e.created_at}
            for e in db.scalars(q)]


@app.get("/api/v1/events/latest", tags=["system"])
def latest_event(db: Session = Depends(get_db)):
    """Id of the newest event (the screens poll this to know when to refresh)."""
    from sqlalchemy import func
    return {"id": db.scalar(select(func.max(Event.id))) or 0}


# The web UI (plain HTML/CSS/JS, no build step) is served by the same server:  http://localhost:8000/
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="ui")
