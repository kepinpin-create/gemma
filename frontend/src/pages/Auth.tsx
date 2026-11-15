// Log in, sign up, first-workspace onboarding and the invitation page.
import type { ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Field, Logo } from "@/components/bits"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, useAct, useMe, type Me } from "@/lib/api"
import { t } from "@/lib/strings"

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-full place-items-center p-4">
      <div className="grid w-full max-w-sm gap-5 rounded-lg border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2 text-lg font-semibold"><Logo className="size-8" />{t.app}</div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  )
}

/** Only ever return to a path inside this app, never to another site. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/")
const form = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string> }

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const next = safeNext(params.get("next"))
  const submit = useAct((body: Record<string, string>) => api<Me>(`/auth/${mode}`, "POST", body), [])
  if (me) return <Navigate to={next} replace />
  const other = mode === "login" ? "signup" : "login"
  return (
    <Frame title={t.auth[mode]}>
      <p className="-mt-3 text-muted-foreground">{t.auth.tagline}</p>
      <form className="grid gap-3" onSubmit={(e) => submit.mutate(form(e), { onSuccess: (me) => { qc.clear(); qc.setQueryData(["me"], me); nav(next, { replace: true }) } })}>
        {mode === "signup" && <Field label={t.auth.name}><Input name="full_name" required maxLength={100} autoComplete="name" autoFocus /></Field>}
        <Field label={t.auth.email}><Input name="email" type="email" required autoComplete="email" defaultValue={params.get("email") ?? ""} autoFocus={mode === "login"} /></Field>
        <Field label={t.auth.password}>
          <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} aria-describedby={mode === "signup" ? "pw-hint" : undefined} />
        </Field>
        {mode === "signup" && <p id="pw-hint" className="-mt-2 text-xs text-muted-foreground">{t.auth.passwordHint}</p>}
        <Button type="submit" size="lg" disabled={submit.isPending}>{t.auth[mode]}</Button>
      </form>
      <Link to={`/${other}?${params}`} className="text-primary hover:underline">{mode === "login" ? t.auth.toSignup : t.auth.toLogin}</Link>
    </Frame>
  )
}

export function Welcome() {
  const nav = useNavigate()
  const create = useAct((name: string) => api<{ id: number }>("/workspaces", "POST", { name }), ["me"])
  return (
    <Frame title={t.auth.welcome}>
      <p className="-mt-3 text-muted-foreground">{t.auth.welcomeHint}</p>
      <form className="grid gap-3" onSubmit={(e) => create.mutate(form(e).name.trim(), { onSuccess: (ws) => nav(`/${ws.id}/dashboard`) })}>
        <Field label={t.auth.workspaceName}><Input name="name" required maxLength={80} placeholder={t.auth.workspacePlaceholder} autoFocus /></Field>
        <Button type="submit" size="lg" disabled={create.isPending}>{t.auth.createWorkspace}</Button>
      </form>
    </Frame>
  )
}

export function InvitePage() {
  const { token } = useParams()
  const nav = useNavigate()
  const { data: me } = useMe()
  const { data: inv, isError } = useQuery({
    queryKey: ["invite", token], retry: false,
    queryFn: () => api<{ workspace_name: string; email: string; role: string }>(`/invitations/${token}`),
  })
  const accept = useAct(() => api<{ workspace_id: number }>(`/invitations/${token}/accept`, "POST"), ["me"])
  if (isError) return <Frame title={t.auth.inviteInvalid}><Link to="/" className="text-primary hover:underline">{t.app}</Link></Frame>
  if (!inv) return <Frame title={t.loading}>{null}</Frame>
  const back = `next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(inv.email)}`
  return (
    <Frame title={t.auth.inviteTitle}>
      <p className="-mt-3">{t.auth.inviteBody(inv.workspace_name, t.role[inv.role] ?? inv.role)}</p>
      <p className="text-muted-foreground">{t.auth.inviteFor} {inv.email}</p>
      {me
        ? <Button size="lg" disabled={accept.isPending} onClick={() => accept.mutate(undefined, { onSuccess: (r) => nav(`/${r.workspace_id}/dashboard`) })}>{t.auth.accept}</Button>
        : <div className="grid gap-2">
            <Link to={`/signup?${back}`} className={buttonVariants({ size: "lg" })}>{t.auth.signup}</Link>
            <Link to={`/login?${back}`} className={buttonVariants({ size: "lg", variant: "outline" })}>{t.auth.login}</Link>
          </div>}
    </Frame>
  )
}
