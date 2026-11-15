"""The checks from the PRD testing checklist that the backend can prove. Run: uv run pytest"""
import os
import tempfile
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db").replace("\\", "/")
os.environ["GEMMA_SECRET"] = "test-secret"

from fastapi.testclient import TestClient  # noqa: E402

from app.dashboard import health  # noqa: E402
from app.main import app  # noqa: E402

PW = "test-password-1"
_n = 0


def signup(name: str):
    """A new signed-in client. Each call is a different person."""
    global _n
    _n += 1
    c = TestClient(app)
    r = c.post("/api/auth/signup", json={"email": f"{name}{_n}@example.com", "password": PW, "full_name": name})
    assert r.status_code == 200, r.text
    c.uid, c.email = r.json()["user"]["id"], r.json()["user"]["email"]
    return c


def workspace(owner, name="WS"):
    return owner.post("/api/workspaces", json={"name": name}).json()["id"]


def join(owner, ws, person, role):
    token = owner.post(f"/api/workspaces/{ws}/invitations", json={"email": person.email, "role": role}).json()["token"]
    assert person.post(f"/api/invitations/{token}/accept").status_code == 200


def project(admin, ws, key="AAA"):
    r = admin.post(f"/api/workspaces/{ws}/projects", json={"name": "P", "key": key})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def task(c, pid, **kw):
    r = c.post(f"/api/projects/{pid}/tasks", json={"title": "T", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_logged_out_gets_401():
    assert TestClient(app).get("/api/auth/me").status_code == 401
    assert TestClient(app).get("/api/workspaces/1/tasks").status_code == 401


def test_workspaces_are_isolated():
    a, b = signup("a"), signup("b")
    ws = workspace(a)
    workspace(b)
    pid = project(a, ws)
    tid = task(a, pid)["id"]
    for r in [
        b.get(f"/api/workspaces/{ws}/projects"), b.get(f"/api/workspaces/{ws}/tasks"),
        b.get(f"/api/workspaces/{ws}/members"), b.get(f"/api/workspaces/{ws}/dashboard"),
        b.get(f"/api/tasks/{tid}"), b.post(f"/api/projects/{pid}/tasks", json={"title": "x"}),
        b.patch(f"/api/tasks/{tid}", json={"title": "hacked"}), b.delete(f"/api/tasks/{tid}"),
        b.post(f"/api/tasks/{tid}/comments", json={"body": "hi"}), b.patch(f"/api/projects/{pid}", json={"name": "x"}),
        b.post(f"/api/workspaces/{ws}/invitations", json={"email": b.email}),
    ]:
        assert r.status_code == 404, (r.request.method, r.request.url, r.status_code)
    assert a.get(f"/api/tasks/{tid}").json()["task"]["title"] == "T"
    # an outsider cannot be assigned, even if the client sends their id
    assert a.patch(f"/api/tasks/{tid}", json={"assignee_ids": [b.uid]}).json()["assignees"] == []


def test_role_permissions():
    owner, admin, member, viewer = signup("owner"), signup("admin"), signup("member"), signup("viewer")
    ws = workspace(owner)
    for person, role in [(admin, "admin"), (member, "member"), (viewer, "viewer")]:
        join(owner, ws, person, role)
    pid = project(owner, ws)
    t = task(owner, pid)

    # viewer: read only
    assert viewer.get(f"/api/workspaces/{ws}/tasks").status_code == 200
    assert viewer.post(f"/api/projects/{pid}/tasks", json={"title": "x"}).status_code == 403
    assert viewer.patch(f"/api/tasks/{t['id']}", json={"stage": "done"}).status_code == 403
    assert viewer.delete(f"/api/tasks/{t['id']}").status_code == 403
    assert viewer.post(f"/api/tasks/{t['id']}/comments", json={"body": "x"}).status_code == 403

    # member: tasks yes, projects and people no, deletes only their own
    mine = task(member, pid)
    assert member.patch(f"/api/tasks/{t['id']}", json={"stage": "in_progress"}).status_code == 200
    assert member.delete(f"/api/tasks/{t['id']}").status_code == 403
    assert member.delete(f"/api/tasks/{mine['id']}").status_code == 200
    assert member.post(f"/api/workspaces/{ws}/projects", json={"name": "P", "key": "BBB"}).status_code == 403
    assert member.post(f"/api/workspaces/{ws}/invitations", json={"email": "x@example.com"}).status_code == 403

    # admin: manages admins and below, never owners
    assert admin.delete(f"/api/tasks/{t['id']}").status_code == 200
    assert admin.patch(f"/api/workspaces/{ws}/members/{member.uid}", json={"role": "admin"}).status_code == 200
    assert admin.patch(f"/api/workspaces/{ws}/members/{member.uid}", json={"role": "owner"}).status_code == 403
    assert admin.patch(f"/api/workspaces/{ws}/members/{owner.uid}", json={"role": "member"}).status_code == 403
    assert admin.delete(f"/api/workspaces/{ws}/members/{owner.uid}").status_code == 403
    assert admin.post(f"/api/workspaces/{ws}/invitations", json={"email": "x@example.com", "role": "owner"}).status_code == 403
    assert owner.patch(f"/api/workspaces/{ws}/members/{owner.uid}", json={"role": "viewer"}).status_code == 400

    # removed people lose access at once
    assert owner.delete(f"/api/workspaces/{ws}/members/{viewer.uid}").status_code == 200
    assert viewer.get(f"/api/workspaces/{ws}/tasks").status_code == 404


def test_invitation_is_bound_to_its_email():
    owner, right, wrong = signup("owner"), signup("right"), signup("wrong")
    ws = workspace(owner)
    token = owner.post(f"/api/workspaces/{ws}/invitations", json={"email": right.email, "role": "viewer"}).json()["token"]
    assert TestClient(app).get(f"/api/invitations/{token}").json()["role"] == "viewer"
    assert wrong.post(f"/api/invitations/{token}/accept").status_code == 403
    assert right.post(f"/api/invitations/{token}/accept").status_code == 200
    assert right.post(f"/api/invitations/{token}/accept").status_code == 404  # single use
    assert right.get("/api/auth/me").json()["workspaces"][0]["role"] == "viewer"


def test_task_keys_are_sequential_and_never_reused():
    a = signup("a")
    pid = project(a, workspace(a), "MAS")
    first, second = task(a, pid), task(a, pid)
    assert (first["key"], second["key"]) == ("MAS-1", "MAS-2")
    a.delete(f"/api/tasks/{second['id']}")
    assert task(a, pid)["key"] == "MAS-3"
    assert a.post(f"/api/workspaces/{first['workspace_id']}/projects", json={"name": "P", "key": "MAS"}).status_code == 409
    assert a.post(f"/api/workspaces/{first['workspace_id']}/projects", json={"name": "P", "key": "mas"}).status_code == 422


def test_mark_done_and_untick_restores_stage():
    a = signup("a")
    pid = project(a, workspace(a))
    t = task(a, pid, stage="in_review")
    done = a.patch(f"/api/tasks/{t['id']}", json={"done": True}).json()
    assert done["stage"] == "done" and done["completed_at"]
    back = a.patch(f"/api/tasks/{t['id']}", json={"done": False}).json()
    assert back["stage"] == "in_review" and back["completed_at"] is None
    actions = [x["action"] for x in a.get(f"/api/tasks/{t['id']}").json()["activity"]]
    assert actions == ["stage", "completed", "created"]


def test_assignment_and_comment_notify_the_other_person():
    owner, member = signup("owner"), signup("member")
    ws = workspace(owner)
    join(owner, ws, member, "member")
    pid = project(owner, ws)
    overdue = (date.today() - timedelta(days=3)).isoformat()
    t = task(owner, pid, assignee_ids=[member.uid], due_date=overdue)
    owner.post(f"/api/tasks/{t['id']}/comments", json={"body": "ping"})
    kinds = sorted(n["kind"] for n in member.get("/api/notifications").json())
    assert kinds == ["assigned", "comment", "overdue"]
    assert len(member.get("/api/notifications").json()) == 3  # overdue is not created twice
    assert owner.get("/api/notifications").json() == []  # nobody is notified about their own actions
    nid = member.get("/api/notifications").json()[0]["id"]
    assert owner.post(f"/api/notifications/{nid}/read").status_code == 404
    assert member.post(f"/api/notifications/{nid}/read").status_code == 200


def test_health_rule():
    today = date(2026, 11, 15)
    assert health(10, 5, 5, 0, None, today) == "on_track"
    assert health(40, 10, 30, 2, None, today) == "at_risk"            # 1-2 overdue, under 10% of open
    assert health(10, 2, 8, 0, today + timedelta(days=3), today) == "at_risk"  # under 50% done, under 7 days left
    assert health(40, 10, 30, 3, None, today) == "off_track"          # 3+ overdue
    assert health(10, 5, 5, 1, None, today) == "off_track"            # overdue is 10%+ of open
    assert health(0, 0, 0, 0, None, today) == "on_track"


def test_dashboard_counts():
    a = signup("a")
    ws = workspace(a)
    pid = project(a, ws)
    late = (date.today() - timedelta(days=5)).isoformat()
    task(a, pid, due_date=late, assignee_ids=[a.uid])
    task(a, pid, stage="done")
    task(a, pid)
    d = a.get(f"/api/workspaces/{ws}/dashboard").json()
    assert d["kpis"] == {"active_projects": 1, "open_tasks": 2, "done_this_week": 1, "overdue": 1, "due_next_7": 0}
    assert d["project_health"][0]["pct_done"] == 33 and d["project_health"][0]["health"] == "off_track"
    assert len(d["trend"]) == 8 and d["trend"][-1] == {"week": d["trend"][-1]["week"], "created": 3, "completed": 1}
    assert [t["key"] for t in d["overdue"]] == ["AAA-1"] and [t["key"] for t in d["my_tasks"]] == ["AAA-1"]
    assert d["workload"][0]["medium"] == 1


def test_change_password_signs_out_other_devices():
    phone = signup("p")
    laptop = TestClient(app)
    assert laptop.post("/api/auth/login", json={"email": phone.email, "password": PW}).status_code == 200
    assert phone.post("/api/auth/password", json={"current_password": "wrong-password", "new_password": "new-password-2"}).status_code == 400
    assert phone.post("/api/auth/password", json={"current_password": PW, "new_password": "short"}).status_code == 422
    assert phone.post("/api/auth/password", json={"current_password": PW, "new_password": "new-password-2"}).status_code == 200
    assert phone.get("/api/auth/me").status_code == 200   # the device that changed it stays in
    assert laptop.get("/api/auth/me").status_code == 401  # every other session is out
    assert laptop.post("/api/auth/login", json={"email": phone.email, "password": PW}).status_code == 401
    assert laptop.post("/api/auth/login", json={"email": phone.email, "password": "new-password-2"}).status_code == 200


def test_comments_edit_and_delete_rules():
    owner, author, other, outsider = signup("owner"), signup("author"), signup("other"), signup("outsider")
    ws = workspace(owner)
    join(owner, ws, author, "member")
    join(owner, ws, other, "member")
    tid = task(owner, project(owner, ws))["id"]
    cid = author.post(f"/api/tasks/{tid}/comments", json={"body": "first"}).json()["id"]
    assert other.patch(f"/api/comments/{cid}", json={"body": "x"}).status_code == 403
    assert owner.patch(f"/api/comments/{cid}", json={"body": "x"}).status_code == 403  # nobody rewrites another person's words
    assert outsider.patch(f"/api/comments/{cid}", json={"body": "x"}).status_code == 404
    assert author.patch(f"/api/comments/{cid}", json={"body": "edited"}).json()["body"] == "edited"
    assert other.delete(f"/api/comments/{cid}").status_code == 403
    assert outsider.delete(f"/api/comments/{cid}").status_code == 404
    assert owner.delete(f"/api/comments/{cid}").status_code == 200  # admins and owners can remove any comment
    assert author.get(f"/api/tasks/{tid}").json()["comments"] == []


def test_mark_all_notifications_read():
    owner, member = signup("owner"), signup("member")
    ws = workspace(owner)
    join(owner, ws, member, "member")
    pid = project(owner, ws)
    task(owner, pid, assignee_ids=[member.uid])
    task(owner, pid, assignee_ids=[member.uid])
    assert [n["read"] for n in member.get("/api/notifications").json()] == [False, False]
    assert member.post("/api/notifications/read-all").status_code == 200
    assert [n["read"] for n in member.get("/api/notifications").json()] == [True, True]
