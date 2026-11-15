# Gemma

A Kanban project tracker for small teams. The full spec is in [PRD.md](PRD.md).

- `backend/`: FastAPI + SQLAlchemy + SQLite (Python, run with [uv](https://docs.astral.sh/uv/))
- `frontend/`: React + Vite + TypeScript + Tailwind + shadcn/ui

## Run locally

You need **uv** and **Node.js 20+**. Use two terminals.

Terminal 1, the API (http://localhost:8000):

```bash
cd backend
uv run python -m app.seed
uv run uvicorn app.main:app --reload
```

Terminal 2, the app (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and log in.

The seed step creates a workspace called "Demo Team" with three accounts (owner, member, viewer), two projects and 12 tasks. The emails and the shared password are at the top of [backend/app/seed.py](backend/app/seed.py). The seed does nothing if the database already has users; to start over, stop the API, delete `backend/gemma.db` and seed again.

You can also click "Create account" to sign up as a new user and make your own workspace.

## Tests

```bash
cd backend
uv run pytest
```

The tests cover the PRD checklist items the backend can prove: workspaces are isolated from each other, each role can do only what the permission table allows, task keys are never reused, mark done and untick, notifications, and the dashboard numbers.

## What is not built yet

- **Google sign-in, password reset, email confirmation.** Each needs an external service (a Google OAuth client, an email sender).
- **Invitation emails.** The People page creates an invite link; copy it and send it yourself.
- **Live updates use polling.** The board refreshes every 5 seconds instead of using websockets.
- **Description is plain text.** Markdown is stored as typed but not rendered.
- **Project logo upload.** Projects show a coloured tile with their initial.
- **Group By works in the List view only.** Grouping the board into rows is the v2 "swimlanes" feature.
- **Charts have no text alternative** for screen readers beyond the tables next to them.
- **No login rate limiting**, and nothing is deployed.

Search the code for `shortcut:` to find each deliberate shortcut and when to replace it.

## Open decisions

These follow the PRD as written until you decide otherwise:

1. **Stat cards and stages.** The cards count To Do, In Progress and Done, so tasks in Backlog and In Review appear only in Total.
2. **Approval.** "Needs Approval" is a label only; it does not stop a task from moving to Done.
3. **Reports and Chat.** Both are shown greyed out in the top bar because the PRD lists them as out of scope.
4. **Time zone.** "Today" on the dashboard is fixed to Asia/Jakarta (UTC+7).
