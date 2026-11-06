"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { tenantSchema, canManage } from "@portalflow/shared";
import { Button, Input, Card, Alert } from "@portalflow/ui";
import { useIdentity } from "../../../components/workspace";
import { api, post } from "../../../lib/api";
export default function Settings() {
  const me = useIdentity(),
    client = useQueryClient();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<z.infer<typeof tenantSchema>>({
    resolver: zodResolver(tenantSchema),
    values: {
      name: me.tenant.name,
      timezone: me.tenant.timezone,
      language: me.tenant.language as "en" | "ta" | "hi",
    },
  });
  return (
    <>
      <h1 className="mb-8 text-3xl font-bold">Workspace settings</h1>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p role="status" className="mb-4 text-green-700">
          {notice}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-6 text-lg font-semibold">Business profile</h2>
          <form
            className="space-y-5"
            onSubmit={handleSubmit(async (values) => {
              setError("");
              try {
                await api("/tenants/current", {
                  method: "PATCH",
                  body: JSON.stringify(values),
                });
                await client.invalidateQueries();
                setNotice("Workspace updated.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Update failed");
              }
            })}
          >
            <div>
              <label htmlFor="business-name">Workspace name</label>
              <Input
                id="business-name"
                {...register("name")}
                disabled={!canManage(me.role)}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>
            <div>
              <label htmlFor="timezone">Timezone</label>
              <Input
                id="timezone"
                {...register("timezone")}
                disabled={!canManage(me.role)}
              />
              {errors.timezone && (
                <p className="text-sm text-red-600">
                  {errors.timezone.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="language">Preferred language</label>
              <select
                id="language"
                className="input"
                {...register("language")}
                disabled={!canManage(me.role)}
              >
                <option value="en">English</option>
                <option value="ta">Tamil (translation pending)</option>
                <option value="hi">Hindi (translation pending)</option>
              </select>
            </div>
            <p className="text-sm text-slate-500">
              Default currency: {me.tenant.currency}
            </p>
            {canManage(me.role) && (
              <Button disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            )}
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 text-lg font-semibold">
            Create another workspace
          </h2>
          <p className="mb-6 text-sm text-slate-500">
            Workspaces have independent memberships and settings.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await post("/tenants", { name });
                setName("");
                await client.invalidateQueries({ queryKey: ["workspaces"] });
                setNotice(
                  "Workspace created. Select it in the workspace switcher.",
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "Create failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="new-workspace">New workspace name</label>
            <Input
              id="new-workspace"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button className="mt-4" disabled={busy}>
              Create workspace
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
