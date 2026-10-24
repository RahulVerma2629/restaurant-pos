"""Regenerate docs/openapi.json and docs/schema.sql:  python -m scripts.export_docs"""
import json
from pathlib import Path

from sqlalchemy.dialects import sqlite
from sqlalchemy.schema import CreateIndex, CreateTable

from app.database import Base
from app.main import app

docs = Path(__file__).resolve().parent.parent / "docs"
(docs / "openapi.json").write_text(json.dumps(app.openapi(), indent=2))
sql = []
for t in Base.metadata.sorted_tables:
    sql.append(str(CreateTable(t).compile(dialect=sqlite.dialect())).strip() + ";")
    sql += [str(CreateIndex(i).compile(dialect=sqlite.dialect())) + ";" for i in t.indexes]
(docs / "schema.sql").write_text("\n\n".join(sql) + "\n")
print("docs updated")
