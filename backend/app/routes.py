from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import dashboard
from .auth import current_user, require, user_out
from .db import get_db
from .models import (ROLES, Activity, Comment, Invitation, Member, Notification, Project, ProjectStar, Task, User,
                     Workspace, iso, local_today, task_assignees, utcnow)

router = APIRouter(prefix="/api")

Role = Literal["owner", "admin", "member", "viewer"]
Stage = Literal["backlog", "todo", "in_progress", "in_review", "done"]
Priority = Literal["low", "medium", "high", "urgent"]
TaskType = Literal["task", "milestone", "issue", "request"]
Approval = Literal["not_needed", "needed", "approved"]
COLOR = r"^#[0-9A-Fa-f]{6}$"


class Ctx:
    """Signed-in user + database session, with the access check every route starts from."""

    def __init__(self, user: User = Depends(current_user), db: Session = Depends(get_db)):
        self.user, self.db = user, db

    def require(self, workspace_id: int, min_role: str = "viewer") -> str:
        return require(self.db, self.user, workspace_id, min_role)

    def _owned(self, model, id_: int, min_role: str):
        row = self.db.get(model, id_)
        if not row:
            raise HTTPException(404, "Not found")
        self.require(row.workspace_id, min_role)
        return row

    def project(self, project_id: int, min_role: str = "viewer") -> Project:
        return self._owned(Project, project_id, min_role)

    def task(self, task_id: int, min_role: str = "viewer") -> Task:
        return self._owned(Task, task_id, min_role)


# ---------- workspaces and people ----------

class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RoleIn(BaseModel):
    role: Role


class InviteIn(BaseModel):
    email: EmailStr
    role: Role = "member"


@router.post("/workspaces")
def create_workspace(body: NameIn, c: Ctx = Depends()):
    ws = Workspace(name=body.name.strip(), created_by=c.user.id)
    c.db.add(ws)
    c.db.flush()
    c.db.add(Member(workspace_id=ws.id, user_id=c.user.id, role="owner"))
    c.db.commit()
    return {"id": ws.id, "name": ws.name, "role": "owner"}


def member_out(m: Member) -> dict:
    return {**user_out(m.user), "role": m.role}


@router.get("/workspaces/{ws}/members")
def list_members(ws: int, c: Ctx = Depends()):
    c.require(ws)
    rows = c.db.scalars(select(Member).where(Member.workspace_id == ws)).all()
    return sorted((member_out(m) for m in rows), key=lambda m: (ROLES.index(m["role"]), m["full_name"].lower()))


def can_manage(actor_role: str, target_role: str, new_role: str | None = None) -> bool:
    """Owners manage anyone. Admins manage admins and below, and cannot hand out owner."""
    if actor_role == "owner":
        return True
    return actor_role == "admin" and target_role != "owner" and new_role != "owner"


def managed_member(c: Ctx, ws: int, uid: int, new_role: str | None = None) -> Member:
    actor_role = c.require(ws, "admin")
    m = c.db.get(Member, (ws, uid))
    if not m:
        raise HTTPException(404, "Not found")
    if uid == c.user.id:  # also guarantees a workspace never loses its last owner
        raise HTTPException(400, "You cannot change your own membership")
    if not can_manage(actor_role, m.role, new_role):
        raise HTTPException(403, "Your role does not allow this")
    return m


@router.patch("/workspaces/{ws}/members/{uid}")
def change_role(ws: int, uid: int, body: RoleIn, c: Ctx = Depends()):
    m = managed_member(c, ws, uid, body.role)
    m.role = body.role
    c.db.commit()
    return member_out(m)


@router.delete("/workspaces/{ws}/members/{uid}")
def remove_member(ws: int, uid: int, c: Ctx = Depends()):
    m = managed_member(c, ws, uid)
    c.db.execute(delete(task_assignees).where(
        task_assignees.c.user_id == uid,
        task_assignees.c.task_id.in_(select(Task.id).where(Task.workspace_id == ws))))
    c.db.delete(m)
    c.db.commit()
    return {"ok": True}


def invite_out(i: Invitation) -> dict:
    return {"id": i.id, "email": i.email, "role": i.role, "token": i.token, "expires_at": iso(i.expires_at)}


def pending():
    return Invitation.accepted_at.is_(None), Invitation.expires_at > utcnow()


