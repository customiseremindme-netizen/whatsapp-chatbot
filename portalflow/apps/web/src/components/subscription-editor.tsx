"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanRecord, SubscriptionSummary } from "@portalflow/shared";
import { Button, Input, Alert } from "@portalflow/ui";
import { api } from "../lib/api";
export function SubscriptionEditor({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "subscription", tenantId],
    queryFn: () =>
      api<SubscriptionSummary>(`/admin/tenants/${tenantId}/subscription`),
    enabled: open,
  });
  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => api<PlanRecord[]>("/admin/plans"),
    enabled: open,
  });
  return (
    <div className="mt-4 border-t pt-4">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide plan access" : "Manage plan access"}
      </Button>
      {open && (
        <div className="mt-4 space-y-3">
          {(query.isPending || plans.isPending) && (
            <p role="status">Loading plan access…</p>
          )}
          {(query.error || plans.error || error) && (
            <Alert>
              {query.error?.message ?? plans.error?.message ?? error}
            </Alert>
          )}
          {notice && <p role="status">{notice}</p>}
          {query.data && plans.data && (
            <form
              key={query.data.revision}
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  await api(`/admin/tenants/${tenantId}/subscription`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      planId: String(values.get("planId")),
                      status: String(values.get("status")),
                      expiresAt: new Date(
                        `${values.get("expiresAt")}:00Z`,
                      ).toISOString(),
                      revision: query.data!.revision,
                      reason: String(values.get("reason")),
                    }),
                  });
                  await client.invalidateQueries({ queryKey: ["admin"] });
                  await client.invalidateQueries({
                    queryKey: ["subscription"],
                  });
                  setNotice("Manual access grant saved. No payment collected.");
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Assignment failed",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="sm:col-span-2 text-sm">
                Current: {query.data.planName} · {query.data.status}. Usage:{" "}
                {query.data.usage.contacts} contacts, {query.data.usage.bots}{" "}
                bots, {query.data.usage.members} members +{" "}
                {query.data.usage.invitations} invitations.
              </p>
              <label>
                Access plan
                <select
                  className="input"
                  name="planId"
                  aria-label="Access plan"
                  required
                  defaultValue={query.data.planId ?? ""}
                >
                  <option value="">Choose a plan</option>
                  {plans.data
                    .filter((p) => !p.archived || p.id === query.data?.planId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.archived ? " (archived)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Access status
                <select
                  className="input"
                  name="status"
                  aria-label="Access status"
                  defaultValue={
                    ["ACTIVE", "PAUSED", "CANCELLED"].includes(
                      query.data.status,
                    )
                      ? query.data.status
                      : "ACTIVE"
                  }
                >
                  <option>ACTIVE</option>
                  <option>PAUSED</option>
                  <option>CANCELLED</option>
                </select>
              </label>
              <label>
                Access expiry (UTC)
                <Input
                  name="expiresAt"
                  type="datetime-local"
                  required
                  defaultValue={(query.data.source === "MANUAL"
                    ? query.data.expiresAt
                    : new Date(Date.now() + 30 * 86400000).toISOString()
                  ).slice(0, 16)}
                />
              </label>
              <label>
                Assignment reason
                <Input name="reason" minLength={3} maxLength={500} required />
              </label>
              <p className="text-sm text-slate-500 sm:col-span-2">
                This is a manual access grant, not a paid subscription. It
                snapshots the selected plan revision. Plan edits do not silently
                change existing grants. Downgrades below current usage are
                rejected.
              </p>
              <Button disabled={busy}>Save access grant</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
