# PRD — Gemma

Nov 14, 2026 · @Kevin · updated Nov 15, 2026: stack changed from Next.js + Supabase to React + FastAPI (Python)

## Overview

Gemma (Latin for "bud") is a web app where a team signs in, creates projects of any kind (events, operations, research, marketing, internal initiatives, not only software), and moves tasks across a Kanban board from To Do to Done, with a dashboard that sums up every project, with a stat strip that shows progress at a glance. The layout follows the reference project-board screen (top nav, project sidebar, stat cards, Kanban columns), recoloured from red to blue and shipped under the Gemma name and logo.

**Problem.** Small teams track work in chats and spreadsheets. Nobody can see what is pending, who owns it, or what is overdue without asking.

**Goal.** One place to create a task, assign it, move it through stages, and mark it done, in under 10 seconds per action.

**Target users.**

| User | What they need |
| --- | --- |
| Team member | See my tasks, update status, comment |
| Project lead / PM | Create projects, assign work, watch overdue items |
| Workspace owner | Invite people, manage roles, archive projects |

**Success metrics (first 30 days of use).**

- 100% of a pilot team's active work lives in the app, not in chat
- Median time to create a task under 15 seconds
- Overdue count visible on every board, with zero tasks missing a status
- Weekly active users at least 80% of invited members

## Scope

The MVP is accounts, workspaces, projects, a Kanban board, a list view, and task CRUD. Everything else waits until a real team has used it for two weeks.

| Area | MVP (v1) | Later (v2+) |
| --- | --- | --- |
| Accounts | Email + password | Google sign-in, password reset, email confirmation (each needs an external service), SSO (SAML), 2FA |
| Workspaces | Create, invite by email, 4 roles | Billing, multiple plans |
| Projects | Create, archive, star, key prefix (e.g. MAS) | Templates, client portal |
| Board | 5 default stages, drag and drop, stat cards | Custom stages per project, WIP limits, swimlanes |
| Tasks | Create, edit, assign, priority, type, due date, mark done, delete | Subtasks, time tracking, recurring tasks |
| Collaboration | Comments, activity log | @mentions, file attachments, realtime presence |
| Approval | Approval flag per task (Needs / No need / Approved) | Multi-step approval chains |
| Views | Board, list, search, filter by type / assignee, sort | Calendar, Gantt, saved filters (Dashboard view is in v1, see F12) |
| Notifications | In-app bell for assignment and comments | Email digests, Slack, WhatsApp |
| AI | None | Task summary, auto-triage |