@router.post("/workspaces/{ws}/invitations")
def invite(ws: int, body: InviteIn, c: Ctx = Depends()):
    actor_role = c.require(ws, "admin")
    if not can_manage(actor_role, body.role, body.role):
        raise HTTPException(403, "Only an owner can invite another owner")
    email = body.email.lower()
    if c.db.scalar(select(Member).join(User, User.id == Member.user_id)
                   .where(Member.workspace_id == ws, User.email == email)):
        raise HTTPException(409, "This person is already in the workspace")
    inv = Invitation(workspace_id=ws, email=email, role=body.role)
    c.db.add(inv)
    c.db.commit()
    return invite_out(inv)


@router.get("/workspaces/{ws}/invitations")
def list_invitations(ws: int, c: Ctx = Depends()):
    c.require(ws, "admin")
    rows = c.db.scalars(select(Invitation).where(Invitation.workspace_id == ws, *pending()).order_by(Invitation.id))
    return [invite_out(i) for i in rows]


@router.delete("/workspaces/{ws}/invitations/{iid}")
def revoke_invitation(ws: int, iid: int, c: Ctx = Depends()):
    c.require(ws, "admin")
    inv = c.db.get(Invitation, iid)
    if not inv or inv.workspace_id != ws:
        raise HTTPException(404, "Not found")
    c.db.delete(inv)
    c.db.commit()
    return {"ok": True}


def valid_invite(db: Session, token: str) -> Invitation:
    inv = db.scalar(select(Invitation).where(Invitation.token == token, *pending()))
    if not inv:
        raise HTTPException(404, "This invitation is no longer valid")
    return inv


@router.get("/invitations/{token}")  # public on purpose: the invite page shows this before sign-in
def show_invitation(token: str, db: Session = Depends(get_db)):
    inv = valid_invite(db, token)
    return {"workspace_name": db.get(Workspace, inv.workspace_id).name, "email": inv.email, "role": inv.role}


@router.post("/invitations/{token}/accept")
def accept_invitation(token: str, c: Ctx = Depends()):
    inv = valid_invite(c.db, token)
    if inv.email != c.user.email:
        raise HTTPException(403, f"This invitation is for {inv.email}")
    if not c.db.get(Member, (inv.workspace_id, c.user.id)):
        c.db.add(Member(workspace_id=inv.workspace_id, user_id=c.user.id, role=inv.role))
    inv.accepted_at = utcnow()
    c.db.commit()
    return {"workspace_id": inv.workspace_id}


# ---------- projects ----------

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    key: str = Field(pattern=r"^[A-Z]{2,5}$")
    color: str = Field("#1D4ED8", pattern=COLOR)
    start_date: date | None = None
    end_date: date | None = None


class ProjectPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    color: str | None = Field(None, pattern=COLOR)
    status: Literal["open", "cancelled", "closed"] | None = None
    archived: bool | None = None
    start_date: date | None = None
    end_date: date | None = None


class StarIn(BaseModel):
    starred: bool


def project_out(p: Project, starred: bool) -> dict:
    return {"id": p.id, "workspace_id": p.workspace_id, "name": p.name, "key": p.key, "color": p.color,
            "status": p.status, "archived": p.archived_at is not None,
            "start_date": p.start_date, "end_date": p.end_date, "starred": starred}


@router.get("/workspaces/{ws}/projects")
def list_projects(ws: int, c: Ctx = Depends()):
    c.require(ws)
    starred = set(c.db.scalars(select(ProjectStar.project_id).where(ProjectStar.user_id == c.user.id)))
    rows = c.db.scalars(select(Project).where(Project.workspace_id == ws).order_by(Project.name))
    return [project_out(p, p.id in starred) for p in rows]


@router.post("/workspaces/{ws}/projects")
def create_project(ws: int, body: ProjectIn, c: Ctx = Depends()):
    c.require(ws, "admin")
    p = Project(workspace_id=ws, created_by=c.user.id, **body.model_dump())
    c.db.add(p)
    try:
        c.db.commit()
    except IntegrityError:
        c.db.rollback()
        raise HTTPException(409, f"Key {body.key} is already used in this workspace")
    return project_out(p, False)


@router.patch("/projects/{pid}")
def update_project(pid: int, body: ProjectPatch, c: Ctx = Depends()):
    p = c.project(pid, "admin")
    data = body.model_dump(exclude_unset=True)
    if "archived" in data:
        p.archived_at = utcnow() if data.pop("archived") else None
    for k, v in data.items():
        if v is not None or k in ("start_date", "end_date"):  # only the dates may be cleared
            setattr(p, k, v)
    c.db.commit()
    return project_out(p, c.db.get(ProjectStar, (c.user.id, pid)) is not None)


