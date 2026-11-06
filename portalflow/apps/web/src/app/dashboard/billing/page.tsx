"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SubscriptionSummary } from "@portalflow/shared";
import { Card, Button, Alert } from "@portalflow/ui";
import { api, post } from "../../../lib/api";
import { useIdentity } from "../../../components/workspace";
export default function Billing() {
  const me = useIdentity();
  const query = useQuery({
    queryKey: ["subscription", me.tenant.id],
    queryFn: () => api<SubscriptionSummary>("/billing/subscription"),
  });
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (query.isPending) return <p role="status">Loading access and usage…</p>;
  if (!query.data)
    return <Alert>{query.error?.message ?? "Unable to load usage"}</Alert>;
  const value = query.data;
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold">Plan and usage</h1>
      <Card>
        <h2 className="text-xl font-semibold">{value.planName}</h2>
        <p className="mt-2">
          {value.status} ·{" "}
          {value.source === "MANUAL"
            ? "Administrator-granted access"
            : "Trial access"}
        </p>
        <p className="text-sm text-slate-500">
          Expires{" "}
          {new Date(value.expiresAt).toLocaleString("en-IN", {
            timeZone: me.tenant.timezone,
          })}
          . No payment has been collected by this feature.
        </p>
        {!value.active && (
          <Alert>
            Access is inactive. Existing records remain readable; new resources,
            automation and outbound sends are blocked. Contact your platform
            administrator.
          </Alert>
        )}
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        {(["contacts", "bots", "members"] as const).map((key) => (
          <Card key={key}>
            <h2 className="capitalize">{key}</h2>
            <p className="mt-2 text-2xl font-semibold">
              {value.usage[key]} / {value.limits[key]}
            </p>
            {key === "members" && (
              <p className="text-sm text-slate-500">
                {value.usage.invitations} reserved invitation seats
              </p>
            )}
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="font-semibold">
          Incoming messages blocked by contact limits
        </h2>
        <p className="my-3">
          {value.usage.blockedInbound} events waiting for an explicit retry.
          Free space or request a larger plan first.
        </p>
        {["OWNER", "ADMIN"].includes(me.role) && (
          <Button
            disabled={busy || !value.active || value.usage.blockedInbound === 0}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await post<{ queued: number }>(
                  "/billing/retry-blocked",
                );
                setNotice(
                  `${result.queued} events queued for another eligibility check.`,
                );
                await query.refetch();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Retry failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry up to 25 blocked events
          </Button>
        )}
      </Card>
      {notice && <p role="status">{notice}</p>}
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-slate-500">
        Payments, invoices, automatic renewals, message quotas and
        WhatsApp-number connections are not available yet. This page enforces
        active contact, chatbot and team capacity only.
      </p>
    </div>
  );
}
