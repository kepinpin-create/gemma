// One project: header, toolbar, stat cards, then Board / List / Dashboard (PRD F2-F8).
import { useEffect, useState } from "react"
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, ChartColumn, Filter, Kanban, List, Plus, Search, Settings, Star, X } from "lucide-react"
import { Board } from "@/components/Board"
import { Choose, Empty, Tile, options } from "@/components/bits"
import { useWs } from "@/components/Shell"
import { TaskDialog } from "@/components/task"
import { Button, buttonVariants } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { StatCards, TaskTable } from "@/components/views"
import { STAGES, TYPES, api, useAct, useMembers, usePatchTask, useProjects, useTasks, type Stage } from "@/lib/api"
import { t } from "@/lib/strings"
import { NO_FILTERS, filterTasks, inStat, sortTasks, useStored, type Filters, type Sort } from "@/lib/util"
import { cn } from "@/lib/utils"
import { DashboardView } from "./Dashboard"

const VIEWS = ["board", "list", "dashboard"] as const
const TAB_ICON = { board: Kanban, list: List, dashboard: ChartColumn }

export default function ProjectPage() {
  const ctx = useWs()
  const { key = "", view } = useParams()
  const [params, setParams] = useSearchParams()
  const { data: projects, isLoading } = useProjects(ctx.ws)
  const { data: tasks = [] } = useTasks(ctx.ws)
  const { data: members = [] } = useMembers(ctx.ws)
  const store = `${ctx.me.user.id}:${ctx.ws}:${key}`
  const [filters, setFilters] = useStored<Filters>(`gemma:filters:${store}`, NO_FILTERS)
  const [creating, setCreating] = useState<Stage | null>(null)
  const patch = usePatchTask(ctx.ws)
  const project = projects?.find((p) => p.key === key)
  const star = useAct((starred: boolean) => api(`/projects/${project?.id}/star`, "PUT", { starred }), ["projects"])
  const update = useAct((body: Record<string, unknown>) => api(`/projects/${project?.id}`, "PATCH", body), ["projects", "dashboard"])

  useEffect(() => { // remember the last view per project
    if (view) try { localStorage.setItem(`gemma:view:${store}`, view) } catch { /* private mode */ }
  }, [view, store])

  useEffect(() => { // "C" opens Create, unless the user is typing or a dialog is open
    if (!ctx.canEdit) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key.toLowerCase() !== "c" || e.ctrlKey || e.metaKey || e.altKey) return
      if (el.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return
      e.preventDefault()
      setCreating("todo")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ctx.canEdit])

  if (!VIEWS.includes(view as never)) {
    let last: string | null = null
    try { last = localStorage.getItem(`gemma:view:${store}`) } catch { /* private mode */ }
    return <Navigate to={`/${ctx.ws}/projects/${key}/${VIEWS.includes(last as never) ? last : "board"}`} replace />
  }
  if (isLoading) return <Empty>{t.loading}</Empty>
  if (!project) return <Empty>{t.project.notFound}</Empty>

  const stage = STAGES.find((s) => s === params.get("stage"))
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch })
  const filtered = filterTasks(tasks.filter((x) => x.project_id === project.id), filters).filter((x) => !stage || x.stage === stage)
  const visible = sortTasks(filters.stat ? filtered.filter((x) => inStat(x, filters.stat!)) : filtered, filters.sort)
  const open = (id: number) => { params.set("task", String(id)); setParams(params) }
  const clearStage = () => { params.delete("stage"); setParams(params, { replace: true }) }
  const base = `/${ctx.ws}/projects/${project.key}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <Link to={`/${ctx.ws}/dashboard`} aria-label={t.project.back} className={buttonVariants({ variant: "ghost", size: "icon" })}><ArrowLeft /></Link>
        <Button variant="ghost" size="icon" aria-pressed={project.starred} aria-label={project.starred ? t.sidebar.unstar : t.sidebar.star} onClick={() => star.mutate(!project.starred)}>
          <Star className={cn(project.starred && "fill-accent-column text-accent-column")} />
        </Button>
        <Tile project={project} />
        <h1 className="truncate text-xl font-semibold">{project.name}</h1>
        <span className="text-muted-foreground">{project.key}</span>
        {project.status !== "open" && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t.status[project.status]}</span>}
        <nav className="ml-auto flex gap-1">
          {VIEWS.map((v) => {
            const Icon = TAB_ICON[v]
            return (
              <NavLink key={v} to={`${base}/${v}`} className={({ isActive }) => cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium", isActive ? "bg-primary-100 text-primary-700" : "text-muted-foreground hover:bg-primary-50")}>
                <Icon className="size-4" />{t.view[v]}
              </NavLink>
            )
          })}
        </nav>
        {ctx.isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t.project.settings} />}><Settings /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {(["open", "closed", "cancelled"] as const).map((s) => (
                <DropdownMenuItem key={s} onClick={() => update.mutate({ status: s })} className={cn(project.status === s && "font-semibold")}>
                  {t.project.setStatus}: {t.status[s]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => update.mutate({ archived: !project.archived })}>{project.archived ? t.project.unarchive : t.project.archive}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {view === "dashboard" ? <DashboardView ctx={ctx} projectId={project.id} /> : <>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
          <Filter className="size-4 text-muted-foreground" aria-label={t.toolbar.filters} />
          <div className="relative">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder={t.toolbar.search} aria-label={t.toolbar.search} className="w-52 pl-8" />
          </div>
          <Choose label={t.task.type} value={filters.type} onChange={(type) => set({ type })} items={[{ value: "all", label: t.toolbar.allTypes }, ...options(t.type, TYPES)]} />
          <Choose label={t.toolbar.group.none} value={filters.group} onChange={(group) => set({ group })} items={options(t.toolbar.group)} />
          <Choose label={t.task.assignees} value={filters.assignee} onChange={(assignee) => set({ assignee })}
            items={[{ value: "all", label: t.toolbar.allAssignees }, { value: "none", label: t.toolbar.unassigned }, ...members.map((m) => ({ value: String(m.id), label: m.full_name }))]} />
          <Choose label={t.toolbar.sort.manual} value={filters.sort} onChange={(sort) => set({ sort: sort as Sort })} items={options(t.toolbar.sort)} />
          {stage && <Button variant="secondary" onClick={clearStage}>{t.toolbar.stageFilter} {t.stage[stage]}<X /></Button>}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              {(["list", "board"] as const).map((v) => {
                const Icon = TAB_ICON[v]
                return (
                  <Link key={v} to={`${base}/${v}`} aria-label={t.view[v]} aria-current={view === v ? "page" : undefined}
                    className={cn("grid size-7 place-items-center rounded", view === v ? "bg-primary-100 text-primary-700" : "text-muted-foreground")}><Icon className="size-4" /></Link>
                )
              })}
            </div>
            {ctx.canEdit && <Button onClick={() => setCreating("todo")}><Plus />{t.toolbar.newTask}</Button>}
          </div>
        </div>
        <StatCards tasks={filtered} active={filters.stat} onPick={(stat) => set({ stat })} />
        {view === "board"
          ? <div className="flex min-h-[420px] flex-1 flex-col">
              <Board key={stage ?? "all"} tasks={visible} canEdit={ctx.canEdit} onOpen={open} onAdd={setCreating} initialStage={stage}
                onMove={(id, stage, position) => patch({ id, stage, position })} />
            </div>
          : <TaskTable tasks={visible} group={filters.group} canEdit={ctx.canEdit} onOpen={open} onDone={(id, done) => patch({ id, done })} />}
      </>}
      {ctx.canEdit && <TaskDialog ctx={ctx} project={project} stage={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}