@router.put("/projects/{pid}/star")
def star_project(pid: int, body: StarIn, c: Ctx = Depends()):
    c.project(pid)
    row = c.db.get(ProjectStar, (c.user.id, pid))
    if body.starred and not row:
        c.db.add(ProjectStar(user_id=c.user.id, project_id=pid))
    elif not body.starred and row:
        c.db.delete(row)
    c.db.commit()
    return {"starred": body.starred}


# ---------- tasks ----------

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field("", max_length=20000)
    stage: Stage = "todo"
    priority: Priority = "medium"
    type: TaskType = "task"
    approval: Approval = "not_needed"
    reference_code: str | None = Field(None, max_length=100)
    due_date: date | None = None
    assignee_ids: list[int] = []


class TaskPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = Field(None, max_length=20000)
    stage: Stage | None = None
    priority: Priority | None = None
    type: TaskType | None = None
    approval: Approval | None = None
    reference_code: str | None = Field(None, max_length=100)
    due_date: date | None = None
    assignee_ids: list[int] | None = None
    position: float | None = None
    done: bool | None = None  # true = move to Done; false = back to the stage it came from


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


def workspace_users(db: Session, ws: int, ids: list[int]) -> list[User]:
    """Only members of the workspace can be assigned, whatever ids the client sends."""
    if not ids:
        return []
    return list(db.scalars(select(User).join(Member, Member.user_id == User.id)
                           .where(Member.workspace_id == ws, User.id.in_(ids)).order_by(User.full_name)))


def log(db: Session, task: Task, user: User, action: str, old: str | None = None, new: str | None = None):
    db.add(Activity(task_id=task.id, actor_id=user.id, action=action, from_value=old, to_value=new))


def notify(db: Session, task: Task, users, actor: User, kind: str):
    for uid in {u.id for u in users} - {actor.id}:
        db.add(Notification(user_id=uid, task_id=task.id, kind=kind))


def end_position(db: Session, project_id: int, stage: str) -> float:
    last = db.scalar(select(func.max(Task.position)).where(Task.project_id == project_id, Task.stage == stage))
    return (last or 0) + 1


def names(users) -> str:
    return ", ".join(u.full_name for u in users)


@router.get("/workspaces/{ws}/tasks")
def list_tasks(ws: int, c: Ctx = Depends()):
    # shortcut: returns every task in the workspace and the app filters in the browser;
    # add paging and server-side search when a workspace passes a few thousand tasks
    c.require(ws)
    return [t.out() for t in c.db.scalars(select(Task).where(Task.workspace_id == ws).order_by(Task.position, Task.id))]


@router.post("/projects/{pid}/tasks")
def create_task(pid: int, body: TaskIn, c: Ctx = Depends()):
    p = c.project(pid, "member")
    # One atomic statement hands out the number, so two people creating at once never get the same key.
    number = c.db.execute(update(Project).where(Project.id == pid).values(task_seq=Project.task_seq + 1)
                          .returning(Project.task_seq)).scalar_one()
    t = Task(project_id=pid, workspace_id=p.workspace_id, number=number, created_by=c.user.id,
             position=end_position(c.db, pid, body.stage), **body.model_dump(exclude={"assignee_ids"}))
    if t.stage == "done":
        t.completed_at = utcnow()
    t.assignees = workspace_users(c.db, p.workspace_id, body.assignee_ids)
    c.db.add(t)
    c.db.flush()
    log(c.db, t, c.user, "created")
    notify(c.db, t, t.assignees, c.user, "assigned")
    c.db.commit()
    return t.out()


@router.patch("/tasks/{tid}")
def update_task(tid: int, body: TaskPatch, c: Ctx = Depends()):
    t = c.task(tid, "member")
    data = body.model_dump(exclude_unset=True)

    done = data.pop("done", None)
    if done is True:
        data["stage"] = "done"
    elif done is False and t.stage == "done":
        data["stage"] = t.prev_stage or "todo"

    stage = data.pop("stage", None) or t.stage
    if stage != t.stage:
        if stage == "done":
            t.prev_stage, t.completed_at = t.stage, utcnow()
            log(c.db, t, c.user, "completed", t.stage, stage)
        else:
            t.completed_at = None
            log(c.db, t, c.user, "stage", t.stage, stage)
        t.stage = stage
        if data.get("position") is None:
            data["position"] = end_position(c.db, t.project_id, stage)

    if "due_date" in data and data["due_date"] != t.due_date:
        log(c.db, t, c.user, "due_date", str(t.due_date or ""), str(data["due_date"] or ""))

    if data.get("assignee_ids") is not None:
        new = workspace_users(c.db, t.workspace_id, data["assignee_ids"])
        if {u.id for u in new} != {u.id for u in t.assignees}:
            log(c.db, t, c.user, "assignees", names(t.assignees), names(new))
            notify(c.db, t, [u for u in new if u not in t.assignees], c.user, "assigned")
            t.assignees = new
    data.pop("assignee_ids", None)

    for k, v in data.items():
        if v is not None or k in ("due_date", "reference_code"):  # only these two may be cleared
            setattr(t, k, v)
    c.db.commit()
    return t.out()


