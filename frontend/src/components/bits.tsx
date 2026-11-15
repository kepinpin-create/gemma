// Small shared pieces: logo, select, avatars, pills.
import type { ReactNode } from "react"
import { CalendarDays } from "lucide-react"
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Approval, Priority, Project, Stage, Task } from "@/lib/api"
import { t } from "@/lib/strings"
import { fmtDate, initials, isDueSoon, isOverdue } from "@/lib/util"
import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1D4ED8" />
      <path d="M16 25V15" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 16c0-5 3-8 7-8 0 5-3 8-7 8Z" fill="#fff" />
      <path d="M16 19c0-3.6-2.2-6-5.5-6 0 3.6 2.2 6 5.5 6Z" fill="#BFDBFE" />
    </svg>
  )
}

export interface Option { value: string; label: string }
export const options = (labels: Record<string, string>, keys = Object.keys(labels)): Option[] =>
  keys.map((value) => ({ value, label: labels[value] }))

/** A labelled dropdown. `label` is read by screen readers; the visible text is the chosen option. */
export function Choose({ value, onChange, items, label, className, disabled }: {
  value: string; onChange: (v: string) => void; items: Option[]; label: string; className?: string; disabled?: boolean
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v != null && onChange(v as string)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn("bg-background", className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function Face({ name, size = "sm" }: { name: string; size?: "sm" | "default" }) {
  return (
    <Avatar size={size} title={name}>
      <AvatarFallback className="bg-primary-100 text-[10px] font-semibold text-primary-700">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

/** Up to three avatars, then "+n" (PRD F5). */
export function Faces({ people }: { people: { id: number; full_name: string }[] }) {
  if (!people.length) return null
  return (
    <AvatarGroup>
      {people.slice(0, 3).map((p) => <Face key={p.id} name={p.full_name} />)}
      {people.length > 3 && <AvatarGroupCount className="size-6 text-[10px]">+{people.length - 3}</AvatarGroupCount>}
    </AvatarGroup>
  )
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>{children}</span>
}

export const PriorityPill = ({ p }: { p: Priority }) =>
  <Pill className="bg-primary-100 text-primary-700 uppercase tracking-wide">{t.priority[p]}</Pill>

const APPROVAL_STYLE: Record<Approval, string> = {
  not_needed: "bg-mint-bg text-mint-text",
  needed: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-stat-done",
}
export const ApprovalPill = ({ a }: { a: Approval }) => <Pill className={APPROVAL_STYLE[a]}>{t.approval[a]}</Pill>

export const StagePill = ({ s }: { s: Stage }) =>
  <Pill className={s === "done" ? "bg-green-100 text-stat-done" : "bg-secondary text-foreground"}>{t.stage[s]}</Pill>

/** Red if overdue, amber if due within 2 days (PRD F5). */
export function DueChip({ task }: { task: Task }) {
  if (!task.due_date) return null
  const tone = isOverdue(task) ? "bg-red-50 text-stat-overdue" : isDueSoon(task) ? "bg-amber-50 text-amber-800" : "bg-secondary text-muted-foreground"
  return <Pill className={tone}><CalendarDays className="size-3" />{fmtDate(task.due_date)}</Pill>
}

export function Tile({ project, className }: { project: Pick<Project, "name" | "color">; className?: string }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white", className)} style={{ background: project.color }}>
      {project.name[0]?.toUpperCase()}
    </span>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-[13px] font-medium", className)}>
      {label}
      {children}
    </label>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="p-6 text-center text-muted-foreground">{children}</p>
