"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Input, Button, Alert } from "@portalflow/ui";
import { Workflow, Plus, ArrowUpRight } from "lucide-react";
import { useIdentity } from "../../../components/workspace";
import { api, post } from "../../../lib/api";
type Bot = {
  id: string;
  name: string;
  publishedVersion: number | null;
  updatedAt: string;
};
export default function Bots() {
  const me = useIdentity(),
    router = useRouter(),
    client = useQueryClient();
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bots = useQuery({
    queryKey: ["bots", me.tenant.id],
    queryFn: () => api<Bot[]>("/bots"),
  });
  const editable = ["OWNER", "ADMIN", "MANAGER"].includes(me.role);
  return (
    <>
      <h1 className="text-3xl font-bold">Chatbot builder</h1>
      <p className="mb-8 mt-3 text-slate-500">
        Turn customer conversations into repeatable, thoughtful workflows.
      </p>
      {(error || bots.error) && <Alert>{error || bots.error?.message}</Alert>}
      {editable && (
        <Card className="mb-8">
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const bot = await post<Bot>("/bots", { name });
                await client.invalidateQueries({ queryKey: ["bots"] });
                router.push(`/dashboard/bots/${bot.id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Create failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="min-w-52 flex-1">
              <label htmlFor="flow-name">New flow name</label>
              <Input
                id="flow-name"
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quotation enquiries"
              />
            </div>
            <Button disabled={busy}>
              <Plus size={16} />
              Create flow
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Start with a working quotation flow, or import one of ten templates
            in the editor.
          </p>
        </Card>
      )}
      {bots.isPending && <p role="status">Loading flows…</p>}
      {bots.data?.length === 0 && (
        <Card>
          <Workflow className="mb-4 text-blue-600" />
          <h2 className="font-semibold">Build your first conversation</h2>
          <p className="mt-2 text-sm text-slate-500">
            Add a flow above to open the visual canvas.
          </p>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {bots.data?.map((bot) => (
          <Link key={bot.id} href={`/dashboard/bots/${bot.id}`}>
            <Card className="transition hover:border-blue-400">
              <div className="flex justify-between">
                <Workflow className="text-blue-600" />
                <ArrowUpRight size={18} />
              </div>
              <h2 className="mt-4 text-lg font-semibold">{bot.name}</h2>
              <p className="mt-2 text-sm text-slate-500">
                {bot.publishedVersion
                  ? `Published · Version ${bot.publishedVersion}`
                  : "Draft · Not running"}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
