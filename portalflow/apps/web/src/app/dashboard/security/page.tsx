"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Card, Button, Alert } from "@portalflow/ui";
import { api } from "../../../lib/api";
import { useIdentity } from "../../../components/workspace";
type Session = {
  id: string;
  createdAt: string;
  updatedAt: string;
  tenant: { name: string };
};
export default function Security() {
  const me = useIdentity(),
    client = useQueryClient(),
    router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<Session[]>("/auth/sessions"),
  });
  return (
    <>
      <h1 className="mb-3 text-3xl font-bold">Account security</h1>
      <p className="mb-8 text-slate-500">
        Review active sessions across your workspaces.
      </p>
      {(error || sessions.error) && (
        <Alert>{error || sessions.error?.message}</Alert>
      )}
      <Card>
        <h2 className="mb-5 font-semibold">Active sessions</h2>
        {sessions.isPending && <p role="status">Loading sessions…</p>}
        {sessions.data?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-4 border-t border-slate-100 py-5 dark:border-slate-800"
          >
            <div>
              <p className="font-medium">
                {s.tenant.name}{" "}
                {s.id === me.sessionId && (
                  <span className="ml-2 text-xs text-green-600">
                    This session
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Signed in {new Date(s.createdAt).toLocaleString()}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!confirm("Revoke this session?")) return;
                setBusy(true);
                try {
                  await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
                  if (s.id === me.sessionId) {
                    client.clear();
                    router.replace("/login");
                  } else
                    await client.invalidateQueries({ queryKey: ["sessions"] });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Revoke failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revoke
            </Button>
          </div>
        ))}
      </Card>
    </>
  );
}