@router.delete("/tasks/{tid}")
def delete_task(tid: int, c: Ctx = Depends()):
    t = c.task(tid, "member")
    if c.require(t.workspace_id) == "member" and t.created_by != c.user.id:
        raise HTTPException(403, "Members can delete only the tasks they created")
    c.db.delete(t)
    c.db.commit()
    return {"ok": True}


def who(u: User | None) -> str:
    return u.full_name if u else "Someone"


def comment_out(cm: Comment) -> dict:
    return {"id": cm.id, "body": cm.body, "author": who(cm.author), "created_at": iso(cm.created_at)}


@router.get("/tasks/{tid}")
def task_detail(tid: int, c: Ctx = Depends()):
    t = c.task(tid)
    comments = c.db.scalars(select(Comment).where(Comment.task_id == tid).order_by(Comment.id))
    activity = c.db.scalars(select(Activity).where(Activity.task_id == tid).order_by(Activity.id.desc()))
    return {
        "task": t.out(),
        "created_by_name": who(c.db.get(User, t.created_by) if t.created_by else None),
        "comments": [comment_out(cm) for cm in comments],
        "activity": [{"id": a.id, "action": a.action, "from": a.from_value, "to": a.to_value,
                      "actor": who(a.actor), "created_at": iso(a.created_at)} for a in activity],
    }


@router.post("/tasks/{tid}/comments")
def add_comment(tid: int, body: CommentIn, c: Ctx = Depends()):
    t = c.task(tid, "member")
    cm = Comment(task_id=tid, author_id=c.user.id, body=body.body.strip())
    c.db.add(cm)
    owners = list(t.assignees) + ([c.db.get(User, t.created_by)] if t.created_by else [])
    notify(c.db, t, [u for u in owners if u], c.user, "comment")
    c.db.commit()
    return comment_out(cm)


# ---------- notifications ----------

@router.get("/notifications")
def list_notifications(c: Ctx = Depends()):
    my_workspaces = select(Member.workspace_id).where(Member.user_id == c.user.id)
    # shortcut: "my task became overdue" is created here, when the bell loads, once per task;
    # move it to a scheduled job when email digests are added
    overdue = c.db.scalars(
        select(Task).join(task_assignees, task_assignees.c.task_id == Task.id).where(
            task_assignees.c.user_id == c.user.id, Task.workspace_id.in_(my_workspaces),
            Task.due_date < local_today(), Task.stage != "done",
            ~exists().where(Notification.user_id == c.user.id, Notification.task_id == Task.id,
                            Notification.kind == "overdue"))).all()
    for t in overdue:
        c.db.add(Notification(user_id=c.user.id, task_id=t.id, kind="overdue"))
    if overdue:
        c.db.commit()
    rows = c.db.scalars(
        select(Notification).join(Task, Task.id == Notification.task_id)
        .where(Notification.user_id == c.user.id, Task.workspace_id.in_(my_workspaces))
        .order_by(Notification.id.desc()).limit(50)).all()
    return [{"id": n.id, "kind": n.kind, "read": n.read_at is not None, "created_at": iso(n.created_at),
             "task": {"id": n.task.id, "key": f"{n.task.project.key}-{n.task.number}", "title": n.task.title,
                      "workspace_id": n.task.workspace_id, "project_key": n.task.project.key}} for n in rows]


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, c: Ctx = Depends()):
    n = c.db.get(Notification, nid)
    if not n or n.user_id != c.user.id:
        raise HTTPException(404, "Not found")
    n.read_at = n.read_at or utcnow()
    c.db.commit()
    return {"ok": True}


# ---------- dashboard ----------

@router.get("/workspaces/{ws}/dashboard")
def get_dashboard(ws: int, project_id: int | None = None, assignee_id: int | None = None,
                  start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
                  c: Ctx = Depends()):
    c.require(ws)
    return dashboard.build(c.db, c.user, ws, project_id, assignee_id, start, end)
