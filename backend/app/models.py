import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Column, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ["owner", "admin", "member", "viewer"]  # order is the rule: lower index = more power
STAGES = ["backlog", "todo", "in_progress", "in_review", "done"]


def utcnow() -> datetime:
    """All timestamps are stored as naive UTC; the API adds the Z."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


# shortcut: "today" is fixed to Asia/Jakarta (UTC+7, no daylight saving); make it per-workspace when a team elsewhere joins
LOCAL_OFFSET = timedelta(hours=7)


def local_today() -> date:
    return (utcnow() + LOCAL_OFFSET).date()


def ref(target: str, **kw):
    return mapped_column(ForeignKey(target, ondelete="CASCADE"), **kw)


def creator():
    return mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str]
    full_name: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    created_by: Mapped[int | None] = creator()
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Member(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[int] = ref("workspaces.id", primary_key=True)
    user_id: Mapped[int] = ref("users.id", primary_key=True)
    role: Mapped[str] = mapped_column(default="member")
    user: Mapped[User] = relationship(lazy="joined")


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = ref("workspaces.id")
    email: Mapped[str]
    role: Mapped[str] = mapped_column(default="member")
    token: Mapped[str] = mapped_column(unique=True, default=lambda: secrets.token_hex(24))
    expires_at: Mapped[datetime] = mapped_column(default=lambda: utcnow() + timedelta(days=7))
    accepted_at: Mapped[datetime | None]


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("workspace_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = ref("workspaces.id")
    name: Mapped[str]
    key: Mapped[str]
    color: Mapped[str] = mapped_column(default="#1D4ED8")
    status: Mapped[str] = mapped_column(default="open")
    task_seq: Mapped[int] = mapped_column(default=0)  # feeds task numbers, never decreases
    start_date: Mapped[date | None]
    end_date: Mapped[date | None]
    archived_at: Mapped[datetime | None]
    created_by: Mapped[int | None] = creator()
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ProjectStar(Base):
    __tablename__ = "project_stars"
    user_id: Mapped[int] = ref("users.id", primary_key=True)
    project_id: Mapped[int] = ref("projects.id", primary_key=True)


task_assignees = Table(
    "task_assignees", Base.metadata,
    Column("task_id", ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("project_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = ref("projects.id")
    workspace_id: Mapped[int] = ref("workspaces.id", index=True)
    number: Mapped[int]
    title: Mapped[str]
    description: Mapped[str] = mapped_column(default="")
    stage: Mapped[str] = mapped_column(default="todo")
    prev_stage: Mapped[str | None]  # where "untick done" sends the task back to
    priority: Mapped[str] = mapped_column(default="medium")
    type: Mapped[str] = mapped_column(default="task")
    approval: Mapped[str] = mapped_column(default="not_needed")
    reference_code: Mapped[str | None]
    due_date: Mapped[date | None]
    position: Mapped[float] = mapped_column(default=0)
    completed_at: Mapped[datetime | None]
    created_by: Mapped[int | None] = creator()
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    project: Mapped[Project] = relationship(lazy="joined")
    assignees: Mapped[list[User]] = relationship(secondary=task_assignees, lazy="selectin")

    def out(self) -> dict:
        return {
            "id": self.id, "project_id": self.project_id, "workspace_id": self.workspace_id,
            "number": self.number, "key": f"{self.project.key}-{self.number}",
            "title": self.title, "description": self.description, "stage": self.stage,
            "priority": self.priority, "type": self.type, "approval": self.approval,
            "reference_code": self.reference_code, "due_date": self.due_date, "position": self.position,
            "completed_at": iso(self.completed_at), "created_by": self.created_by,
            "created_at": iso(self.created_at), "updated_at": iso(self.updated_at),
            "assignees": [{"id": u.id, "full_name": u.full_name} for u in self.assignees],
        }


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = ref("tasks.id", index=True)
    author_id: Mapped[int | None] = creator()
    body: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    author: Mapped[User | None] = relationship(lazy="joined")


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = ref("tasks.id", index=True)
    actor_id: Mapped[int | None] = creator()
    action: Mapped[str]
    from_value: Mapped[str | None]
    to_value: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    actor: Mapped[User | None] = relationship(lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = ref("users.id", index=True)
    task_id: Mapped[int] = ref("tasks.id")
    kind: Mapped[str]  # assigned | comment | overdue
    read_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    task: Mapped[Task] = relationship(lazy="joined")