**Out of scope entirely:** chat (the reference screen's chat tab), product catalogue, knowledge base, reports module.

## Accounts and auth

Accounts are built in from the start; there is no no-login phase. The FastAPI backend handles sign-in itself: passwords are stored as bcrypt hashes and the session lives in a signed, HTTP-only cookie. A user belongs to one or more workspaces; every project and task belongs to exactly one workspace, and every API route checks that the signed-in user is a member of that workspace, with a high enough role, before it reads or writes anything.

**Sign-up and login flow**

1. User signs up with email + password. Google sign-in is deferred until a Google OAuth client exists.
2. Email confirmation is deferred until an email service is configured; for now the account is active at once.
3. First login with no workspace → onboarding: enter workspace name (e.g. "HashMicro ID") and display name.
4. User lands on the project list of that workspace.
5. Invited users click the invite link → sign up or log in → auto-join the workspace with the invited role.

**Roles and permissions**

| Action | Owner | Admin | Member | Viewer |
| --- | --- | --- | --- | --- |
| Invite / remove people | Yes | Yes | No | No |
| Change roles | Yes | Admins and below | No | No |
| Create / archive projects | Yes | Yes | No | No |
| Create / edit / move tasks | Yes | Yes | Yes | No |
| Delete tasks | Yes | Yes | Own tasks only | No |
| Comment | Yes | Yes | Yes | No |
| View everything in workspace | Yes | Yes | Yes | Yes |

**Acceptance criteria**

- Logged-out users hitting any app URL are redirected to /login and returned to that URL after login
- A user can never read or write another workspace's data, even by calling the API directly (verified by a backend test)
- Session persists across refresh; "Log out" clears it on all tabs
- Workspace switcher in the top bar (the "Company" slot in the reference) lists only the user's workspaces
- Avatar menu (top right) shows name, email, profile settings, log out

**Setup steps (local)**

See "Run locally" in `README.md`: install uv and Node.js, seed the SQLite database, start the API and the frontend.

## Features and user stories

Each feature below is one build step; the acceptance criteria are what you check before moving on.

### F1. Projects sidebar

As a member, I want to see all projects in my workspace so I can jump between them.

- Left sidebar lists projects: coloured initial tile (or logo), name, status (Open / Cancelled / Closed), star toggle
- Starred projects pin to the top; search box filters by name
- Expanding a project shows its views (Board, List) with task counts
- Admins see "+ New project" (name, key prefix of 2–5 capitals, colour, optional logo)

### F2. Project header and toolbar

- Header: back arrow, star, project tile, project name, key (e.g. MAS)
- Toolbar: search, All Types, Group By (none / assignee / priority / type), All Assignees, Sort (Newest first, Oldest first, Due date, Priority), List / Board toggle, primary "+ New Task" button
- Filters and view choice persist per user per project (localStorage is fine for v1)

### F3. Stat cards

As a lead, I want totals at the top of the board so I see project health without counting cards.

- Six cards: Total, To Do, In Progress, Done, Overdue, Approval
- Each shows an icon, the count, and a % of total in the top-right (except Total)
- Overdue = due date before today and stage is not Done
- Approval = tasks flagged "Needs approval" and not yet approved
- Clicking a card filters the board to those tasks; clicking again clears it
- Counts respect the active search and filters

### F4. Kanban board

- Five default columns in order: Backlog, To Do, In Progress, In Review, Done (fits any project type; custom stages per project come in v2)
- Column header: drag-handle icon, name, count badge; the column with active work gets a 3 px accent underline
- Board scrolls horizontally; each column scrolls vertically
- Drag a card to another column to change its stage; optimistic update, rollback with a toast on failure
- Drag within a column to reorder (stored as a `position` number)
- "+ Add task" at the bottom of each column opens Create with that stage pre-set

### F5. Task card

- Top row: task key (MAS-6) in muted grey, priority pill on the right (LOW / MEDIUM / HIGH / URGENT)
- Title in medium weight, max 2 lines then ellipsis
- Assignee avatar(s), up to 3 then "+n"
- Approval pill: "No Need Approval" (mint), "Needs Approval" (amber), "Approved" (green)
- Due date chip: red if overdue, amber if due within 2 days
- Click opens the task detail drawer

### F6. Create and edit task

As a member, I want to create a task in one dialog and edit it later in a side drawer.

- Fields: title (required), description (rich text or markdown), stage, priority, type (Task / Milestone / Issue / Request), assignees, due date, approval flag, reference code (optional, e.g. MAS/GAP/01/0047)
- Key is auto-generated: project key + running number, never reused
- Keyboard: `C` opens Create, `Esc` closes, `Ctrl+Enter` saves
- Drawer shows created by / at, updated at, and the activity log

### F7. Mark done

- "Mark done" button in the drawer moves the task to Done and stamps `completed_at`
- Checkbox in List view does the same; unticking returns it to its previous stage
- Done cards show the title struck through in muted grey

### F8. List view

- Table: checkbox, key, title, stage pill, priority, assignee, due, updated
- Click a column header to sort; click a row to open the drawer
- Same filters as the board

### F9. Comments and activity

- Comment box in the drawer; comments show author avatar, name, relative time
- Activity log records: created, stage changed (from → to), assignee changed, due date changed, completed

### F10. Notifications

- Bell icon with red dot when unread
- Notify when: I am assigned, someone comments on my task, my task becomes overdue
- Clicking a notification opens the task and marks it read

### F11. Global search

- Top-bar search with `Ctrl+K` shortcut; searches task key and title across all projects in the workspace; results grouped by project

### F12. Dashboard

As a lead, I want one page that shows how every project is doing, so I spot what is late before anyone asks.

Two levels share the same widgets: a **workspace dashboard** at /\[workspace\]/dashboard (the landing page after login, "Dashboard" in the top nav) and a **project dashboard** as a third view tab next to Board and List.

| Widget | Shows | Click goes to |
| --- | --- | --- |
| KPI row | Active projects, open tasks, done this week, overdue, due in next 7 days | Filtered list view |
| Project health table | Per project: % done bar, open, overdue, next due date, health status | That project's board |
| Workload by person | Open tasks per assignee, stacked by priority (bar chart) | List filtered to that person |
| Completion trend | Tasks created vs completed per week, last 8 weeks (line chart) | None |
| Stage breakdown | Open tasks by stage across projects (stacked bar) | Board filtered to that stage |
| Overdue list | Top 10 overdue tasks, oldest first, with owner | Task drawer |
| My tasks | Tasks assigned to me, due soonest first | Task drawer |

**Health status rule:** On track = no overdue tasks; At risk = 1–2 overdue, or under 50% done with under 7 days to the project end date; Off track = 3+ overdue or overdue is 10%+ of open tasks.

- Filters at the top: date range (default last 8 weeks), project (workspace level only), assignee
- Numbers come from one Python function per widget (`backend/app/dashboard.py`), behind the same membership check as every other route
- Charts with Recharts, coloured with the stat tokens (Done green, Overdue red, In Progress blue)
- Projects get optional `start_date` and `end_date` columns for the health rule
- Loads in under 2 seconds for 10 projects and 1,000 tasks

## v2 features

Seven features come after v1, once a real team has used Gemma for at least two weeks. Build them in the order below: the cheapest and most-requested come first, and the two that change the core data model (custom stages, Gantt) come last.

| # | Feature | What it does | Effort | Data changes |
| --- | --- | --- | --- | --- |
| V1 | File attachments | Upload documents and photos to a task; preview images, download others | Low | `task_attachments` (task\_id, path, name, size, uploaded\_by); one storage folder per workspace |
| V2 | Project templates | Save a project as a template; start a new project from one ("Event plan", "Client onboarding") | Medium | `project_templates` (workspace\_id, name, tasks jsonb with title, stage, priority, due-day offset) |
| V3 | Recurring tasks | "Every Monday: weekly report" creates the task itself | Medium | `recurrence_rules` (task fields, rule, next\_run\_at); a scheduled job creates due tasks |
| V4 | Custom fields | Each project adds its own fields: budget, location, vendor, dropdowns | Medium | `custom_fields` (project\_id, name, type, options, position); `task_field_values` (task\_id, field\_id, value) |
| V5 | Time tracking | Estimated vs actual hours per task; feeds a dashboard widget | Medium | `tasks.estimate_hours`; `time_entries` (task\_id, user\_id, minutes, note, logged\_on) |
| V6 | Custom stages per project | Each project defines its own columns, names and colours | Medium | `project_stages` (project\_id, name, colour, position, is\_done); `tasks.stage` becomes `stage_id` |
| V7 | Timeline / Gantt with dependencies | Bars by start and due date; "B can't start until A is done" | High | `tasks.start_date`; `task_dependencies` (task\_id, depends\_on\_id) |

**Acceptance criteria**

- **Attachments:** max 10 MB per file; images show a thumbnail in the drawer; deleting a task deletes its files
- **Templates:** due dates are stored as days after the project start date, so a template works for any start date
- **Recurring tasks:** daily, weekly (pick weekdays) and monthly; the next task is created only after the current one is done or its due date passes, so open copies never pile up
- **Custom fields:** types are text, number, date, dropdown and checkbox; each field can be shown on cards, as a list column and as a filter
- **Time tracking:** log time from the drawer or with a start/stop timer; the dashboard gains an "Estimated vs actual hours by project" widget
- **Custom stages:** each project needs at least one stage marked `is_done`, which drives the Done stat card, mark-done and the dashboard; existing tasks migrate to stages named like the five defaults
- **Gantt:** drag a bar to change dates; a task with an unfinished blocker shows a "Blocked" badge, and moving it to In Progress asks for confirmation

Custom stages and Gantt touch the board, stat cards and dashboard at once. Give each its own branch, and re-run the v1 testing checklist before merging.

## UI layout and design system

Keep the reference screen's structure and status colours; replace every red accent (New Task button, selected project row, New Board pill) with one blue scale. Logo and product name are Gemma's own, never the reference company's.

**Screen layout (desktop, 1440 px and up)**

1. **Top nav, 64 px, dark charcoal:** Gemma logo + wordmark left; nav items (Dashboard, Tasks, Projects, Reports) with the active one on a blue block; global search (Ctrl+K) centre; workspace name, chat, bell, avatar right.
2. **Left sidebar, 280 px, white:** search + filter button, starred section, project list. Selected project row = light blue fill with the blue tile.
3. **Project header, 64 px:** back, star, tile, project name, key; view tabs; right-side icons.
4. **Toolbar row:** filter icon, search, three dropdowns, sort, List/Board toggle, primary "+ New Task".
5. **Stat strip:** six cards in one row, each with a 4 px coloured left border.
6. **Board:** horizontal-scrolling columns, 340 px wide, 16 px gaps, on a light grey canvas.

Below 1024 px the sidebar collapses to a drawer; below 768 px the board shows one column at a time with stage tabs.

**Colour tokens**

| Token | Hex | Used for |
| --- | --- | --- |
| `--nav-bg` | #1F2430 | Top nav background |
| `--primary-600` | #1D4ED8 | New Task button, active nav item, links, focus ring |
| `--primary-700` | #1E40AF | Primary button hover |
| `--primary-100` | #DBEAFE | Selected project row, priority pill background |
| `--primary-50` | #EFF6FF | Hover on rows and cards |
| `--canvas` | #F5F6F8 | Page background behind the board |
| `--column` | #EEF0F3 | Column background |
| `--surface` | #FFFFFF | Cards, sidebar, dropdowns |
| `--border` | #E3E6EB | Card borders, dividers |
| `--text` | #1A1F2B | Primary text |
| `--text-muted` | #6B7280 | Task keys, secondary labels |
| `--stat-total` | #1D4ED8 | Total card border and icon |
| `--stat-pending` | #B45309 | Pending card |
| `--stat-progress` | #2563EB | Progress card |
| `--stat-done` | #15803D | Done card, Approved pill |
| `--stat-overdue` | #DC2626 | Overdue card, overdue due chip |
| `--stat-approval` | #D97706 | Approval card, Needs Approval pill |
| `--pill-mint-bg` / `--pill-mint-text` | #DCF5EE / #0F766E | No Need Approval pill |
| `--accent-column` | #F59E0B | 3 px underline on the active column |

Red stays only for meaning (Overdue, errors, destructive actions), never as a brand colour.

**Type and shape**

- Font: Inter (or Roboto, as in the reference); 14 px body, 13 px labels, 12 px pills, 28 px stat numbers, 20 px project title
- Radius: 8 px cards and inputs, 999 px pills, 6 px buttons
- Card shadow: 0 1px 2px rgba(16,24,40,.06); hover adds a 1 px `--primary-100` border
- Icons: lucide-react (clipboard, hourglass, refresh, check-circle, alert-triangle, pencil-square for the six stats)
- Components: shadcn/ui (Button, Dialog, Sheet for the drawer, DropdownMenu, Select, Avatar, Badge, Toast)

## Data model

Eleven tables, defined as SQLAlchemy models in `backend/app/models.py` (the source of truth). SQLite locally; Postgres in production by changing `DATABASE_URL`. Every row that holds work carries `workspace_id`, so one check ("is the user a member of this workspace?") protects everything.

| Table | Key columns | Notes |
| --- | --- | --- |
| users | id, email, password_hash, full_name | Sign-in and profile in one table |
| workspaces | id, name, created\_by | The "Company" in the top bar |
| workspace\_members | workspace\_id, user\_id, role | role: owner / admin / member / viewer |
| invitations | workspace\_id, email, role, token, expires\_at, accepted\_at | Token goes in the invite link |
| projects | workspace\_id, name, key, color, logo\_url, status, task\_seq | key = MAS; task\_seq feeds task numbers |
| project\_stars | user\_id, project\_id | Per-user favourites |
| tasks | project_id, workspace_id, number, title, description, stage, prev_stage, priority, type, approval, reference_code, due_date, position, completed_at | Display key = project.key + "-" + number; prev_stage lets "untick done" restore the stage |
| task\_assignees | task\_id, user\_id | Many assignees per task |
| comments | task\_id, workspace\_id, author\_id, body |  |
| activity | task\_id, workspace\_id, actor\_id, action, from\_value, to\_value | Written by triggers, read-only for users |
| notifications | user\_id, task\_id, kind, read\_at |  |

Roles are ordered owner → admin → member → viewer: a lower position means more power, so a check for "member" passes for owners, admins and members. The first draft's Supabase SQL and RLS policies were removed with the stack change; they are in the Git history (commit f44e40c).

## Tech stack and architecture

A React single-page app talks to a FastAPI backend over a JSON API; the backend owns the database, sign-in and every permission check. Everything runs on one machine with SQLite, with no cloud account.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript | Fast dev server; no server-side rendering needed |
| Styling | Tailwind CSS + shadcn/ui | Tokens from the design section map straight to CSS variables |
| Drag and drop | @dnd-kit/core + sortable | Accessible, works with keyboard and touch |
| Data fetching | TanStack Query | Cache, optimistic card moves |
| Backend | FastAPI + SQLAlchemy (Python, run with uv) | Readable permission logic, easy to test |
| Auth | bcrypt password hashes + signed session cookie | No external service |
| Database | SQLite locally, Postgres in production | One `DATABASE_URL` setting |
| Live updates | Polling every 5 seconds | Move to websockets when a team feels the lag |
| Email | None yet; invite links are copied by hand | Add Resend when deploying |
| Hosting | Vercel (frontend) + Render or Railway (API) | Not set up yet |

**Folder structure**

```
backend/
  app/      main.py, auth.py, routes.py, dashboard.py, models.py, db.py, seed.py
  tests/    test_api.py
frontend/
  src/      main.tsx, lib/, components/, pages/
```


## Build plan

Phases 1 and 2 were built in one pass on Nov 15, 2026 on the Python stack, so the eleven Supabase-era prompts were removed. For later changes keep the same habits: one feature per prompt, commit after each, and re-run the backend tests (`uv run pytest`) and the checklist below.

Still to do before a real team uses it: Google sign-in, password reset, email confirmation and invite emails (each needs an external service), deployment, and websockets for live updates.


**Testing checklist before calling v1 done**

- [ ] Two accounts in different workspaces cannot see each other's projects (covered by `backend/tests/test_api.py`; also try it by calling the API directly)
- [ ] A Viewer cannot create, move or delete a task
- [ ] Task keys stay unique when two people create tasks at the same moment
- [ ] Overdue count matches the red due chips on the board
- [ ] Board works at 1440 px, 1024 px and on a phone

## Non-functional requirements, risks, open questions

**Requirements**

- Board with 300 tasks loads in under 2 seconds on a normal connection; a card move shows instantly (optimistic)
- Every API route checks workspace membership and role; passwords are stored only as bcrypt hashes
- WCAG AA contrast on all text; every drag action also possible by keyboard or the Stage dropdown
- All times stored in UTC, shown in the user's time zone (default Asia/Jakarta)
- UI copy in English for v1, strings kept in one file so Bahasa Indonesia can be added

**Risks**

| Risk | What goes wrong | Mitigation |
| --- | --- | --- |
| Permission gaps | A new route skips the membership check and leaks data between workspaces | Every workspace route goes through the same membership dependency; run the two-account test after every backend change |
| Look-alike of an employer's tool | Copying a company's internal product too closely, including its name or logo, can breach your contract or IP rules | Own name, own logo, blue palette; check before showing it publicly or on a CV |
| Scope creep | Chat, reports and AI features stall the MVP | Ship F1–F8 first; everything else waits for real usage |
| Vibe-code drift | Later prompts silently rewrite earlier working code | Commit to Git after each feature; one feature per prompt |

**Open questions**

- Is this for personal use, a portfolio piece, or a tool a real team will adopt?
- Which project types will you run first (events, operations, research), and do the five default stages fit them?
- What does "Approval" mean in your process: who approves, and does approval block moving to the next stage?
- Logo for Gemma, and is the name clear of Google's Gemma AI models for how you plan to use it?
