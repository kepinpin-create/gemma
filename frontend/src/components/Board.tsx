// Kanban board (PRD F4): five columns, drag between and within them, one column at a time on phones.
import { useMemo, useState } from "react"
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type UniqueIdentifier,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Plus } from "lucide-react"
import { STAGES, type Stage, type Task } from "@/lib/api"
import { t } from "@/lib/strings"
import { cn } from "@/lib/utils"
import { TaskCard } from "./task"

type Columns = Record<Stage, number[]>
const isStage = (id: UniqueIdentifier): id is Stage => STAGES.includes(id as Stage)

export function Board({ tasks, canEdit, onOpen, onAdd, onMove, initialStage }: {
  tasks: Task[] // already filtered and sorted
  canEdit: boolean
  onOpen: (id: number) => void
  onAdd: (stage: Stage) => void
  onMove: (id: number, stage: Stage, position: number) => void
  initialStage?: Stage
}) {
  const byId = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks])
  const saved = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s, [] as number[]])) as Columns
    for (const x of tasks) c[x.stage].push(x.id)
    return c
  }, [tasks])
  const [dragging, setDragging] = useState<{ id: number; cols: Columns } | null>(null) // column order while a drag is in flight
  const [tab, setTab] = useState<Stage>(initialStage ?? "todo")
  const cols = dragging?.cols ?? saved
  const stageOf = (id: UniqueIdentifier) => (isStage(id) ? id : STAGES.find((s) => cols[s].includes(id as number)))

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), // a plain click still opens the card
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }), // a swipe still scrolls
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !dragging) return
    const from = stageOf(active.id), to = stageOf(over.id)
    if (!from || !to || from === to) return
    const id = active.id as number
    const dst = cols[to].filter((x) => x !== id)
    const at = isStage(over.id) ? dst.length : dst.indexOf(over.id as number)
    dst.splice(at < 0 ? dst.length : at, 0, id)
    setDragging({ id, cols: { ...cols, [from]: cols[from].filter((x) => x !== id), [to]: dst } })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null)
    const id = active.id as number, task = byId.get(id), stage = stageOf(id)
    if (!over || !task || !stage) return
    let ids = cols[stage]
    const to = isStage(over.id) ? -1 : ids.indexOf(over.id as number)
    if (to >= 0) ids = arrayMove(ids, ids.indexOf(id), to)
    const i = ids.indexOf(id)
    if (stage === task.stage && i === saved[stage].indexOf(id)) return // dropped where it started
    // The new position is halfway between its neighbours, so no other card needs rewriting.
    const prev = byId.get(ids[i - 1])?.position, next = byId.get(ids[i + 1])?.position
    onMove(id, stage, prev == null ? (next == null ? 1 : next - 1) : next == null ? prev + 1 : (prev + next) / 2)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners}
      onDragStart={({ active }) => setDragging({ id: active.id as number, cols: saved })}
      onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div role="tablist" className="flex gap-1 overflow-x-auto px-4 pt-3 md:hidden">
        {STAGES.map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
            className={cn("rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap", tab === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>
            {t.stage[s]} · {cols[s].length}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
        {STAGES.map((s) => (
          <Column key={s} stage={s} ids={cols[s]} className={tab === s ? "flex" : "hidden md:flex"}>
            {cols[s].map((id) => byId.has(id) && <Card key={id} task={byId.get(id)!} canEdit={canEdit} onOpen={() => onOpen(id)} />)}
            {cols[s].length === 0 && <p className="py-6 text-center text-[13px] text-muted-foreground">{t.board.empty}</p>}
            {canEdit && (
              <button onClick={() => onAdd(s)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-background hover:text-foreground">
                <Plus className="size-4" />{t.board.addTask}
              </button>
            )}
          </Column>
        ))}
      </div>
      <DragOverlay>{dragging && byId.has(dragging.id) && <TaskCard task={byId.get(dragging.id)!} className="rotate-2 shadow-lg" />}</DragOverlay>
    </DndContext>
  )
}

function Column({ stage, ids, className, children }: { stage: Stage; ids: number[]; className: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: stage })
  return (
    <section className={cn("w-full shrink-0 flex-col rounded-lg bg-column md:w-[340px]", className)}>
      {/* the column holding work in progress gets the accent underline */}
      <header className={cn("flex items-center gap-2 border-b-[3px] px-3 py-2.5", stage === "in_progress" ? "border-accent-column" : "border-transparent")}>
        <GripVertical className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-semibold">{t.stage[stage]}</h2>
        <span className="rounded-full bg-background px-2 text-xs font-medium text-muted-foreground">{ids.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">{children}</div>
      </SortableContext>
    </section>
  )
}

function Card({ task, canEdit, onOpen }: { task: Task; canEdit: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !canEdit })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      aria-roledescription={t.board.drag} className={cn("touch-manipulation rounded-lg", isDragging && "opacity-40")}>
      <TaskCard task={task} onOpen={onOpen} />
    </div>
  )
}
