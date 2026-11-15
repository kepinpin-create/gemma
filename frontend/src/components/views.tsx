// Stat cards (PRD F3) and the list table (PRD F8).
import { useState } from "react"
import { CircleCheck, ClipboardList, Hourglass, RefreshCw, SquarePen, TriangleAlert, type LucideIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import type { Task } from "@/lib/api"
import { t } from "@/lib/strings"
import { STAT_KEYS, ago, inStat, type StatKey } from "@/lib/util"
import { cn } from "@/lib/utils"
import { DueChip, Empty, Faces, PriorityPill, StagePill } from "./bits"

const STAT_LOOK: Record<StatKey, { icon: LucideIcon; border: string; text: string }> = {
  total: { icon: ClipboardList, border: "border-l-stat-total", text: "text-stat-total" },
  todo: { icon: Hourglass, border: "border-l-stat-pending", text: "text-stat-pending" },
  in_progress: { icon: RefreshCw, border: "border-l-stat-progress", text: "text-stat-progress" },
  done: { icon: CircleCheck, border: "border-l-stat-done", text: "text-stat-done" },
  overdue: { icon: TriangleAlert, border: "border-l-stat-overdue", text: "text-stat-overdue" },
  approval: { icon: SquarePen, border: "border-l-stat-approval", text: "text-stat-approval" },
}

/** `tasks` is the list after search and filters, so the counts follow them. Click a card to filter, again to clear. */
export function StatCards({ tasks, active, onPick }: { tasks: Task[]; active: StatKey | null; onPick: (k: StatKey | null) => void }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 px-4 pt-4 sm:grid-cols-3 xl:grid-cols-6">
      {STAT_KEYS.map((k) => {
        const { icon: Icon, border, text } = STAT_LOOK[k]
        const count = tasks.filter((x) => inStat(x, k)).length
        return (
          <button key={k} aria-pressed={active === k} onClick={() => onPick(active === k ? null : k)}
            className={cn("rounded-lg border border-l-4 bg-card p-3 text-left shadow-card hover:bg-primary-50", border, active === k && "ring-2 ring-ring")}>
            <span className="flex items-center justify-between text-[13px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Icon className={cn("size-4", text)} />{t.stats[k]}</span>
              {k !== "total" && <span>{tasks.length ? Math.round((100 * count) / tasks.length) : 0}%</span>}
            </span>
            <span className="mt-1 block text-[28px] leading-8 font-semibold">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

type Col = "key" | "title" | "stage" | "priority" | "assignee" | "due" | "updated"
const COLS: Col[] = ["key", "title", "stage", "priority", "assignee", "due", "updated"]
const STAGE_RANK = { backlog: 0, todo: 1, in_progress: 2, in_review: 3, done: 4 }
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
const VALUE: Record<Col, (x: Task) => string | number> = {
  key: (x) => x.key.replace(/\d+$/, "") + String(x.number).padStart(6, "0"),
  title: (x) => x.title.toLowerCase(),
  stage: (x) => STAGE_RANK[x.stage],
  priority: (x) => PRIORITY_RANK[x.priority],
  assignee: (x) => x.assignees[0]?.full_name.toLowerCase() ?? "~",
  due: (x) => x.due_date ?? "9999",
  updated: (x) => x.updated_at,
}
const GROUP: Record<string, (x: Task) => string> = {
  assignee: (x) => x.assignees.map((a) => a.full_name).join(", ") || t.toolbar.unassigned,
  priority: (x) => t.priority[x.priority],
  type: (x) => t.type[x.type],
}

export function TaskTable({ tasks, group = "none", canEdit, onOpen, onDone }: {
  tasks: Task[]; group?: string; canEdit: boolean; onOpen: (id: number) => void; onDone: (id: number, done: boolean) => void
}) {
  const [sort, setSort] = useState<{ col: Col; asc: boolean } | null>(null)
  if (!tasks.length) return <Empty>{t.list.empty}</Empty>
  const rows = sort
    ? [...tasks].sort((a, b) => { const x = VALUE[sort.col](a), y = VALUE[sort.col](b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1) })
    : tasks
  const groups = new Map<string, Task[]>()
  for (const x of rows) {
    const g = GROUP[group]?.(x) ?? ""
    groups.set(g, [...(groups.get(g) ?? []), x])
  }
  return (
    <div className="m-4 overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[820px] text-left">
        <thead className="border-b text-[13px] text-muted-foreground">
          <tr>
            <th className="w-10 p-3"><span className="sr-only">{t.list.done}</span></th>
            {COLS.map((c) => (
              <th key={c} className="p-0 font-medium" aria-sort={sort?.col === c ? (sort.asc ? "ascending" : "descending") : undefined}>
                <button className="w-full px-3 py-3 text-left hover:text-foreground" onClick={() => setSort({ col: c, asc: sort?.col === c ? !sort.asc : true })}>
                  {t.list[c]}{sort?.col === c && (sort.asc ? " ↑" : " ↓")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups].map(([name, list]) => [
            name && <tr key={"g" + name} className="bg-secondary"><td colSpan={8} className="px-3 py-1.5 text-[13px] font-semibold">{name} · {list.length}</td></tr>,
            ...list.map((x) => (
              <tr key={x.id} tabIndex={0} onClick={() => onOpen(x.id)} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(x.id)}
                className="cursor-pointer border-b last:border-0 hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none">
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox aria-label={`${t.list.done}: ${x.key}`} disabled={!canEdit} checked={x.stage === "done"} onCheckedChange={(on) => onDone(x.id, on)} />
                </td>
                <td className="p-3 whitespace-nowrap text-muted-foreground">{x.key}</td>
                <td className={cn("max-w-[360px] truncate p-3 font-medium", x.stage === "done" && "text-muted-foreground line-through")}>{x.title}</td>
                <td className="p-3"><StagePill s={x.stage} /></td>
                <td className="p-3"><PriorityPill p={x.priority} /></td>
                <td className="p-3"><Faces people={x.assignees} /></td>
                <td className="p-3"><DueChip task={x} /></td>
                <td className="p-3 whitespace-nowrap text-muted-foreground">{ago(x.updated_at)}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  )
}
