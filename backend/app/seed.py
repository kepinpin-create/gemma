"""Demo data for local testing. Run from backend/:  uv run python -m app.seed
Does nothing if the database already has users. Never run this against real data."""
from datetime import timedelta

import bcrypt
from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import Member, Project, Task, User, Workspace, local_today, utcnow

# Local demo accounts only. All three share this password.
DEMO_PASSWORD = "gemma-demo-2026"
DEMO_USERS = [  # (email, name, role)
    ("olivia@example.com", "Olivia Hart", "owner"),
    ("alex@example.com", "Alex Tan", "member"),
    ("vera@example.com", "Vera Lim", "viewer"),
]

# (project key, title, stage, priority, type, approval, due in days from today, assignee index or None, done days ago)
TASKS = [
    ("EVT", "Book the venue", "done", "high", "milestone", "approved", -20, 0, 18),
    ("EVT", "Collect catering quotes", "done", "medium", "task", "not_needed", -9, 1, 6),
    ("EVT", "Send invitations to speakers", "in_review", "high", "task", "needed", 1, 1, None),
    ("EVT", "Design the event poster", "in_progress", "medium", "request", "needed", 5, 1, None),
    ("EVT", "Confirm sound and lighting vendor", "todo", "urgent", "task", "not_needed", -3, 0, None),
    ("EVT", "Draft the run-of-show", "todo", "medium", "task", "not_needed", 12, None, None),
    ("EVT", "Order name badges", "backlog", "low", "task", "not_needed", None, None, None),
    ("OPS", "Sign the new office lease", "done", "urgent", "milestone", "approved", -30, 0, 27),
    ("OPS", "Get quotes from three movers", "in_progress", "high", "task", "not_needed", -1, 1, None),
    ("OPS", "Label and pack the archive room", "todo", "medium", "task", "not_needed", 9, 1, None),
    ("OPS", "Internet line is slower than contracted", "in_progress", "high", "issue", "not_needed", 2, 0, None),
    ("OPS", "Plan the seating chart", "backlog", "low", "task", "needed", 20, None, None),
]


def run():
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User).limit(1)):
            print("Database already has users; nothing seeded.")
            return
        pw = bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt()).decode()
        users = [User(email=e, full_name=n, password_hash=pw) for e, n, _ in DEMO_USERS]
        ws = Workspace(name="Demo Team")
        db.add_all([*users, ws])
        db.flush()
        ws.created_by = users[0].id
        db.add_all(Member(workspace_id=ws.id, user_id=u.id, role=r) for u, (_, _, r) in zip(users, DEMO_USERS))

        today, now = local_today(), utcnow()
        projects = {
            "EVT": Project(workspace_id=ws.id, name="Annual Gathering 2027", key="EVT", color="#1D4ED8",
                           start_date=today - timedelta(days=30), end_date=today + timedelta(days=40)),
            "OPS": Project(workspace_id=ws.id, name="Office Move", key="OPS", color="#0F766E",
                           start_date=today - timedelta(days=40), end_date=today + timedelta(days=25)),
        }
        db.add_all(projects.values())
        db.flush()
        for i, (key, title, stage, priority, type_, approval, due, who, done_ago) in enumerate(TASKS):
            p = projects[key]
            p.task_seq += 1
            t = Task(project_id=p.id, workspace_id=ws.id, number=p.task_seq, title=title, stage=stage,
                     priority=priority, type=type_, approval=approval, position=i + 1, created_by=users[0].id,
                     due_date=today + timedelta(days=due) if due is not None else None,
                     created_at=now - timedelta(days=45 - 3 * i),
                     completed_at=now - timedelta(days=done_ago) if done_ago is not None else None,
                     prev_stage="in_review" if stage == "done" else None)
            if who is not None:
                t.assignees = [users[who]]
            db.add(t)
        db.commit()
        print(f"Seeded workspace 'Demo Team' with {len(TASKS)} tasks. Sign-in details are at the top of app/seed.py.")


if __name__ == "__main__":
    run()
