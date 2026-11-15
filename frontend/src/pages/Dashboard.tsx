// Dashboard (PRD F12): the same widgets for the whole workspace and for one project.
import { useState, type ReactNode } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Choose, Empty, Pill, Tile } from "@/components/bits"
import { useWs, type Ws } from "@/components/Shell"
import { Input } from "@/components/ui/input"
import { PRIORITIES, STAGES, useDashboard, useMembers, useProjects, type Brief, type HealthRow } from "@/lib/api"
import { t } from "@/lib/strings"
import { fmtDate, today } from "@/lib/util"
import { cn } from "@/lib/utils"

const PRIORITY_FILL = { low: "#94a3b8", medium: "var(--stat-progress)", high: "var(--stat-approval)", urgent: "var(--stat-overdue)" }
const STAGE_FILL: Record<string, string> = { backlog: "#94a3b8", todo: "var(--stat-pending)", in_progress: "var(--stat-progress)", in_review: "#7c3aed" }
const HEALTH_STYLE = { on_track: "bg-green-100 text-stat-done", at_risk: "bg-amber-100 text-amber-800", off_track: "bg-red-100 text-stat-overdue" }
const KPI_LINK: Record<string, string> = { open_tasks: "tasks?f=open", done_this_week: "tasks?f=doneWeek", overdue: "tasks?f=overdue", due_next_7: "tasks?f=due7", active_projects: "projects" }
const KPI_TONE: Record<string, string> = { done_this_week: "text-stat-done", overdue: "text-stat-overdue", due_next_7: "text-stat-approval" }

export const DashboardPage = () => <DashboardView ctx={useWs()} />

