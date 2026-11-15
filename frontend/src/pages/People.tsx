// Profile, members, roles and invitations (PRD "Accounts and auth").
import { useState } from "react"
import { toast } from "sonner"
import { Copy, Trash2 } from "lucide-react"
import { Choose, Face, Field, options } from "@/components/bits"
import { useWs } from "@/components/Shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ROLES, api, useAct, useInvitations, useMembers, type Invitation, type Member, type Role } from "@/lib/api"
import { t } from "@/lib/strings"

const card = "grid gap-3 rounded-lg border bg-card p-4 shadow-card"

export default function PeoplePage() {
  const ctx = useWs()
  const { data: members = [] } = useMembers(ctx.ws)
  const { data: invites = [] } = useInvitations(ctx.ws, ctx.isAdmin)
  const [name, setName] = useState(ctx.me.user.full_name)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("member")

  const rename = useAct((full_name: string) => api("/auth/me", "PATCH", { full_name }), ["me", "members", "tasks"])
  const setMemberRole = useAct((v: { id: number; role: Role }) => api(`/workspaces/${ctx.ws}/members/${v.id}`, "PATCH", { role: v.role }), ["members"])
  const remove = useAct((id: number) => api(`/workspaces/${ctx.ws}/members/${id}`, "DELETE"), ["members", "tasks"])
  const invite = useAct((body: { email: string; role: Role }) => api<Invitation>(`/workspaces/${ctx.ws}/invitations`, "POST", body), ["invitations"])
  const revoke = useAct((id: number) => api(`/workspaces/${ctx.ws}/invitations/${id}`, "DELETE"), ["invitations"])

  // Same rule as the server: owners manage anyone, admins manage admins and below; nobody edits themselves.
  const manages = (m: Member) => m.id !== ctx.me.user.id && (ctx.role === "owner" || (ctx.role === "admin" && m.role !== "owner"))
  const grantable = ROLES.filter((r) => ctx.role === "owner" || r !== "owner")
  const link = (i: Invitation) => `${location.origin}/invite/${i.token}`
  const copy = (i: Invitation) => navigator.clipboard.writeText(link(i)).then(() => toast.success(t.people.copied), () => toast.error(t.error.generic))

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4">
      <h1 className="text-xl font-semibold">{t.people.title}</h1>

      <form className={card} onSubmit={(e) => { e.preventDefault(); rename.mutate(name.trim(), { onSuccess: () => toast.success(t.people.saved) }) }}>
        <h2 className="font-semibold">{t.people.profile}</h2>
        <div className="flex items-end gap-2">
          <Field label={t.people.displayName} className="flex-1"><Input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
          <Button type="submit" disabled={!name.trim() || name.trim() === ctx.me.user.full_name || rename.isPending}>{t.people.save}</Button>
        </div>
        <p className="text-muted-foreground">{ctx.me.user.email}</p>
      </form>

      <section className={card}>
        <h2 className="font-semibold">{t.people.members} · {members.length}</h2>
        <ul className="grid gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3">
              <Face name={m.full_name} size="default" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.full_name}{m.id === ctx.me.user.id && <span className="text-muted-foreground"> ({t.people.you})</span>}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{m.email}</span>
              </span>
              {manages(m) ? <>
                <Choose label={t.people.role} value={m.role} onChange={(r) => setMemberRole.mutate({ id: m.id, role: r as Role })} items={options(t.role, grantable)} className="w-28" />
                <Button variant="ghost" size="icon" aria-label={`${t.people.remove}: ${m.full_name}`} onClick={() => { if (confirm(t.people.confirmRemove)) remove.mutate(m.id) }}><Trash2 /></Button>
              </> : <span className="w-28 text-muted-foreground">{t.role[m.role]}</span>}
            </li>
          ))}
        </ul>
      </section>

      {ctx.isAdmin && (
        <section className={card}>
          <h2 className="font-semibold">{t.people.invite}</h2>
          <p className="text-[13px] text-muted-foreground">{t.people.inviteHint}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault()
            invite.mutate({ email: email.trim(), role }, { onSuccess: (i) => { setEmail(""); void copy(i) } })
          }}>
            <Field label={t.people.email} className="min-w-52 flex-1"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Choose label={t.people.role} value={role} onChange={(r) => setRole(r as Role)} items={options(t.role, grantable)} className="w-28" />
            <Button type="submit" disabled={invite.isPending}>{t.people.send}</Button>
          </form>
          {invites.length > 0 && <>
            <h3 className="mt-2 text-[13px] font-semibold">{t.people.pending}</h3>
            <ul className="grid gap-2">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{i.email} <span className="text-muted-foreground">· {t.role[i.role]}</span></span>
                  <Button variant="outline" onClick={() => copy(i)}><Copy />{t.people.copy}</Button>
                  <Button variant="ghost" onClick={() => revoke.mutate(i.id)}>{t.people.revoke}</Button>
                </li>
              ))}
            </ul>
          </>}
        </section>
      )}
    </div>
  )
}
