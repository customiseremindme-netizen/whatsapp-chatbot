"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageResult } from "@portalflow/shared";
import { Card, Alert, Button } from "@portalflow/ui";
import { api } from "../../../lib/api";
import { useIdentity } from "../../../components/workspace";
type Lead = {
  id: string;
  status: string;
  values: Record<string, string>;
  contact: { name: string; phone: string };
  createdAt: string;
};
export default function Leads() {
  const me = useIdentity(),
    client = useQueryClient();
  const [page, setPage] = useState(1),
    [error, setError] = useState("");
  const leads = useQuery({
    queryKey: ["leads", me.tenant.id, page],
    queryFn: () => api<PageResult<Lead>>(`/leads?page=${page}`),
  });
  return (
    <>
      <h1 className="text-3xl font-bold">Leads</h1>
      <p className="mb-8 mt-3 text-slate-500">
        Customer details captured by your published workflows.
      </p>
      {(error || leads.error) && <Alert>{error || leads.error?.message}</Alert>}
      <Card>
        {leads.isPending && <p role="status">Loading leads…</p>}
        {leads.data?.total === 0 && (
          <p className="py-12 text-center text-slate-500">
            No leads yet. Add a Create lead node to a published flow.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="pb-4">Contact</th>
                <th className="pb-4">Captured details</th>
                <th className="pb-4">Stage</th>
              </tr>
            </thead>
            <tbody>
              {leads.data?.items.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="py-5 pr-6">
                    <p className="font-semibold">{lead.contact.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {lead.contact.phone}
                    </p>
                  </td>
                  <td className="max-w-md py-4 pr-5">
                    {Object.entries(lead.values).map(([key, value]) => (
                      <p key={key} className="break-words text-xs">
                        <span className="font-semibold">{key}: </span>
                        {value}
                      </p>
                    ))}
                  </td>
                  <td>
                    <select
                      aria-label={`Lead stage for ${lead.contact.name}`}
                      className="input text-xs"
                      value={lead.status}
                      disabled={me.role === "VIEWER"}
                      onChange={async (e) => {
                        try {
                          await api(`/leads/${lead.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ status: e.target.value }),
                          });
                          await client.invalidateQueries({
                            queryKey: ["leads"],
                          });
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "Update failed",
                          );
                        }
                      }}
                    >
                      {[
                        "NEW",
                        "CONTACTED",
                        "QUALIFIED",
                        "QUOTATION_SENT",
                        "FOLLOW_UP",
                        "WON",
                        "LOST",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex justify-between">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="pt-3 text-xs">{leads.data?.total ?? 0} leads</span>
          <Button
            variant="outline"
            disabled={!leads.data || page * 25 >= leads.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </Card>
    </>
  );
}