export function ProjectsPage() {
  const ctx = useWs()
  const { data } = useDashboard(ctx.ws, {})
  return (
    <div className="grid gap-4 p-4">
      <h1 className="text-xl font-semibold">{t.nav.projects}</h1>
      <Card title={t.dash.health}><HealthTable ws={ctx.ws} rows={data?.project_health ?? []} /></Card>
    </div>
  )
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card shadow-card", className)}>
      <h2 className="border-b px-4 py-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function HealthTable({ ws, rows }: { ws: number; rows: HealthRow[] }) {
  const nav = useNavigate()
  if (!rows.length) return <Empty>{t.sidebar.empty}</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead className="text-[13px] text-muted-foreground">
          <tr>{[t.dash.project, t.dash.progress, t.dash.open, t.dash.overdue, t.dash.nextDue, t.dash.status].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.project_id} tabIndex={0} className="cursor-pointer border-t hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none"
              onClick={() => nav(`/${ws}/projects/${r.key}/board`)} onKeyDown={(e) => e.key === "Enter" && nav(`/${ws}/projects/${r.key}/board`)}>
              <td className="px-4 py-2"><span className="flex items-center gap-2"><Tile project={r} className="size-7 text-xs" /><span className="font-medium">{r.name}</span></span></td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-28 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={r.pct_done} aria-valuemin={0} aria-valuemax={100}>
                    <span className="block h-full bg-stat-done" style={{ width: `${r.pct_done}%` }} />
                  </span>
                  {r.pct_done}%
                </span>
              </td>
              <td className="px-4 py-2">{r.open}</td>
              <td className={cn("px-4 py-2", r.overdue > 0 && "font-semibold text-stat-overdue")}>{r.overdue}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.next_due ? fmtDate(r.next_due) : "–"}</td>
              <td className="px-4 py-2"><Pill className={HEALTH_STYLE[r.health]}>{t.dash.healthLabel[r.health]}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BriefList({ rows, onOpen }: { rows: Brief[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty>{t.dash.nothing}</Empty>
  const now = today()
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id} className="border-t first:border-0">
          <button className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none" onClick={() => onOpen(r.id)}>
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{r.key}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.owners.join(", ") || t.toolbar.unassigned}</span>
            </span>
            <span className={cn("text-[13px] whitespace-nowrap", r.due_date && r.due_date < now ? "font-semibold text-stat-overdue" : "text-muted-foreground")}>
              {r.due_date ? fmtDate(r.due_date) : t.dash.noDate}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function DashboardView({ ctx, projectId }: { ctx: Ws; projectId?: number }) {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState({ from: "", to: "", project: "all", assignee: "all" })
  const { data: projects = [] } = useProjects(ctx.ws)
  const { data: members = [] } = useMembers(ctx.ws)

  const pid = projectId ?? (f.project === "all" ? undefined : Number(f.project))
  const query: Record<string, string> = {}
  if (f.from) query.from = f.from
  if (f.to) query.to = f.to
  if (pid) query.project_id = String(pid)
  if (f.assignee !== "all") query.assignee_id = f.assignee
  const { data, isError } = useDashboard(ctx.ws, query)

  const open = (id: number) => { params.set("task", String(id)); setParams(params) }
  const scope = pid ? `&project=${pid}` : ""
  const chart = "h-64 px-2 py-3"
  // Recharts hands the clicked bar's row back loosely typed.
  const rowOf = (d: unknown) => ((d as { payload?: Record<string, unknown> })?.payload ?? d) as Record<string, unknown>

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {!projectId && <h1 className="mr-auto text-xl font-semibold">{t.dash.title}</h1>}
        <label className="grid gap-1 text-xs text-muted-foreground">{t.dash.from}
          <Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ ...f, from: e.target.value })} className="bg-background" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">{t.dash.to}
          <Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} className="bg-background" />
        </label>
        {!projectId && <Choose label={t.dash.project} value={f.project} onChange={(project) => setF({ ...f, project })}
          items={[{ value: "all", label: t.dash.allProjects }, ...projects.filter((p) => !p.archived).map((p) => ({ value: String(p.id), label: p.name }))]} />}
        <Choose label={t.task.assignees} value={f.assignee} onChange={(assignee) => setF({ ...f, assignee })}
          items={[{ value: "all", label: t.dash.allPeople }, ...members.map((m) => ({ value: String(m.id), label: m.full_name }))]} />
      </div>

      {isError && <Empty>{t.error.generic}</Empty>}
      {data && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Object.entries(data.kpis).map(([k, v]) => (
            <button key={k} onClick={() => nav(`/${ctx.ws}/${KPI_LINK[k]}${k === "active_projects" ? "" : scope}`)} className="rounded-lg border bg-card p-3 text-left shadow-card hover:bg-primary-50">
              <span className="block text-[13px] text-muted-foreground">{t.dash.kpi[k] ?? k}</span>
              <span className={cn("block text-[28px] leading-9 font-semibold", v > 0 && KPI_TONE[k])}>{v}</span>
            </button>
          ))}
        </div>

        <Card title={t.dash.health}><HealthTable ws={ctx.ws} rows={data.project_health} /></Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={t.dash.workload}>
            {data.workload.length === 0 ? <Empty>{t.dash.nothing}</Empty> : (
              <div className={chart}>
                <ResponsiveContainer>
                  <BarChart data={data.workload}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" tickLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} />
                    <Tooltip cursor={{ fill: "var(--primary-50)" }} />
                    <Legend />
                    {PRIORITIES.map((p) => (
                      <Bar key={p} dataKey={p} name={t.priority[p]} stackId="p" fill={PRIORITY_FILL[p]} className="cursor-pointer"
                        onClick={(d) => nav(`/${ctx.ws}/tasks?f=open&assignee=${rowOf(d).user_id ?? "none"}${scope}`)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card title={t.dash.trend}>
            <div className={chart}>
              <ResponsiveContainer>
                <LineChart data={data.trend.map((w) => ({ ...w, week: fmtDate(w.week) }))}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="week" tickLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} />
                  <Tooltip />
                  <Legend />
                  <Line dataKey="created" name={t.dash.created} stroke="var(--stat-progress)" strokeWidth={2} />
                  <Line dataKey="completed" name={t.dash.completed} stroke="var(--stat-done)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={t.dash.stages}>
            <div className={chart}>
              <ResponsiveContainer>
                <BarChart data={data.stages}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="key" tickLine={false} fontSize={12} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} />
                  <Tooltip cursor={{ fill: "var(--primary-50)" }} />
                  <Legend />
                  {STAGES.slice(0, -1).map((s) => (
                    <Bar key={s} dataKey={s} name={t.stage[s]} stackId="s" fill={STAGE_FILL[s]} className="cursor-pointer"
                      onClick={(d) => nav(`/${ctx.ws}/projects/${rowOf(d).key}/board?stage=${s}`)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={t.dash.overdueList}><BriefList rows={data.overdue} onOpen={open} /></Card>
          <Card title={t.dash.myTasks} className="xl:col-span-2"><BriefList rows={data.my_tasks} onOpen={open} /></Card>
        </div>
      </>}
    </div>
  )
}
