"use client";
import { SubscriptionEditor } from "../../components/subscription-editor";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Card, Alert } from "@portalflow/ui";
import {
  PlanRecord,
  PlanValues,
  PlatformConfiguration,
  PageResult,
} from "@portalflow/shared";
import { useIdentity } from "../../components/workspace";
import { useBranding } from "../../components/branding";
import { api, post } from "../../lib/api";
type Business = {
  id: string;
  name: string;
  suspendedAt: string | null;
  _count: { memberships: number; contacts: number; conversations: number };
};
type User = { id: string; name: string; email: string; platformAdmin: boolean };
type Audit = {
  id: string;
  action: string;
  actorId: string;
  resourceId: string;
  createdAt: string;
  details: unknown;
};
const tabs = [
  "Overview",
  "Businesses",
  "Users",
  "Plans",
  "Configuration",
  "Audit logs",
] as const;
type Tab = (typeof tabs)[number];
const emptyPlan: PlanValues = {
  name: "New plan",
  monthlyPaise: 99900,
  yearlyPaise: 999000,
  maxNumbers: 1,
  maxMembers: 1,
  maxContacts: 1000,
  maxBots: 5,
  archived: false,
};
export default function Admin() {
  const me = useIdentity(),
    client = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview"),
    [search, setSearch] = useState(""),
    [draftSearch, setDraftSearch] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const enabled = me.user.platformAdmin,
    query = `?page=${page}&limit=20&search=${encodeURIComponent(search)}`;
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api<Record<string, number>>("/admin/overview"),
    enabled: enabled && tab === "Overview",
  });
  const businesses = useQuery({
    queryKey: ["admin", "businesses", page, search],
    queryFn: () => api<PageResult<Business>>("/admin/tenants" + query),
    enabled: enabled && tab === "Businesses",
  });
  const users = useQuery({
    queryKey: ["admin", "users", page, search],
    queryFn: () => api<PageResult<User>>("/admin/users" + query),
    enabled: enabled && tab === "Users",
  });
  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => api<PlanRecord[]>("/admin/plans"),
    enabled: enabled && tab === "Plans",
  });
  const audits = useQuery({
    queryKey: ["admin", "audits", page, search],
    queryFn: () => api<PageResult<Audit>>("/admin/audit-logs" + query),
    enabled: enabled && tab === "Audit logs",
  });
  const branding = useBranding();
  async function mutate(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["admin"] });
      await client.invalidateQueries({ queryKey: ["branding"] });
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }
  if (!enabled)
    return (
      <Alert>
        Platform administrator access is required. Business owner accounts do
        not have platform access.
      </Alert>
    );
  const result =
    tab === "Businesses"
      ? businesses
      : tab === "Users"
        ? users
        : tab === "Audit logs"
          ? audits
          : null;
  const queryError =
    tab === "Overview"
      ? overview.error
      : tab === "Plans"
        ? plans.error
        : tab === "Configuration"
          ? branding.error
          : result?.error;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
          Platform management
        </p>
        <h1 className="mt-2 text-3xl font-bold">Administration</h1>
        <p className="mt-2 text-slate-500">
          Manage businesses and platform settings. Changes are recorded in the
          audit log.
        </p>
      </div>
      <nav
        aria-label="Administration sections"
        className="flex flex-wrap gap-2"
      >
        {tabs.map((item) => (
          <Button
            key={item}
            variant={tab === item ? "default" : "outline"}
            onClick={() => {
              setTab(item);
              setPage(1);
              setSearch("");
              setDraftSearch("");
              setError("");
              setNotice("");
            }}
          >
            {item}
          </Button>
        ))}
      </nav>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p role="status" className="text-green-700">
          {notice}
        </p>
      )}
      {queryError && <Alert>{queryError.message}</Alert>}
      {tab === "Overview" && (
        <>
          {overview.isPending ? (
            <p role="status">Loading platform totals…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {Object.entries(overview.data ?? {}).map(([name, value]) => (
                <Card key={name}>
                  <h2 className="text-sm capitalize text-slate-500">
                    {name.replace(/([A-Z])/g, " $1")}
                  </h2>
                  <p className="mt-2 text-3xl font-semibold">
                    {value.toLocaleString("en-IN")}
                  </p>
                </Card>
              ))}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Counts come from stored records. Pending jobs are not a worker
            uptime check. Live Meta delivery, billing collection and campaigns
            are not available in this release.
          </p>
        </>
      )}
      {result && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(draftSearch);
              setPage(1);
            }}
          >
            <Input
              aria-label={`Search ${tab.toLowerCase()}`}
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              maxLength={100}
            />
            <Button>Search</Button>
          </form>
          {result.isPending && <p role="status">Loading records…</p>}
          {result.data?.total === 0 && <Card>No matching records.</Card>}
          {tab === "Businesses" &&
            businesses.data?.items.map((business) => (
              <Card key={business.id}>
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{business.name}</h2>
                    <p className="text-sm text-slate-500">
                      {business.suspendedAt ? "Suspended" : "Active"} ·{" "}
                      {business._count.memberships} members ·{" "}
                      {business._count.contacts} contacts ·{" "}
                      {business._count.conversations} conversations
                    </p>
                  </div>
                </div>
                <form
                  className="mt-4 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const reason = String(
                      new FormData(e.currentTarget).get("reason"),
                    );
                    if (
                      !window.confirm(
                        `${business.suspendedAt ? "Reactivate" : "Suspend"} ${business.name}? Suspension signs out this workspace’s sessions.`,
                      )
                    )
                      return;
                    void mutate(
                      () =>
                        api(`/admin/tenants/${business.id}/status`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            suspended: !business.suspendedAt,
                            reason,
                          }),
                        }),
                      business.suspendedAt
                        ? "Business reactivated. Members can sign in again."
                        : "Business suspended and sessions revoked.",
                    );
                  }}
                >
                  <Input
                    className="max-w-lg"
                    name="reason"
                    aria-label={`Reason for ${business.name}`}
                    placeholder="Reason for this access change"
                    required
                    minLength={3}
                    maxLength={500}
                  />
                  <Button
                    disabled={busy}
                    variant={business.suspendedAt ? "outline" : "destructive"}
                  >
                    {business.suspendedAt ? "Reactivate" : "Suspend"}
                  </Button>
                </form>
                <SubscriptionEditor tenantId={business.id} />
              </Card>
            ))}
          {tab === "Users" &&
            users.data?.items.map((user) => (
              <Card key={user.id}>
                <h2 className="font-semibold">{user.name}</h2>
                <p>{user.email}</p>
                <p className="text-sm text-slate-500">
                  {user.platformAdmin
                    ? "Platform administrator"
                    : "Workspace user"}
                </p>
              </Card>
            ))}
          {tab === "Audit logs" &&
            audits.data?.items.map((audit) => (
              <Card key={audit.id}>
                <h2 className="font-semibold">{audit.action}</h2>
                <p className="break-all text-xs text-slate-500">
                  {new Date(audit.createdAt).toLocaleString("en-IN", {
                    timeZone: me.tenant.timezone,
                  })}{" "}
                  · Actor {audit.actorId} · Resource {audit.resourceId}
                </p>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(audit.details, null, 2)}
                </pre>
              </Card>
            ))}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={!result.data || page * 20 >= result.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
      {tab === "Plans" && (
        <>
          <Card>
            <h2 className="font-semibold">Commercial plan catalogue</h2>
            <p className="mt-2 text-sm text-slate-500">
              Prices and limits are saved here. Assign a manual access grant
              under Businesses to enforce contact, chatbot and team limits.
              Existing grants retain their snapshot until reassigned. Payments
              are not implemented; editing a plan never charges a customer.
            </p>
          </Card>
          {plans.isPending && <p role="status">Loading plans…</p>}
          <PlanForm
            key="new"
            busy={busy}
            save={(values) =>
              mutate(() => post("/admin/plans", values), "Plan created.")
            }
          />
          {plans.data?.map((plan) => (
            <PlanForm
              key={`${plan.id}:${plan.revision}`}
              plan={plan}
              busy={busy}
              save={(values) =>
                mutate(
                  () =>
                    api(`/admin/plans/${plan.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        ...values,
                        revision: plan.revision,
                      }),
                    }),
                  "Plan saved.",
                )
              }
            />
          ))}
        </>
      )}
      {tab === "Configuration" && branding.data && (
        <ConfigurationForm
          key={branding.data.revision}
          value={branding.data}
          busy={busy}
          save={(value) =>
            mutate(
              () =>
                api("/admin/configuration", {
                  method: "PATCH",
                  body: JSON.stringify(value),
                }),
              "Brand configuration saved.",
            )
          }
        />
      )}
    </div>
  );
}
function PlanForm({
  plan,
  busy,
  save,
}: {
  plan?: PlanRecord;
  busy: boolean;
  save: (values: PlanValues) => Promise<void>;
}) {
  const initial = plan ?? emptyPlan;
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">
        {plan ? plan.name : "Add a plan"}
      </h2>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void save({
            name: String(form.get("name")),
            monthlyPaise: Math.round(Number(form.get("monthly")) * 100),
            yearlyPaise: Math.round(Number(form.get("yearly")) * 100),
            maxNumbers: Number(form.get("maxNumbers")),
            maxMembers: Number(form.get("maxMembers")),
            maxContacts: Number(form.get("maxContacts")),
            maxBots: Number(form.get("maxBots")),
            archived: form.get("archived") === "on",
          });
        }}
      >
        <label>
          Plan name
          <Input
            name="name"
            defaultValue={initial.name}
            required
            maxLength={60}
          />
        </label>
        <label>
          Monthly price (INR)
          <Input
            name="monthly"
            type="number"
            min={0}
            step="0.01"
            defaultValue={initial.monthlyPaise / 100}
            required
          />
        </label>
        <label>
          Yearly price (INR)
          <Input
            name="yearly"
            type="number"
            min={0}
            step="0.01"
            defaultValue={initial.yearlyPaise / 100}
            required
          />
        </label>
        {(
          [
            ["maxNumbers", "WhatsApp numbers"],
            ["maxMembers", "Team members"],
            ["maxContacts", "Contacts"],
            ["maxBots", "Chatbots"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              name={key}
              type="number"
              min={1}
              step={1}
              defaultValue={initial[key]}
              required
            />
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="archived"
            defaultChecked={initial.archived}
          />
          Archived
        </label>
        <Button disabled={busy}>{plan ? "Save plan" : "Create plan"}</Button>
      </form>
    </Card>
  );
}
function ConfigurationForm({
  value,
  busy,
  save,
}: {
  value: PlatformConfiguration;
  busy: boolean;
  save: (value: PlatformConfiguration) => Promise<void>;
}) {
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">Brand and support</h2>
      <form
        className="max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void save({
            brandName: String(form.get("brandName")),
            primaryColor: String(form.get("primaryColor")),
            supportEmail: String(form.get("supportEmail")),
            revision: value.revision,
          });
        }}
      >
        <label className="block">
          Product name
          <Input
            name="brandName"
            defaultValue={value.brandName}
            required
            maxLength={60}
          />
        </label>
        <label className="block">
          Primary colour
          <Input
            name="primaryColor"
            type="color"
            defaultValue={value.primaryColor}
            required
          />
        </label>
        <label className="block">
          Support email
          <Input
            name="supportEmail"
            type="email"
            defaultValue={value.supportEmail}
            required
          />
        </label>
        <p className="text-sm text-slate-500">
          Updates the navigation name, primary blue accent, and support link.
          Email sender settings and legal content require separate setup.
        </p>
        <Button disabled={busy}>Save configuration</Button>
      </form>
    </Card>
  );
}
