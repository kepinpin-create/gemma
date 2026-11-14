import os
import secrets
from pathlib import Path

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from . import auth, routes
from .db import Base, engine


def session_secret() -> str:
    """GEMMA_SECRET in production. Locally, a random key kept in backend/.secret so a restart keeps you signed in."""
    if s := os.environ.get("GEMMA_SECRET"):
        return s
    f = Path(__file__).parent.parent / ".secret"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip()


Base.metadata.create_all(engine)

app = FastAPI(title="Gemma")
# The session cookie is signed and HTTP-only; SameSite=Lax plus JSON-only bodies keeps other sites from posting as the user.
app.add_middleware(SessionMiddleware, secret_key=session_secret(), same_site="lax",
                   https_only=os.environ.get("GEMMA_HTTPS") == "1", max_age=60 * 60 * 24 * 30)
app.include_router(auth.router)
app.include_router(routes.router)
