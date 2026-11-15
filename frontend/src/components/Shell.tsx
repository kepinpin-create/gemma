// App frame: dark top nav, project sidebar, global search, notifications, task drawer (PRD F1, F10, F11).
import { useEffect, useState } from "react"
import { Link, NavLink, Navigate, Outlet, useMatch, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom"
import { Archive, Bell, ChevronDown, Kanban, List, LogOut, Menu, MessageSquare, Plus, Search, Star, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { api, queryClient, useAct, useMe, useNotices, useProjects, useTasks } from "@/lib/api"
import type { Me, Project, Role } from "@/lib/api"
import { t } from "@/lib/strings"
import { ago } from "@/lib/util"
import { cn } from "@/lib/utils"
import { Empty, Face, Field, Logo, Tile } from "./bits"
import { TaskDrawer } from "./task"

export interface Ws { ws: number; role: Role; me: Me; canEdit: boolean; isAdmin: boolean }
export const useWs = () => useOutletContext<Ws>()

export default function Shell() {
  const ws = Number(useParams().ws)
  const { data: me } = useMe()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSearch(true) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (!me) return null
  const ref = me.workspaces.find((w) => w.id === ws)
  if (!ref) return <Navigate to={me.workspaces[0] ? `/${me.workspaces[0].id}/dashboard` : "/welcome"} replace />
  const ctx: Ws = { ws, role: ref.role, me, canEdit: ref.role !== "viewer", isAdmin: ref.role === "owner" || ref.role === "admin" }
  const closeTask = () => { params.delete("task"); setParams(params, { replace: true }) }

  return (
    <div className="flex h-full flex-col">
      <TopNav ctx={ctx} name={ref.name} onMenu={() => setMenu(true)} onSearch={() => setSearch(true)} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[280px] shrink-0 border-r bg-background lg:block"><Sidebar ctx={ctx} /></aside>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" className="w-[280px] gap-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">{t.sidebar.projects}</SheetTitle>
            <SheetDescription className="sr-only">{t.nav.menu}</SheetDescription>
            <nav className="flex gap-1 border-b p-2 md:hidden">
              <NavItems ws={ws} onPick={() => setMenu(false)} className="text-foreground" />
            </nav>
            <Sidebar ctx={ctx} onPick={() => setMenu(false)} />
          </SheetContent>
        </Sheet>
        <main className="flex min-w-0 flex-1 flex-col overflow-auto"><Outlet context={ctx} /></main>
      </div>
      <SearchDialog ws={ws} open={search} onClose={() => setSearch(false)} />
      <TaskDrawer ctx={ctx} taskId={Number(params.get("task")) || null} onClose={closeTask} />
    </div>
  )
}

function NavItems({ ws, onPick, className }: { ws: number; onPick?: () => void; className?: string }) {
  return (
    <>
      {(["dashboard", "tasks", "projects"] as const).map((k) => (
        <NavLink key={k} to={`/${ws}/${k}`} onClick={onPick}
          className={({ isActive }) => cn("rounded-md px-3 py-1.5 font-medium", className, isActive && "bg-primary text-white")}>
          {t.nav[k]}
        </NavLink>
      ))}
      <span aria-disabled="true" title={t.nav.later} className={cn("cursor-not-allowed rounded-md px-3 py-1.5 font-medium opacity-50", className)}>{t.nav.reports}</span>
    </>
  )
}

const iconBtn = "grid size-9 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"

function TopNav({ ctx, name, onMenu, onSearch }: { ctx: Ws; name: string; onMenu: () => void; onSearch: () => void }) {
  const nav = useNavigate()
  const { data: notices = [] } = useNotices()
  const read = useAct((id: number) => api(`/notifications/${id}/read`, "POST"), ["notices"])
  const logout = async () => {
    await api("/auth/logout", "POST").catch(() => null)
    queryClient.clear()
    queryClient.setQueryData(["me"], null)
    nav("/login")
  }
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 bg-nav px-3 text-white md:px-4">
      <button className={cn(iconBtn, "lg:hidden")} aria-label={t.nav.menu} onClick={onMenu}><Menu className="size-5" /></button>
      <Link to={`/${ctx.ws}/dashboard`} className="mr-2 flex items-center gap-2 text-lg font-semibold">
        <Logo className="size-8" /><span className="hidden sm:inline">{t.app}</span>
      </Link>
      <nav className="hidden items-center gap-1 md:flex"><NavItems ws={ctx.ws} className="text-white/80" /></nav>

      <button onClick={onSearch} className="mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-md bg-white/10 px-3 text-white/70 hover:bg-white/15">
        <Search className="size-4 shrink-0" /><span className="truncate">{t.search.button}</span>
        <kbd className="ml-auto hidden rounded bg-white/10 px-1.5 text-xs sm:block">{t.search.shortcut}</kbd>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="hidden h-9 max-w-44 items-center gap-1 rounded-md px-2 font-medium text-white/90 hover:bg-white/10 sm:flex" aria-label={t.account.switchWorkspace}>
          <span className="truncate">{name}</span><ChevronDown className="size-4 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {ctx.me.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => nav(`/${w.id}/dashboard`)} className={cn(w.id === ctx.ws && "font-semibold")}>{w.name}</DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => nav("/welcome")}><Plus />{t.account.newWorkspace}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className={cn(iconBtn, "hidden cursor-not-allowed opacity-40 sm:grid")} aria-disabled="true" title={`${t.nav.chat}: ${t.nav.later}`}><MessageSquare className="size-5" /></span>

      <DropdownMenu>
        <DropdownMenuTrigger className={cn(iconBtn, "relative")} aria-label={t.bell.title}>
          <Bell className="size-5" />
          {notices.some((n) => !n.read) && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-stat-overdue ring-2 ring-nav" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
          <p className="px-2 py-1.5 font-semibold">{t.bell.title}</p>
          {notices.length === 0 && <Empty>{t.bell.empty}</Empty>}
          {notices.map((n) => (
            <DropdownMenuItem key={n.id} className="items-start"
              onClick={() => { if (!n.read) read.mutate(n.id); nav(`/${n.task.workspace_id}/projects/${n.task.project_key}/board?task=${n.task.id}`) }}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0">
                <span className="block text-[13px] text-muted-foreground">{t.bell.kind[n.kind] ?? n.kind} · {ago(n.created_at)}</span>
                <span className="block truncate"><span className="text-muted-foreground">{n.task.key}</span> {n.task.title}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className="rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none" aria-label={ctx.me.user.full_name}>
          <Face name={ctx.me.user.full_name} size="default" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <div className="px-2 py-1.5">
            <p className="font-semibold">{ctx.me.user.full_name}</p>
            <p className="text-[13px] text-muted-foreground">{ctx.me.user.email} · {t.role[ctx.role]}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => nav(`/${ctx.ws}/people`)}><Users />{t.account.people}</DropdownMenuItem>
          <DropdownMenuItem onClick={logout}><LogOut />{t.account.logout}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

function Sidebar({ ctx, onPick }: { ctx: Ws; onPick?: () => void }) {
  const { data: projects = [] } = useProjects(ctx.ws)
  const { data: tasks = [] } = useTasks(ctx.ws)
  const current = useMatch("/:ws/projects/:key/*")?.params.key
  const [q, setQ] = useState("")
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const star = useAct((p: Project) => api(`/projects/${p.id}/star`, "PUT", { starred: !p.starred }), ["projects"])

  const shown = projects.filter((p) => p.archived === archived && p.name.toLowerCase().includes(q.trim().toLowerCase()))
  const row = (p: Project) => {
    const on = p.key === current
    const count = tasks.filter((x) => x.project_id === p.id).length
    return (
      <li key={p.id}>
        <div className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", on ? "bg-primary-100" : "hover:bg-primary-50")}>
          <Link to={`/${ctx.ws}/projects/${p.key}`} onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2" aria-current={on ? "page" : undefined}>
            <Tile project={p} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{t.status[p.status]}</span>
            </span>
          </Link>
          <button onClick={() => star.mutate(p)} aria-label={p.starred ? t.sidebar.unstar : t.sidebar.star} aria-pressed={p.starred}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-background">
            <Star className={cn("size-4", p.starred && "fill-accent-column text-accent-column")} />
          </button>
        </div>
        {on && (
          <ul className="my-1 ml-6 grid gap-0.5 border-l pl-3 text-[13px]">
            {([["board", Kanban], ["list", List]] as const).map(([view, Icon]) => (
              <li key={view}>
                <NavLink to={`/${ctx.ws}/projects/${p.key}/${view}`} onClick={onPick}
                  className={({ isActive }) => cn("flex items-center gap-2 rounded-md px-2 py-1 hover:bg-primary-50", isActive && "font-semibold text-primary")}>
                  <Icon className="size-4" />{t.view[view]}<span className="ml-auto text-muted-foreground">{count}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }
  const starred = shown.filter((p) => p.starred), rest = shown.filter((p) => !p.starred)
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.sidebar.search} aria-label={t.sidebar.search} className="pl-8" />
        </div>
        <Button variant={archived ? "default" : "outline"} size="icon" aria-pressed={archived} aria-label={t.sidebar.showArchived} title={t.sidebar.showArchived} onClick={() => setArchived(!archived)}>
          <Archive />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {starred.length > 0 && <>
          <h2 className="px-2 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.sidebar.starred}</h2>
          <ul className="grid gap-0.5">{starred.map(row)}</ul>
        </>}
        <h2 className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{archived ? t.sidebar.archived : t.sidebar.projects}</h2>
        <ul className="grid gap-0.5">{rest.map(row)}</ul>
        {shown.length === 0 && <Empty>{t.sidebar.empty}</Empty>}
      </div>
      {ctx.isAdmin && (
        <div className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={() => setCreating(true)}><Plus />{t.sidebar.newProject}</Button>
          <NewProject ws={ctx.ws} open={creating} onClose={() => setCreating(false)} onPick={onPick} />
        </div>
      )}
    </div>
  )
}

function NewProject({ ws, open, onClose, onPick }: { ws: number; open: boolean; onClose: () => void; onPick?: () => void }) {
  const nav = useNavigate()
  const create = useAct((body: Record<string, unknown>) => api<Project>(`/workspaces/${ws}/projects`, "POST", body), ["projects"])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          create.mutate({ name: f.name.trim(), key: f.key.toUpperCase(), color: f.color, start_date: f.start_date || null, end_date: f.end_date || null },
            { onSuccess: (p) => { onClose(); onPick?.(); nav(`/${ws}/projects/${p.key}`) } })
        }}>
          <DialogHeader><DialogTitle>{t.sidebar.newProject}</DialogTitle></DialogHeader>
          <Field label={t.project.name}><Input name="name" required maxLength={80} autoFocus /></Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label={t.project.key}><Input name="key" required pattern="[A-Za-z]{2,5}" maxLength={5} className="uppercase" aria-describedby="key-hint" /></Field>
            <Field label={t.project.color}><Input name="color" type="color" defaultValue="#1D4ED8" className="w-16 p-1" /></Field>
          </div>
          <p id="key-hint" className="-mt-2 text-xs text-muted-foreground">{t.project.keyHint}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.project.start}><Input name="start_date" type="date" /></Field>
            <Field label={t.project.end}><Input name="end_date" type="date" /></Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t.task.cancel}</Button>
            <Button type="submit" disabled={create.isPending}>{t.project.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Ctrl+K: searches task key and title across every project in the workspace, grouped by project (PRD F11). */
function SearchDialog({ ws, open, onClose }: { ws: number; open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const { data: tasks = [] } = useTasks(ws)
  const { data: projects = [] } = useProjects(ws)
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const hits = needle ? tasks.filter((x) => x.key.toLowerCase().includes(needle) || x.title.toLowerCase().includes(needle)).slice(0, 50) : []
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setQ("") } }}>
      <DialogContent className="top-24 translate-y-0 gap-3 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only"><DialogTitle>{t.search.button}</DialogTitle></DialogHeader>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search.placeholder} aria-label={t.search.button} />
        <div className="max-h-[50vh] overflow-y-auto">
          {!needle && <Empty>{t.search.hint}</Empty>}
          {needle && hits.length === 0 && <Empty>{t.search.empty}</Empty>}
          {projects.filter((p) => hits.some((x) => x.project_id === p.id)).map((p) => (
            <section key={p.id} className="mb-2">
              <h3 className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">{p.name}</h3>
              {hits.filter((x) => x.project_id === p.id).map((x) => (
                <button key={x.id} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none"
                  onClick={() => { onClose(); setQ(""); nav(`/${ws}/projects/${p.key}/board?task=${x.id}`) }}>
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{x.key}</span>
                  <span className={cn("truncate", x.stage === "done" && "text-muted-foreground line-through")}>{x.title}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
