import { useState } from "react"
import type { Priority, Task } from "./api"

const pad = (n: number) => String(n).padStart(2, "0")
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Today in the browser's time zone, as YYYY-MM-DD (the same shape as due dates, so strings compare correctly). */
export const today = () => ymd(new Date())
export const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00")
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const fmtDate = (day: string) => new Date(day + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
export function ago(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const)
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit)
  return rtf.format(0, "minute")
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")

export const isOverdue = (x: Task, now = today()) => x.stage !== "done" && !!x.due_date && x.due_date < now
export const isDueSoon = (x: Task, now = today()) => x.stage !== "done" && !!x.due_date && x.due_date >= now && x.due_date <= addDays(now, 2)

export const STAT_KEYS = ["total", "todo", "in_progress", "done", "overdue", "approval"] as const
export type StatKey = (typeof STAT_KEYS)[number]
/** PRD F3: Overdue = due before today and not Done; Approval = flagged "needs approval". */
export const inStat = (x: Task, k: StatKey, now = today()) =>
  k === "total" || (k === "overdue" ? isOverdue(x, now) : k === "approval" ? x.approval === "needed" : x.stage === k)

export type Sort = "manual" | "newest" | "oldest" | "due" | "priority"
const RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const ORDER: Record<Sort, (a: Task, b: Task) => number> = {
  manual: (a, b) => a.position - b.position || a.id - b.id,
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
  due: (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
  priority: (a, b) => RANK[a.priority] - RANK[b.priority],
}
export const sortTasks = (list: Task[], sort: Sort) => [...list].sort(ORDER[sort])

export interface Filters { q: string; type: string; assignee: string; group: string; sort: Sort; stat: StatKey | null }
export const NO_FILTERS: Filters = { q: "", type: "all", assignee: "all", group: "none", sort: "manual", stat: null }

export function filterTasks(list: Task[], f: Pick<Filters, "q" | "type" | "assignee">): Task[] {
  const q = f.q.trim().toLowerCase()
  return list.filter((x) =>
    (!q || x.key.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)) &&
    (f.type === "all" || x.type === f.type) &&
    (f.assignee === "all" || (f.assignee === "none" ? x.assignees.length === 0 : x.assignees.some((a) => String(a.id) === f.assignee))))
}

/** Object state kept in localStorage under `key` (PRD F2: filters persist per user per project). */
export function useStored<T extends object>(key: string, initial: T): [T, (v: T) => void] {
  const read = (): T => {
    try { return { ...initial, ...JSON.parse(localStorage.getItem(key) ?? "{}") } } catch { return initial }
  }
  const [state, setState] = useState(() => ({ key, value: read() }))
  if (state.key !== key) setState({ key, value: read() }) // another project: load its own saved filters
  const set = (value: T) => {
    setState({ key, value })
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: keep it in memory only */ }
  }
  return [state.key === key ? state.value : read(), set]
}
