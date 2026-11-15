import hashlib

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import ROLES, Member, User, Workspace

router = APIRouter(prefix="/api/auth")


def _hash(password: str) -> str:
    pw = password.encode()
    if len(pw) > 72:  # bcrypt reads at most 72 bytes; refuse rather than silently truncate
        raise HTTPException(422, "Password is too long")
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode()


def _matches(password: str, user: User) -> bool:
    pw = password.encode()
    return len(pw) <= 72 and bcrypt.checkpw(pw, user.password_hash.encode())


def _password_version(user: User) -> str:
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:16]


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    # "pv" ties the session to the current password, so changing it signs out every other device.
    if not user or request.session.get("pv") != _password_version(user):
        raise HTTPException(401, "Not signed in")
    return user


def require(db: Session, user: User, workspace_id: int, min_role: str = "viewer") -> str:
    """The one access rule, used by every workspace route. Non-members get 404 so they
    cannot tell a workspace (or anything in it) exists; members with too low a role get 403."""
    m = db.get(Member, (workspace_id, user.id))
    if not m:
        raise HTTPException(404, "Not found")
    if ROLES.index(m.role) > ROLES.index(min_role):
        raise HTTPException(403, "Your role does not allow this")
    return m.role


def user_out(u: User) -> dict:
    return {"id": u.id, "full_name": u.full_name, "email": u.email}


def me_out(db: Session, user: User) -> dict:
    rows = db.execute(
        select(Workspace, Member.role).join(Member, Member.workspace_id == Workspace.id)
        .where(Member.user_id == user.id).order_by(Workspace.id)
    ).all()
    return {"user": user_out(user), "workspaces": [{"id": w.id, "name": w.name, "role": r} for w, r in rows]}


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt reads at most 72 bytes


class Signup(Credentials):
    full_name: str = Field(min_length=1, max_length=100)


class Profile(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


def _sign_in(request: Request, user: User):
    request.session.clear()
    request.session["uid"] = user.id
    request.session["pv"] = _password_version(user)


@router.post("/signup")
def signup(body: Signup, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, full_name=body.full_name.strip(), password_hash=_hash(body.password))
    db.add(user)
    db.commit()
    _sign_in(request, user)
    return me_out(db, user)


@router.post("/login")
def login(body: Credentials, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not _matches(body.password, user):
        raise HTTPException(401, "Wrong email or password")
    _sign_in(request, user)
    return me_out(db, user)


@router.post("/password")
def change_password(body: PasswordChange, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not _matches(body.current_password, user):
        raise HTTPException(400, "Current password is wrong")
    user.password_hash = _hash(body.new_password)
    db.commit()
    _sign_in(request, user)  # this device stays signed in; every other session is now invalid
    return {"ok": True}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_out(db, user)


@router.patch("/me")
def update_me(body: Profile, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.full_name = body.full_name.strip()
    db.commit()
    return me_out(db, user)
