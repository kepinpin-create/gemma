import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { t } from "./strings"

export type Role = "owner" | "admin" | "member" | "viewer"
export type Stage = "backlog" | "todo" | "in_progress" | "in_review" | "done"
export type Priority = "low" | "medium" | "high" | "urgent"
export type TaskType = "task" | "milestone" | "issue" | "request"
export type Approval = "not_needed" | "needed" | "approved"
export const ROLES: Role[] = ["owner", "admin", "member", "viewer"]
export const STAGES: Stage[] = ["backlog", "todo", "in_progress", "in_review", "done"]
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"]
export const TYPES: TaskType[] = ["task", "milestone", "issue", "request"]
export const APPROVALS: Approval[] = ["not_needed", "needed", "approved"]

export interface User { id: number; full_name: string; email: string }
export interface WorkspaceRef { id: number; name: string; role: Role }
export interface Me { user: User; workspaces: WorkspaceRef[] }
export interface Member extends User { role: Role }
export interface Project {
  id: number; workspace_id: number; name: string; key: string; color: string
  status: "open" | "cancelled" | "closed"; archived: boolean
  start_date: string | null; end_date: string | null; starred: boolean
}
export interface TaskInput {
  title: string; description: string; stage: Stage; priority: Priority; type: TaskType; approval: Approval
  reference_code: string | null; due_date: string | null; assignee_ids: number[]
}
export interface Task extends Omit<TaskInput, "assignee_ids"> {
  id: number; project_id: number; workspace_id: number; number: number; key: string; position: number
  completed_at: string | null; created_by: number | null; created_at: string; updated_at: string
  assignees: { id: number; full_name: string }[]
}
export type TaskPatch = Partial<TaskInput> & { position?: number; done?: boolean }
export interface TaskDetail {
  task: Task; created_by_name: string
  comments: { id: number; body: string; author: string; created_at: string }[]
  activity: { id: number; action: string; from: string | null; to: string | null; actor: string; created_at: string }[]
}
export interface Notice {
  id: number; kind: string; read: boolean; created_at: string
  task: { id: number; key: string; title: string; workspace_id: number; project_key: string }
}
export interface Invitation { id: number; email: string; role: Role; token: string; expires_at: string }
export interface Brief { id: number; key: string; title: string; due_date: string | null; priority: Priority; owners: string[] }
export interface HealthRow {
  project_id: number; key: string; name: string; color: string; total: number; done: number; pct_done: number
  open: number; overdue: number; next_due: string | null; health: "on_track" | "at_risk" | "off_track"
}
export interface Dashboard {
  kpis: Record<string, number>
  project_health: HealthRow[]
  workload: { user_id: number | null; name: string; low: number; medium: number; high: number; urgent: number }[]
  trend: { week: string; created: number; completed: number }[]
  stages: ({ project_id: number; key: string } & Record<string, number | string>)[]
  overdue: Brief[]
  my_tasks: Brief[]
}

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } })

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch("/api" + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, t.error.network)
  }
  if (res.ok) return res.json()
  // Signed out (here or in another tab): drop the cached user so the route guard sends us to /login.
  if (res.status === 401 && !path.startsWith("/auth/")) queryClient.setQueryData(["me"], null)
  const detail = (await res.json().catch(() => null))?.detail
  const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null
  throw new ApiError(res.status, message || (res.status >= 500 ? t.error.network : t.error.generic))
}

export const useMe = () => useQuery({
  queryKey: ["me"], retry: false, staleTime: 60_000,
  queryFn: () => api<Me>("/auth/me").catch((e: ApiError) => { if (e.status === 401) return null; throw e }),
})
export const useProjects = (ws: number) =>
  useQuery({ queryKey: ["projects", ws], queryFn: () => api<Project[]>(`/workspaces/${ws}/projects`) })
// shortcut: polling every 5 s stands in for realtime; move to websockets when a team feels the lag
export const useTasks = (ws: number) =>
  useQuery({ queryKey: ["tasks", ws], queryFn: () => api<Task[]>(`/workspaces/${ws}/tasks`), refetchInterval: 5000 })
export const useMembers = (ws: number) =>
  useQuery({ queryKey: ["members", ws], queryFn: () => api<Member[]>(`/workspaces/${ws}/members`) })
export const useInvitations = (ws: number, enabled: boolean) =>
  useQuery({ queryKey: ["invitations", ws], queryFn: () => api<Invitation[]>(`/workspaces/${ws}/invitations`), enabled })
export const useTaskDetail = (id: number | null) =>
  useQuery({ queryKey: ["task", id], queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: id != null, retry: false })
export const useNotices = () =>
  useQuery({ queryKey: ["notices"], queryFn: () => api<Notice[]>("/notifications"), refetchInterval: 30_000 })
export const useDashboard = (ws: number, params: Record<string, string>) => useQuery({
  queryKey: ["dashboard", ws, params], placeholderData: keepPreviousData,
  queryFn: () => api<Dashboard>(`/workspaces/${ws}/dashboard?${new URLSearchParams(params)}`),
})

/** A mutation that shows its error as a toast and then refreshes the given query keys (prefix match). */
export function useAct<V, R = unknown>(fn: (v: V) => Promise<R>, refresh: string[]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: (e: Error) => { toast.error(e.message) },
    onSettled: () => refresh.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
}

/** Change a task with an instant (optimistic) update; a failure rolls the list back and shows a toast. */
export function usePatchTask(ws: number) {
  const qc = useQueryClient()
  const key = ["tasks", ws]
  const m = useMutation({ mutationFn: ({ id, ...patch }: TaskPatch & { id: number }) => api<Task>(`/tasks/${id}`, "PATCH", patch) })
  return (vars: TaskPatch & { id: number }) => {
    const before = qc.getQueryData<Task[]>(key)
    const { id, assignee_ids: _later, done, ...simple } = vars
    void qc.cancelQueries({ queryKey: key })
    qc.setQueryData<Task[]>(key, (old) => old?.map((x) => (x.id === id ? { ...x, ...simple, ...(done ? { stage: "done" as Stage } : {}) } : x)))
    m.mutate(vars, {
      onError: (e) => { qc.setQueryData(key, before); toast.error(e.message) },
      onSettled: () => ["tasks", "task", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    })
  }
}
