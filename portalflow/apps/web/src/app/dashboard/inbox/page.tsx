"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "../../../lib/socket";
import {
  ConversationRecord,
  MessageRecord,
  Member,
  PageResult,
} from "@portalflow/shared";
import { Button, Input, Alert } from "@portalflow/ui";
import {
  MessageSquare,
  Send,
  FlaskConical,
  UserRound,
  CheckCheck,
} from "lucide-react";
import { api, post } from "../../../lib/api";
import { useIdentity } from "../../../components/workspace";
type Note = { id: string; text: string; createdAt: string };
export default function Inbox() {
  const me = useIdentity(),
    client = useQueryClient();
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [assignee, setAssignee] = useState(""),
    [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [historySearch, setHistorySearch] = useState(""),
    [text, setText] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [simulate, setSimulate] = useState(false),
    [phone, setPhone] = useState(""),
    [incoming, setIncoming] = useState(""),
    [live, setLive] = useState(false);
  const writable = me.role !== "VIEWER";
  const list = useQuery({
    queryKey: ["inbox", me.tenant.id, search, status, assignee, page],
    queryFn: () =>
      api<PageResult<ConversationRecord>>(
        `/conversations?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}${assignee ? `&assignedUserId=${assignee}` : ""}`,
      ),
    refetchInterval: 10000,
  });
  const conversation = useQuery({
    queryKey: ["conversation", me.tenant.id, selected],
    queryFn: () => api<ConversationRecord>(`/conversations/${selected}`),
    enabled: !!selected,
    refetchInterval: 10000,
  });
  const messages = useQuery({
    queryKey: ["messages", me.tenant.id, selected, historyPage, historySearch],
    queryFn: () =>
      api<PageResult<MessageRecord>>(
        `/conversations/${selected}/messages?page=${historyPage}&search=${encodeURIComponent(historySearch)}`,
      ),
    enabled: !!selected,
    refetchInterval: 10000,
  });
  const members = useQuery({
    queryKey: ["members", me.tenant.id],
    queryFn: () => api<Member[]>("/tenants/members"),
  });
  const notes = useQuery({
    queryKey: ["notes", me.tenant.id, selected],
    queryFn: () => api<Note[]>(`/conversations/${selected}/notes`),
    enabled: !!selected,
  });
  useEffect(() => {
    const socket = io(
      process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000",
      { withCredentials: true, transports: ["websocket"] },
    );
    socket.on("ready", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    socket.on("connect_error", () => setLive(false));
    socket.on("inbox.changed", () => {
      for (const key of [
        "inbox",
        "conversation",
        "messages",
        "notes",
        "contacts",
      ])
        void client.invalidateQueries({ queryKey: [key] });
    });
    return () => {
      socket.disconnect();
    };
  }, [me.tenant.id, client]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      for (const key of ["inbox", "conversation", "messages", "notes"])
        await client.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const current = conversation.data;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Team inbox</h1>
          <p className="mt-2 text-sm text-slate-500">
            Mock WhatsApp ·{" "}
            {live ? "Live updates connected" : "Polling every 10 seconds"}
          </p>
        </div>
        {writable && (
          <Button variant="outline" onClick={() => setSimulate((s) => !s)}>
            <FlaskConical size={16} />
            Simulate incoming
          </Button>
        )}
      </div>
      {(error || list.error || conversation.error || messages.error) && (
        <div className="mb-4">
          <Alert>
            {error ||
              list.error?.message ||
              conversation.error?.message ||
              messages.error?.message}
          </Alert>
        </div>
      )}
      {simulate && (
        <form
          className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:bg-slate-900"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await post("/whatsapp/mock/inbound", {
                externalId: crypto.randomUUID(),
                phone,
                text: incoming,
              });
              setIncoming("");
              setSimulate(false);
            });
          }}
        >
          <div>
            <label htmlFor="sim-phone">Customer phone</label>
            <Input
              id="sim-phone"
              placeholder="+919876543210"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="sim-text">Customer message</label>
            <Input
              id="sim-text"
              required
              value={incoming}
              onChange={(e) => setIncoming(e.target.value)}
            />
          </div>
          <Button disabled={busy}>Receive test message</Button>
          <p className="w-full text-xs text-slate-500">
            Requires the dedicated worker. No message is sent to a real phone.
          </p>
        </form>
      )}
      <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:grid-cols-[280px_minmax(280px,1fr)_250px]">
        <aside className="border-b border-slate-200 p-4 dark:border-slate-800 xl:border-r xl:border-b-0">
          <Input
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <div className="my-3 grid grid-cols-2 gap-2">
            <select
              className="input text-xs"
              aria-label="Filter status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
            <select
              className="input text-xs"
              aria-label="Filter agent"
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All agents</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.user.id}>
                  {m.user.name}
                </option>
              ))}
            </select>
          </div>
          {list.isPending && (
            <p role="status" className="py-6 text-sm">
              Loading inbox…
            </p>
          )}
          {list.data?.total === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">
              No conversations yet. Simulate a customer message to begin.
            </p>
          )}
          <div className="max-h-[460px] space-y-2 overflow-y-auto">
            {list.data?.items.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setHistoryPage(1);
                  setHistorySearch("");
                  if (writable)
                    void action(() =>
                      api(`/conversations/${c.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ unread: false }),
                      }),
                    );
                }}
                className={`w-full rounded-xl p-3 text-left ${selected === c.id ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
              >
                <div className="flex justify-between">
                  <span className="text-sm font-semibold">
                    {c.contact.name}
                  </span>
                  {c.unread && (
                    <span className="mt-1 h-2 w-2 rounded-full bg-blue-600" />
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {c.messages[0]?.text ?? "No messages"}
                </p>
                <p className="mt-2 text-[10px] text-slate-400">
                  {c.status} ·{" "}
                  {c.humanTakeover ? "Human takeover" : "No human takeover"}
                </p>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </Button>
            <span className="pt-3 text-xs">Page {page}</span>
            <Button
              variant="ghost"
              disabled={!list.data || page * 25 >= list.data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </Button>
          </div>
        </aside>
        {!current ? (
          <div className="col-span-2 grid place-content-center p-12 text-center text-slate-500">
            <MessageSquare className="mx-auto mb-5 text-blue-400" size={42} />
            <h2 className="font-semibold">Every conversation has a place</h2>
            <p className="mt-2 text-sm">
              Choose a conversation to see its history.
            </p>
          </div>
        ) : (
          <>
            <section className="flex min-w-0 flex-col">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
                <div>
                  <h2 className="font-semibold">{current.contact.name}</h2>
                  <p className="text-xs text-slate-500">
                    {current.contact.phone}
                  </p>
                </div>
                {writable && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          post(
                            `/conversations/${selected}/${current.humanTakeover ? "release" : "takeover"}`,
                          ),
                        )
                      }
                    >
                      {current.humanTakeover ? "Release takeover" : "Take over"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          api(`/conversations/${selected}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              status:
                                current.status === "OPEN" ? "CLOSED" : "OPEN",
                            }),
                          }),
                        )
                      }
                    >
                      {current.status === "OPEN" ? "Close" : "Reopen"}
                    </Button>
                  </div>
                )}
              </header>
              <div className="px-4 pt-3">
                <Input
                  aria-label="Search message history"
                  placeholder="Search message history…"
                  value={historySearch}
                  onChange={(e) => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(1);
                  }}
                />
              </div>
              <div
                className="flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-950/30"
                style={{ maxHeight: 430, minHeight: 260 }}
              >
                {messages.data?.items.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 ${m.direction === "OUTBOUND" ? "bg-blue-600 text-white" : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"}`}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {m.text}
                        {m.interactive && (
                          <span className="mt-2 block text-xs text-slate-500">
                            {m.interactive.kind === "buttons"
                              ? "Reply buttons"
                              : "List options"}
                            :{" "}
                            {m.interactive.options
                              .map((o) => o.title)
                              .join(" · ")}
                          </span>
                        )}
                      </p>
                      <p className="mt-2 flex items-center justify-end gap-1 text-[10px] opacity-70">
                        {new Date(m.createdAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {m.status}
                        {m.status === "DELIVERED" && <CheckCheck size={12} />}
                      </p>
                      {m.error && <p className="mt-1 text-xs">{m.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between px-4 py-2">
                <Button
                  variant="ghost"
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((p) => p - 1)}
                >
                  Newer
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    !messages.data || historyPage * 25 >= messages.data.total
                  }
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Older
                </Button>
              </div>
              <form
                className="border-t border-slate-200 p-4 dark:border-slate-800"
                onSubmit={(e) => {
                  e.preventDefault();
                  const idempotencyKey = crypto.randomUUID();
                  void action(async () => {
                    await post(`/conversations/${selected}/messages`, {
                      text,
                      idempotencyKey,
                    });
                    setText("");
                    setHistoryPage(1);
                  });
                }}
              >
                <div className="flex gap-2">
                  <Input
                    aria-label="Reply message"
                    placeholder={
                      writable ? "Write a reply…" : "Read-only access"
                    }
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    required
                    maxLength={4096}
                    disabled={!writable}
                  />
                  <Button aria-label="Send reply" disabled={!writable || busy}>
                    <Send size={17} />
                  </Button>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Mock delivery. Replies require an open 24-hour service window
                  and enable human takeover.
                </p>
              </form>
            </section>
            <aside className="border-t border-slate-200 p-5 dark:border-slate-800 xl:border-t-0 xl:border-l">
              <UserRound className="mb-3 text-blue-600" />
              <h2 className="font-semibold">Customer details</h2>
              <p className="mt-4 text-sm">{current.contact.name}</p>
              <p className="mt-1 break-all text-xs text-slate-500">
                {current.contact.email ?? current.contact.phone}
              </p>
              <div className="my-3 flex flex-wrap gap-1">
                {current.contact.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="my-3 text-xs text-slate-500">
                {current.contact.optedOutAt
                  ? "Opted out"
                  : current.contact.optedInAt
                    ? "Marketing consent recorded"
                    : "No marketing consent recorded"}
              </p>
              <label htmlFor="assign-agent" className="mt-6">
                Assigned agent
              </label>
              <select
                id="assign-agent"
                className="input text-sm"
                disabled={!writable || busy}
                value={current.assignedUserId ?? ""}
                onChange={(e) =>
                  void action(() =>
                    post(`/conversations/${selected}/assign`, {
                      userId: e.target.value || null,
                    }),
                  )
                }
              >
                <option value="">Unassigned</option>
                {members.data
                  ?.filter((m) => m.role !== "VIEWER")
                  .map((m) => (
                    <option key={m.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
              </select>
              <h3 className="mt-7 text-sm font-semibold">Internal notes</h3>
              {writable && (
                <form
                  className="mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await post(`/conversations/${selected}/notes`, {
                        text: note,
                      });
                      setNote("");
                    });
                  }}
                >
                  <Input
                    aria-label="Internal note"
                    required
                    maxLength={4000}
                    placeholder="Add context for your team…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button className="mt-2" variant="outline" disabled={busy}>
                    Add note
                  </Button>
                </form>
              )}
              {notes.error && <Alert>{notes.error.message}</Alert>}
              {notes.data?.map((n) => (
                <p
                  key={n.id}
                  className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-950"
                >
                  {n.text}
                </p>
              ))}
            </aside>
          </>
        )}
      </div>
    </>
  );
}
