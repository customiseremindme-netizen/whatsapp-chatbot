"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users, Mail, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Card, Button, Alert } from "@portalflow/ui";
import { api } from "../../lib/api";
import { useIdentity } from "../../components/workspace";
type Overview = {
  members: number;
  pendingInvitations: number;
  events: { id: string; action: string; createdAt: string }[];
};
export default function Overview() {
  const me = useIdentity();
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["overview", me.tenant.id],
    queryFn: () => api<Overview>("/tenants/overview"),
  });
  return (
    <>
      <p className="mb-2 text-sm text-slate-500">Your workspace at a glance</p>
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome, {me.user.name.split(" ")[0]}.
      </h1>
      <p className="mt-3 text-slate-500">
        Let’s get {me.tenant.name} ready for better conversations.
      </p>
      {error && (
        <div className="my-6">
          <Alert>{error.message}</Alert>
          <Button onClick={() => void refetch()}>Retry</Button>
        </div>
      )}
      <div className="my-8 grid gap-5 sm:grid-cols-3">
        <Card>
          <Users className="mb-4 text-blue-600" />
          <p className="text-sm text-slate-500">Team members</p>
          <p className="mt-2 text-3xl font-semibold">
            {isPending ? "…" : (data?.members ?? "—")}
          </p>
        </Card>
        <Card>
          <Mail className="mb-4 text-blue-600" />
          <p className="text-sm text-slate-500">Pending invitations</p>
          <p className="mt-2 text-3xl font-semibold">
            {isPending ? "…" : (data?.pendingInvitations ?? "—")}
          </p>
        </Card>
        <Card>
          <ShieldCheck className="mb-4 text-green-600" />
          <p className="text-sm text-slate-500">Email status</p>
          <p className="mt-3 text-xl font-semibold">
            {me.user.emailVerifiedAt ? "Verified" : "Verification pending"}
          </p>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="text-lg font-semibold">Make this workspace yours</h2>
          <p className="mt-2 text-sm text-slate-500">
            A few essentials before the first conversation.
          </p>
          {[
            [
              "01",
              "Set your business profile",
              "Timezone, language and workspace name.",
              "/dashboard/settings",
            ],
            [
              "02",
              "Bring your team together",
              "Invite teammates and manage their access.",
              "/dashboard/team",
            ],
            [
              "03",
              "Review account security",
              "See and revoke active sessions.",
              "/dashboard/security",
            ],
          ].map(([step, title, desc, href]) => (
            <Link
              key={step}
              href={href!}
              className="mt-6 flex items-center gap-4 border-t border-slate-100 pt-6 dark:border-slate-800"
            >
              <span className="text-sm font-semibold text-blue-600">
                {step}
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-500">{desc}</p>
              </div>
              <ArrowUpRight size={18} className="text-slate-400" />
            </Link>
          ))}
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-semibold">Workspace activity</h2>
          <p className="mt-2 text-sm text-slate-500">
            Recent account and team changes.
          </p>
          <div className="mt-5 space-y-5">
            {data?.events.length === 0 && (
              <p className="text-sm text-slate-500">No activity yet.</p>
            )}
            {data?.events.map((event) => (
              <div key={event.id} className="border-l-2 border-blue-200 pl-4">
                <p className="text-sm capitalize">
                  {event.action.replaceAll(".", " ").replaceAll("_", " ")}
                </p>
                <time className="mt-1 block text-xs text-slate-500">
                  {new Date(event.createdAt).toLocaleString("en-IN", {
                    timeZone: me.tenant.timezone,
                  })}
                </time>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
