import { StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import Shell from "@/components/Shell"
import { Toaster } from "@/components/ui/sonner"
import { queryClient, useMe } from "@/lib/api"
import { t } from "@/lib/strings"
import { AuthPage, InvitePage, Welcome } from "@/pages/Auth"
import { DashboardPage, ProjectsPage } from "@/pages/Dashboard"
import PeoplePage from "@/pages/People"
import ProjectPage from "@/pages/ProjectPage"
import TasksPage from "@/pages/Tasks"
import "./index.css"

/** Signed-out visitors go to /login and come back to the page they asked for. */
function Authed({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe()
  const loc = useLocation()
  if (isLoading) return <p className="p-6 text-muted-foreground">{t.loading}</p>
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return children
}

function Home() {
  const { data: me } = useMe()
  return <Navigate to={me?.workspaces[0] ? `/${me.workspaces[0].id}/dashboard` : "/welcome"} replace />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/welcome" element={<Authed><Welcome /></Authed>} />
          <Route path="/" element={<Authed><Home /></Authed>} />
          <Route path="/:ws" element={<Authed><Shell /></Authed>}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:key" element={<ProjectPage />} />
            <Route path="projects/:key/:view" element={<ProjectPage />} />
            <Route path="people" element={<PeoplePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster theme="light" position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
)
