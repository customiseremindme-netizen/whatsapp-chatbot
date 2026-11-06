"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Identity, Workspace } from "@portalflow/shared";
import { Button, Alert } from "@portalflow/ui";
import {
  Layers,
  LayoutDashboard,
  MessageSquare,
  ContactRound,
  Workflow,
  Target,
  Users,
  Settings,
  Shield,
  Menu,
  Moon,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { BrandName, SupportLink } from "./branding";
import { api, post, ApiError } from "../lib/api";
const IdentityContext = createContext<Identity | null>(null);
export function useIdentity() {
  const identity = useContext(IdentityContext);
  if (!identity) throw new Error("Workspace context missing");
  return identity;
}
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter(),
    path = usePathname(),
    client = useQueryClient();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const me = useQuery({
    queryKey: ["identity"],
    queryFn: () => api<Identity>("/auth/me"),
  });
  const spaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<Workspace[]>("/tenants"),
    enabled: !!me.data,
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      router.replace("/login");
  }, [me.error, router]);
  async function switchSpace(id: string) {
    try {
      await post("/tenants/switch", { tenantId: id });
      client.clear();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
    }
  }
  if (me.isPending)
    return (
      <div role="status" className="p-12 text-slate-500">
        Loading your workspace…
      </div>
    );
  if (!me.data)
    return (
      <div className="p-12">
        <Alert>{me.error?.message ?? "Unable to load workspace"}</Alert>
        <Button className="mt-4" onClick={() => void me.refetch()}>
          Retry
        </Button>
        <Link href="/login" className="ml-4 text-blue-600">
          Sign in
        </Link>
      </div>
    );
  const nav = [
    { href: "/dashboard", title: "Overview", icon: LayoutDashboard },
    { href: "/dashboard/inbox", title: "Inbox", icon: MessageSquare },
    { href: "/dashboard/contacts", title: "Contacts", icon: ContactRound },
    { href: "/dashboard/bots", title: "Chatbot Builder", icon: Workflow },
    { href: "/dashboard/leads", title: "Leads", icon: Target },
    { href: "/dashboard/team", title: "Team", icon: Users },
    { href: "/dashboard/settings", title: "Settings", icon: Settings },
    { href: "/dashboard/security", title: "Security", icon: Shield },
    { href: "/dashboard/billing", title: "Plan and usage", icon: Settings },
  ];
  if (me.data.user.platformAdmin)
    nav.push({ href: "/admin", title: "Platform admin", icon: Shield });
  return (
    <IdentityContext.Provider value={me.data}>
      <div className="min-h-screen">
        <aside
          className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950 lg:flex`}
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-2 py-4 text-xl font-bold"
          >
            <Layers className="text-blue-600" />
            <BrandName />
          </Link>
          <SupportLink />
          <label
            htmlFor="workspace-switcher"
            className="mt-8 text-xs uppercase tracking-wider text-slate-500"
          >
            Workspace
          </label>
          <select
            id="workspace-switcher"
            className="input mb-8 text-sm"
            value={me.data.tenant.id}
            onChange={(e) => void switchSpace(e.target.value)}
          >
            {spaces.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <nav className="space-y-2">
            {nav.map(({ href, title, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={
                  path === href ||
                  (href !== "/dashboard" && path.startsWith(href + "/"))
                    ? "page"
                    : undefined
                }
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${path === href || (href !== "/dashboard" && path.startsWith(href + "/")) ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"}`}
              >
                <Icon size={19} />
                {title}
              </Link>
            ))}
          </nav>
          <div className="mt-auto rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500 dark:bg-slate-900">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Local development release
            </span>
            <p className="mt-1">
              Mock WhatsApp and published workflows run locally.
            </p>
          </div>
        </aside>
        {open && (
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-20 bg-black/30 lg:hidden"
            onClick={() => setOpen(false)}
          />
        )}
        <div className="lg:pl-64">
          <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-6 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                className="lg:hidden"
                aria-label="Open menu"
                onClick={() => setOpen(true)}
              >
                <Menu />
              </Button>
              <span className="hidden text-sm text-slate-500 sm:inline">
                Workspace
              </span>
              <ChevronRight
                size={14}
                className="hidden text-slate-400 sm:inline"
              />
              <span className="text-sm font-medium">
                {nav.find(
                  (n) =>
                    n.href === path ||
                    (n.href !== "/dashboard" && path.startsWith(n.href + "/")),
                )?.title ?? "Overview"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                aria-label="Toggle theme"
                onClick={() => {
                  const dark =
                    document.documentElement.classList.toggle("dark");
                  localStorage.setItem("theme", dark ? "dark" : "light");
                }}
              >
                <Moon size={18} />
              </Button>
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold">{me.data.user.name}</p>
                <p className="text-xs capitalize text-slate-500">
                  {me.data.role.toLowerCase()}
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await post("/auth/logout");
                    client.clear();
                    router.replace("/login");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Logout failed");
                  }
                }}
              >
                <LogOut size={18} />
              </Button>
            </div>
          </header>
          <main className="mx-auto max-w-6xl p-6 lg:p-10">
            {error && (
              <div className="mb-5">
                <Alert>{error}</Alert>
              </div>
            )}
            {!me.data.user.emailVerifiedAt && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>Verify your email to invite team members.</p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await post("/auth/resend-verification");
                      setNotice("Verification email queued. Check your inbox.");
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Request failed",
                      );
                    }
                  }}
                >
                  Resend email
                </Button>
              </div>
            )}
            {notice && (
              <p role="status" className="mb-5 text-sm text-green-700">
                {notice}
              </p>
            )}
            {children}
          </main>
        </div>
      </div>
    </IdentityContext.Provider>
  );
}
