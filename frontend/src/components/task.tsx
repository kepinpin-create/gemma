// Task card, create dialog and detail drawer (PRD F5, F6, F7, F9).
import { useState, type KeyboardEvent } from "react"
import { ChevronDown, CircleCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { APPROVALS, PRIORITIES, STAGES, TYPES, api, useAct, useMembers, useTaskDetail } from "@/lib/api"
import type { Member, Project, Stage, Task, TaskDetail, TaskInput } from "@/lib/api"
import { t } from "@/lib/strings"
import { ago, fmtDateTime } from "@/lib/util"
import { cn } from "@/lib/utils"
import { ApprovalPill, Choose, DueChip, Empty, Face, Faces, Field, PriorityPill, options } from "./bits"
import type { Ws } from "./Shell"

export function TaskCard({ task, onOpen, className }: { task: Task; onOpen?: () => void; className?: string }) {
  const done = task.stage === "done"
  return (
    <button type="button" onClick={onOpen}
      className={cn("grid w-full gap-2 rounded-lg border bg-card p-3 text-left shadow-card hover:border-primary-100 hover:bg-primary-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{task.key}</span>
        <PriorityPill p={task.priority} />
      </span>
      <span className={cn("line-clamp-2 font-medium", done && "text-muted-foreground line-through")}>{task.title}</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Faces people={task.assignees} />
        <ApprovalPill a={task.approval} />
        <DueChip task={task} />
      </span>
    </button>
  )
}

const toDraft = (x: Task): TaskInput => ({
  title: x.title, description: x.description, stage: x.stage, priority: x.priority, type: x.type, approval: x.approval,
  reference_code: x.reference_code, due_date: x.due_date, assignee_ids: x.assignees.map((a) => a.id).sort(),
})

function TaskFields({ draft, set, members, disabled }: { draft: TaskInput; set: (d: TaskInput) => void; members: Member[]; disabled?: boolean }) {
  const up = (patch: Partial<TaskInput>) => set({ ...draft, ...patch })
  const chosen = members.filter((m) => draft.assignee_ids.includes(m.id))
  const toggle = (id: number, on: boolean) =>
    up({ assignee_ids: on ? [...draft.assignee_ids, id].sort() : draft.assignee_ids.filter((x) => x !== id) })
  return (
    <fieldset disabled={disabled} className="grid gap-3">
      <Field label={t.task.title}>
        <Input autoFocus required maxLength={300} value={draft.title} placeholder={t.task.titlePlaceholder} onChange={(e) => up({ title: e.target.value })} />
      </Field>
      <Field label={t.task.description}>
        <Textarea rows={4} value={draft.description} placeholder={t.task.descriptionPlaceholder} onChange={(e) => up({ description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.task.stage}><Choose label={t.task.stage} disabled={disabled} value={draft.stage} onChange={(v) => up({ stage: v as Stage })} items={options(t.stage, STAGES)} className="w-full" /></Field>
        <Field label={t.task.priority}><Choose label={t.task.priority} disabled={disabled} value={draft.priority} onChange={(v) => up({ priority: v as TaskInput["priority"] })} items={options(t.priority, PRIORITIES)} className="w-full" /></Field>
        <Field label={t.task.type}><Choose label={t.task.type} disabled={disabled} value={draft.type} onChange={(v) => up({ type: v as TaskInput["type"] })} items={options(t.type, TYPES)} className="w-full" /></Field>
        <Field label={t.task.approval}><Choose label={t.task.approval} disabled={disabled} value={draft.approval} onChange={(v) => up({ approval: v as TaskInput["approval"] })} items={options(t.approval, APPROVALS)} className="w-full" /></Field>
        <Field label={t.task.due}>
          <Input type="date" value={draft.due_date ?? ""} onChange={(e) => up({ due_date: e.target.value || null })} />
        </Field>
        <Field label={t.task.assignees}>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}>
              <span className="truncate">{chosen.length ? chosen.map((m) => m.full_name).join(", ") : t.task.noAssignee}</span>
              <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
              {members.map((m) => (
                <DropdownMenuCheckboxItem key={m.id} checked={draft.assignee_ids.includes(m.id)} onCheckedChange={(on) => toggle(m.id, on)}>
                  {m.full_name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
      </div>
      <Field label={t.task.reference}>
        <Input maxLength={100} value={draft.reference_code ?? ""} placeholder={t.task.referencePlaceholder} onChange={(e) => up({ reference_code: e.target.value || null })} />
      </Field>
    </fieldset>
  )
}

/** Ctrl+Enter (or Cmd+Enter) saves, as the PRD asks. */
const onSaveKey = (save: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() }
}

const REFRESH = ["tasks", "task", "dashboard", "notices"]

export function TaskDialog({ ctx, project, stage, onClose }: { ctx: Ws; project: Project; stage: Stage | null; onClose: () => void }) {
  return (
    <Dialog open={stage != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {stage && <CreateForm key={stage} ctx={ctx} project={project} stage={stage} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ ctx, project, stage, onClose }: { ctx: Ws; project: Project; stage: Stage; onClose: () => void }) {
  const { data: members = [] } = useMembers(ctx.ws)
  const [draft, set] = useState<TaskInput>({
    title: "", description: "", stage, priority: "medium", type: "task", approval: "not_needed", reference_code: null, due_date: null, assignee_ids: [],
  })
  const create = useAct((body: TaskInput) => api<Task>(`/projects/${project.id}/tasks`, "POST", body), REFRESH)
  const save = () => { if (draft.title.trim() && !create.isPending) create.mutate({ ...draft, title: draft.title.trim() }, { onSuccess: onClose }) }
  return (
    <form onSubmit={(e) => { e.preventDefault(); save() }} onKeyDown={onSaveKey(save)} className="grid gap-4">
      <DialogHeader><DialogTitle>{t.task.new} · {project.key}</DialogTitle></DialogHeader>
      <TaskFields draft={draft} set={set} members={members} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t.task.cancel}</Button>
        <Button type="submit" disabled={!draft.title.trim() || create.isPending} title={t.task.saveHint}>{t.task.create}</Button>
      </DialogFooter>
    </form>
  )
}

export function TaskDrawer({ ctx, taskId, onClose }: { ctx: Ws; taskId: number | null; onClose: () => void }) {
  const { data, isError } = useTaskDetail(taskId)
  return (
    <Sheet open={taskId != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.task.key ?? (isError ? t.task.notFound : t.loading)}</SheetTitle>
          <SheetDescription className="sr-only">{data?.task.title}</SheetDescription>
        </SheetHeader>
        {data && <DrawerBody key={data.task.id} ctx={ctx} detail={data} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function DrawerBody({ ctx, detail, onClose }: { ctx: Ws; detail: TaskDetail; onClose: () => void }) {
  const { task } = detail
  const { data: members = [] } = useMembers(ctx.ws)
  const [draft, set] = useState(() => toDraft(task))
  const [comment, setComment] = useState("")
  const patch = useAct((body: Partial<TaskInput> & { done?: boolean }) => api<Task>(`/tasks/${task.id}`, "PATCH", body), REFRESH)
  const remove = useAct(() => api(`/tasks/${task.id}`, "DELETE"), REFRESH)
  const send = useAct((body: string) => api(`/tasks/${task.id}/comments`, "POST", { body }), REFRESH)

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(task))
  const save = () => { if (dirty && draft.title.trim() && !patch.isPending) patch.mutate(draft, { onSuccess: (x) => set(toDraft(x)) }) }
  const setDone = (done: boolean) => patch.mutate({ done }, { onSuccess: (x) => set(toDraft(x)) })
  const sendComment = () => { if (comment.trim() && !send.isPending) send.mutate(comment.trim(), { onSuccess: () => setComment("") }) }
  const canDelete = ctx.isAdmin || (ctx.canEdit && task.created_by === ctx.me.user.id)
  const stageName = (v: string | null) => (v && t.stage[v]) || v || t.activity.none

  return (
    <div className="grid gap-5 px-4 pb-6" onKeyDown={onSaveKey(save)}>
      {!ctx.canEdit && <p className="rounded-lg bg-secondary px-3 py-2 text-muted-foreground">{t.task.readOnly}</p>}
      <TaskFields draft={draft} set={set} members={members} disabled={!ctx.canEdit} />
      {ctx.canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!dirty || !draft.title.trim() || patch.isPending} title={t.task.saveHint}>{t.task.save}</Button>
          {task.stage === "done"
            ? <Button variant="outline" onClick={() => setDone(false)}>{t.task.reopen}</Button>
            : <Button variant="outline" onClick={() => setDone(true)}><CircleCheck className="text-stat-done" />{t.task.markDone}</Button>}
          {canDelete && (
            <Button variant="destructive" className="ml-auto" onClick={() => { if (confirm(t.task.confirmDelete)) remove.mutate(undefined, { onSuccess: onClose }) }}>
              <Trash2 />{t.task.delete}
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t.task.createdBy} {detail.created_by_name} · {fmtDateTime(task.created_at)} · {t.task.updated} {ago(task.updated_at)}
      </p>

      <section className="grid gap-3">
        <h3 className="font-semibold">{t.task.comments}</h3>
        {detail.comments.length === 0 && <p className="text-muted-foreground">{t.task.noComments}</p>}
        {detail.comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Face name={c.author} />
            <div className="min-w-0">
              <p className="text-[13px]"><span className="font-medium">{c.author}</span> <span className="text-muted-foreground">{ago(c.created_at)}</span></p>
              <p className="break-words whitespace-pre-wrap">{c.body}</p>
            </div>
          </div>
        ))}
        {ctx.canEdit && (
          <div className="grid gap-2" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); sendComment() } }}>
            <Textarea rows={2} maxLength={5000} aria-label={t.task.commentPlaceholder} placeholder={t.task.commentPlaceholder} value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button variant="outline" className="justify-self-end" disabled={!comment.trim() || send.isPending} onClick={sendComment}>{t.task.send}</Button>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="font-semibold">{t.task.activity}</h3>
        {detail.activity.length === 0 && <Empty>{t.dash.nothing}</Empty>}
        <ul className="grid gap-1.5 text-[13px]">
          {detail.activity.map((a) => (
            <li key={a.id}>
              <span className="font-medium">{a.actor}</span> {t.activity[a.action] ?? a.action}
              {a.action !== "created" && <span className="text-muted-foreground"> · {a.action === "stage" || a.action === "completed" ? `${stageName(a.from)} → ${stageName(a.to)}` : `${a.from || t.activity.none} → ${a.to || t.activity.none}`}</span>}
              <span className="text-muted-foreground"> · {ago(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
