// Workspace-wide task list. The dashboard's numbers and bars link here with a filter in the URL.
import { useSearchParams } from "react-router-dom"
import { X } from "lucide-react"
import { useWs } from "@/components/Shell"
import { Button } from "@/components/ui/button"
import { TaskTable } from "@/components/views"
import { useMembers, usePatchTask, useProjects, useTasks, type Task } from "@/lib/api"
import { t } from "@/lib/strings"
import { addDays, isOverdue, sortTasks, today, ymd } from "@/lib/util"

export default function TasksPage() {
  const ctx = useWs()
  const [params, setParams] = useSearchParams()
  const { data: tasks = [] } = useTasks(ctx.ws)
  const { data: projects = [] } = useProjects(ctx.ws)
  const { data: members = [] } = useMembers(ctx.ws)
  const patch = usePatchTask(ctx.ws)

  const now = today()
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekStart = ymd(monday)
  const TESTS: Record<string, (x: Task) => boolean> = {
    all: () => true,
    open: (x) => x.stage !== "done",
    overdue: (x) => isOverdue(x, now),
    due7: (x) => x.stage !== "done" && !!x.due_date && x.due_date >= now && x.due_date <= addDays(now, 7),
    doneWeek: (x) => x.stage === "done" && !!x.completed_at && ymd(new Date(x.completed_at)) >= weekStart,
    mine: (x) => x.assignees.some((a) => a.id === ctx.me.user.id),
  }
  const f = params.get("f") && TESTS[params.get("f")!] ? params.get("f")! : "all"
  const assignee = params.get("assignee")
  const project = projects.find((p) => String(p.id) === params.get("project"))
  const live = new Set(projects.filter((p) => !p.archived).map((p) => p.id))
  const rows = sortTasks(tasks.filter((x) =>
    live.has(x.project_id) && TESTS[f](x) && (!project || x.project_id === project.id) &&
    (!assignee || (assignee === "none" ? x.assignees.length === 0 : x.assignees.some((a) => String(a.id) === assignee)))), "due")
  const drop = (k: string) => { params.delete(k); setParams(params) }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h1 className="mr-2 text-xl font-semibold">{t.tasksPage.title}</h1>
        {Object.keys(TESTS).map((k) => (
          <Button key={k} variant={f === k ? "default" : "outline"} aria-pressed={f === k} onClick={() => { params.set("f", k); setParams(params) }}>
            {t.tasksPage[k as keyof typeof t.tasksPage]}
          </Button>
        ))}
        {assignee && (
          <Button variant="secondary" onClick={() => drop("assignee")}>
            {t.tasksPage.person} {assignee === "none" ? t.toolbar.unassigned.toLowerCase() : members.find((m) => String(m.id) === assignee)?.full_name}<X />
          </Button>
        )}
        {project && <Button variant="secondary" onClick={() => drop("project")}>{project.name}<X /></Button>}
        <span className="ml-auto text-muted-foreground">{rows.length}</span>
      </div>
      <TaskTable tasks={rows} canEdit={ctx.canEdit} onDone={(id, done) => patch({ id, done })}
        onOpen={(id) => { params.set("task", String(id)); setParams(params) }} />
    </div>
  )
}
