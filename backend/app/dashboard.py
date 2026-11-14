"""Dashboard numbers (PRD F12): one function per widget, all fed by build()."""
from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy import select

from .models import LOCAL_OFFSET, STAGES, Project, Task, local_today

OPEN_STAGES = STAGES[:-1]


def is_overdue(t: Task, today: date) -> bool:
    return t.stage != "done" and t.due_date is not None and t.due_date < today


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def local_date(dt) -> date:
    return (dt + LOCAL_OFFSET).date()


def kpis(projects, tasks, today):
    open_ = [t for t in tasks if t.stage != "done"]
    return {
        "active_projects": sum(p.status == "open" for p in projects),
        "open_tasks": len(open_),
        "done_this_week": sum(1 for t in tasks if t.stage == "done" and t.completed_at
                              and local_date(t.completed_at) >= monday(today)),
        "overdue": sum(is_overdue(t, today) for t in tasks),
        "due_next_7": sum(1 for t in open_ if t.due_date and today <= t.due_date <= today + timedelta(days=7)),
    }


def health(total: int, done: int, open_: int, overdue: int, end_date: date | None, today: date) -> str:
    """PRD health rule. Off track is checked first, so 3+ overdue never reads as merely at risk."""
    if overdue >= 3 or (overdue and overdue / open_ >= 0.10):
        return "off_track"
    near_end = end_date is not None and (end_date - today).days < 7
    if overdue or (total and done / total < 0.5 and near_end):
        return "at_risk"
    return "on_track"


def project_health(projects, tasks, today):
    by_project = defaultdict(list)
    for t in tasks:
        by_project[t.project_id].append(t)
    out = []
    for p in projects:
        ts = by_project[p.id]
        done = sum(t.stage == "done" for t in ts)
        overdue = sum(is_overdue(t, today) for t in ts)
        upcoming = [t.due_date for t in ts if t.stage != "done" and t.due_date and t.due_date >= today]
        out.append({
            "project_id": p.id, "key": p.key, "name": p.name, "color": p.color,
            "total": len(ts), "done": done, "pct_done": round(100 * done / len(ts)) if ts else 0,
            "open": len(ts) - done, "overdue": overdue, "next_due": min(upcoming, default=None),
            "health": health(len(ts), done, len(ts) - done, overdue, p.end_date, today),
        })
    return out


def workload(tasks):
    rows = {}
    for t in tasks:
        if t.stage == "done":
            continue
        for uid, name in [(u.id, u.full_name) for u in t.assignees] or [(None, "Unassigned")]:
            row = rows.setdefault(uid, {"user_id": uid, "name": name, "low": 0, "medium": 0, "high": 0, "urgent": 0})
            row[t.priority] += 1
    return sorted(rows.values(), key=lambda r: -(r["low"] + r["medium"] + r["high"] + r["urgent"]))


def trend(tasks, start: date, end: date):
    created = Counter(monday(local_date(t.created_at)) for t in tasks)
    completed = Counter(monday(local_date(t.completed_at)) for t in tasks if t.stage == "done" and t.completed_at)
    out, week = [], monday(start)
    while week <= end:
        out.append({"week": week, "created": created[week], "completed": completed[week]})
        week += timedelta(days=7)
    return out


def stage_breakdown(projects, tasks):
    counts = Counter((t.project_id, t.stage) for t in tasks)
    return [{"project_id": p.id, "key": p.key, **{s: counts[(p.id, s)] for s in OPEN_STAGES}} for p in projects]


def brief(t: Task) -> dict:
    return {"id": t.id, "key": f"{t.project.key}-{t.number}", "title": t.title, "due_date": t.due_date,
            "priority": t.priority, "owners": [u.full_name for u in t.assignees]}


def overdue_list(tasks, today):
    return [brief(t) for t in sorted((t for t in tasks if is_overdue(t, today)), key=lambda t: t.due_date)[:10]]


def my_tasks(tasks, user):
    mine = [t for t in tasks if t.stage != "done" and any(u.id == user.id for u in t.assignees)]
    return [brief(t) for t in sorted(mine, key=lambda t: (t.due_date is None, t.due_date or date.max))[:10]]


def build(db, user, workspace_id: int, project_id: int | None, assignee_id: int | None,
          start: date | None, end: date | None) -> dict:
    today = local_today()
    end = end or today
    start = start or end - timedelta(weeks=7)  # 8 weekly points by default
    start = max(start, end - timedelta(weeks=104))  # keep the trend loop bounded whatever the client sends

    q = select(Project).where(Project.workspace_id == workspace_id, Project.archived_at.is_(None)).order_by(Project.name)
    if project_id:
        q = q.where(Project.id == project_id)
    projects = db.scalars(q).all()
    ids = [p.id for p in projects]
    all_tasks = db.scalars(select(Task).where(Task.workspace_id == workspace_id, Task.project_id.in_(ids))).all() if ids else []
    tasks = [t for t in all_tasks if assignee_id is None or any(u.id == assignee_id for u in t.assignees)]
    return {
        "kpis": kpis(projects, tasks, today),
        "project_health": project_health(projects, tasks, today),
        "workload": workload(tasks),
        "trend": trend(tasks, start, end),
        "stages": stage_breakdown(projects, tasks),
        "overdue": overdue_list(tasks, today),
        "my_tasks": my_tasks(all_tasks, user),
    }
