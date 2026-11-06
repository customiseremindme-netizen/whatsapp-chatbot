"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContactRecord, PageResult } from "@portalflow/shared";
import { Card, Input, Button, Alert } from "@portalflow/ui";
import { Plus, Search, Users } from "lucide-react";
import { useIdentity } from "../../../components/workspace";
import { api, post } from "../../../lib/api";
export default function Contacts() {
  const me = useIdentity(),
    client = useQueryClient();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<ContactRecord | null>(null),
    [showForm, setShowForm] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [company, setCompany] = useState(""),
    [tags, setTags] = useState(""),
    [notes, setNotes] = useState("");
  const contacts = useQuery({
    queryKey: ["contacts", me.tenant.id, page, search],
    queryFn: () =>
      api<PageResult<ContactRecord>>(
        `/contacts?page=${page}&search=${encodeURIComponent(search)}`,
      ),
  });
  const writable = me.role !== "VIEWER";
  function edit(contact: ContactRecord | null) {
    setEditing(contact);
    setName(contact?.name ?? "");
    setPhone(contact?.phone ?? "");
    setEmail(contact?.email ?? "");
    setCompany(contact?.company ?? "");
    setTags(contact?.tags.join(", ") ?? "");
    setNotes(contact?.notes ?? "");
    setShowForm(true);
    setError("");
  }
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["contacts"] });
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Contacts</h1>
          <p className="mt-2 text-slate-500">
            Keep every customer relationship in context.
          </p>
        </div>
        {writable && (
          <Button onClick={() => edit(null)}>
            <Plus size={17} />
            Add contact
          </Button>
        )}
      </div>
      {(error || contacts.error) && (
        <Alert>{error || contacts.error?.message}</Alert>
      )}
      {notice && (
        <p role="status" className="my-4 text-sm text-green-700">
          {notice}
        </p>
      )}
      {showForm && (
        <Card className="mb-6">
          <h2 className="mb-5 text-lg font-semibold">
            {editing ? "Edit contact" : "New contact"}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const data = {
                  name,
                  email: email || undefined,
                  company,
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  notes,
                };
                if (editing)
                  await api(`/contacts/${editing.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ ...data, email: email || null }),
                  });
                else await post("/contacts", { ...data, phone });
                setShowForm(false);
              }, "Contact saved.");
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div>
              <label htmlFor="contact-name">Name</label>
              <Input
                id="contact-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="contact-phone">Phone (E.164)</label>
              <Input
                id="contact-phone"
                type="tel"
                required
                placeholder="+919876543210"
                value={phone}
                disabled={!!editing}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="contact-email">Email</label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="company">Company</label>
              <Input
                id="company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="tags">Tags (comma separated)</label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="contact-notes">Notes</label>
              <Input
                id="contact-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Adding a contact does not record marketing consent.
            </p>
            <div className="flex gap-3">
              <Button disabled={busy}>Save contact</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card>
        <div className="mb-6 flex max-w-md items-center gap-3">
          <Search size={18} className="text-slate-400" />
          <Input
            aria-label="Search contacts"
            placeholder="Search name, phone or email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {contacts.isPending ? (
          <p role="status">Loading contacts…</p>
        ) : contacts.data?.total === 0 ? (
          <div className="py-14 text-center">
            <Users className="mx-auto mb-4 text-slate-300" size={38} />
            <h2 className="font-semibold">
              Your customer directory starts here
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Add a contact or simulate a customer message in the inbox.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-4">Contact</th>
                  <th className="pb-4">Tags</th>
                  <th className="pb-4">Consent</th>
                  <th className="pb-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.data?.items.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    <td className="py-5 pr-5">
                      <p className="font-semibold">{c.name}</p>
                      <p className="mt-1 text-slate-500">{c.phone}</p>
                      <p className="text-xs text-slate-500">{c.email}</p>
                    </td>
                    <td>
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="mr-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                        >
                          {t}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span
                        className={
                          c.optedOutAt
                            ? "text-red-600"
                            : c.optedInAt
                              ? "text-green-600"
                              : "text-slate-500"
                        }
                      >
                        {c.optedOutAt
                          ? "Opted out"
                          : c.optedInAt
                            ? "Opted in"
                            : "Not recorded"}
                      </span>
                    </td>
                    <td>
                      {writable && (
                        <div className="flex gap-1">
                          <Button variant="ghost" onClick={() => edit(c)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              const source = prompt(
                                "Record consent evidence/source (only if this person actually opted in), or type OPT OUT to suppress messages:",
                              );
                              if (!source) return;
                              void action(
                                () =>
                                  post(`/contacts/${c.id}/consent`, {
                                    optedIn: source !== "OPT OUT",
                                    source,
                                  }),
                                "Consent updated.",
                              );
                            }}
                          >
                            Consent
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              if (
                                confirm(
                                  `Archive ${c.name}? Their history will be retained, and future sends suppressed.`,
                                )
                              )
                                void action(
                                  () =>
                                    api(`/contacts/${c.id}`, {
                                      method: "DELETE",
                                    }),
                                  "Contact archived.",
                                );
                            }}
                          >
                            Archive
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {contacts.data?.total ?? 0} contacts · Page {page}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!contacts.data || page * 25 >= contacts.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
