"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Member, canManage, canChangeMember, Role } from "@portalflow/shared";
import { Card, Input, Button, Alert } from "@portalflow/ui";
import { useIdentity } from "../../../components/workspace";
import { api, post } from "../../../lib/api";
export default function Team() {
  const me = useIdentity(),
    client = useQueryClient();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<Role>("AGENT"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const members = useQuery({
    queryKey: ["members", me.tenant.id],
    queryFn: () => api<Member[]>("/tenants/members"),
  });
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 className="text-3xl font-bold">Your team</h1>
      <p className="mb-8 mt-3 text-slate-500">
        The right people, with the right access.
      </p>
      {(error || members.error) && (
        <Alert>{error || members.error?.message}</Alert>
      )}
      {notice && (
        <p role="status" className="my-4 text-green-700">
          {notice}
        </p>
      )}
      {canManage(me.role) && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">Invite a teammate</h2>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                () => post("/tenants/invitations", { email, role }),
                "Invitation queued for email delivery.",
              );
            }}
          >
            <div className="min-w-52 flex-1">
              <label htmlFor="invite-email">Email address</label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {[
                  "VIEWER",
                  "AGENT",
                  "MANAGER",
                  ...(me.role === "OWNER" ? ["ADMIN"] : []),
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <Button disabled={busy || !me.user.emailVerifiedAt}>
              Send invitation
            </Button>
          </form>
        </Card>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-4">Member</th>
                <th className="pb-4">Role</th>
                <th className="pb-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.data?.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="py-5 pr-4">
                    <p className="font-semibold">{m.user.name}</p>
                    <p className="mt-1 text-slate-500">{m.user.email}</p>
                  </td>
                  <td className="pr-4">
                    {canChangeMember(me.role, m.role) ? (
                      <select
                        aria-label={`Role for ${m.user.email}`}
                        className="input"
                        value={m.role}
                        disabled={busy}
                        onChange={(e) =>
                          void action(
                            () =>
                              api(`/tenants/members/${m.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ role: e.target.value }),
                              }),
                            "Role updated.",
                          )
                        }
                      >
                        {[
                          "VIEWER",
                          "AGENT",
                          "MANAGER",
                          ...(me.role === "OWNER" ? ["ADMIN"] : []),
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td>
                    {canChangeMember(me.role, m.role) && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${m.user.name} from this workspace?`,
                            )
                          )
                            void action(
                              () =>
                                api(`/tenants/members/${m.id}`, {
                                  method: "DELETE",
                                }),
                              "Member removed.",
                            );
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {members.isPending && (
            <p role="status" className="py-6">
              Loading team…
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
