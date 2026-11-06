"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Flow,
  FlowNode,
  NodeKind,
  nodeKinds,
  makeNode,
  flowSchema,
  flowTemplates,
  validateFlow,
  MessageRecord,
  PageResult,
  Member,
} from "@portalflow/shared";
import { Button, Input, Alert } from "@portalflow/ui";
import {
  Save,
  Play,
  Upload,
  Download,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Workflow,
} from "lucide-react";
import { api, post } from "../lib/api";
import { useIdentity } from "./workspace";
import { MediaLink } from "./media-link";
type CanvasNode = Node<FlowNode["data"], NodeKind>;
type Bot = {
  id: string;
  name: string;
  draft: Flow;
  revision: number;
  priority: number;
  publishedVersion: number | null;
};
type Execution = {
  id: string;
  status: string;
  conversationId: string;
  currentNode: string;
  steps: number;
  wakeAt: string | null;
  waitExpiresAt: string | null;
  variables: Record<string, string>;
  logs: Array<{
    nodeId?: string;
    type?: string;
    state?: string;
    branch?: boolean;
    optionId?: string;
  }>;
  error: string | null;
  contact: { phone: string; name: string };
};
const labels: Record<NodeKind, string> = {
  start: "Start trigger",
  text: "Send text",
  send_image: "Send image",
  send_document: "Send document",
  ask: "Ask a question",
  save_input: "Save user input",
  buttons: "Reply buttons",
  list: "Interactive list",
  delay: "Delay",
  condition: "Condition",
  keyword_match: "Keyword match",
  set_variable: "Set variable",
  apply_tag: "Apply tag",
  remove_tag: "Remove tag",
  create_lead: "Create lead",
  assign_agent: "Assign agent",
  http_request: "HTTP request",
  handoff: "Human handoff",
  end: "End flow",
};
function FlowCard({ data, type, selected }: NodeProps<CanvasNode>) {
  return (
    <div
      className={`w-52 rounded-xl border-2 bg-white p-3 shadow-sm dark:bg-slate-900 ${selected ? "border-blue-500" : "border-slate-200 dark:border-slate-700"}`}
    >
      {type !== "start" && <Handle type="target" position={Position.Top} />}
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-600">
        <Workflow size={13} />
        {labels[type ?? "text"]}
      </div>
      <p className="text-sm font-semibold">{data.label}</p>
      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
        {data.text || data.mediaUrl || data.url || data.variable || data.value}
      </p>
      {["buttons", "list"].includes(type ?? "") ? (
        <div className="mt-3 space-y-2">
          {(data.options ?? []).map((option) => (
            <div key={option.id} className="relative pr-3 text-xs">
              {option.title}
              <Handle
                type="source"
                position={Position.Right}
                id={`option:${option.id}`}
                style={{ right: -20, top: "50%" }}
              />
            </div>
          ))}
        </div>
      ) : type === "condition" ||
        type === "keyword_match" ||
        type === "http_request" ? (
        <>
          <span className="absolute -bottom-5 left-4 text-xs text-green-600">
            {type === "keyword_match"
              ? "match"
              : type === "http_request"
                ? "success"
                : "true"}
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{ left: "25%" }}
          />
          <span className="absolute -bottom-5 right-4 text-xs text-red-500">
            {type === "keyword_match"
              ? "no match"
              : type === "http_request"
                ? "failure"
                : "false"}
          </span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: "75%" }}
          />
        </>
      ) : (
        !["end", "handoff"].includes(type ?? "") && (
          <Handle type="source" position={Position.Bottom} />
        )
      )}
    </div>
  );
}
const nodeTypes = Object.fromEntries(nodeKinds.map((kind) => [kind, FlowCard]));
function toFlow(nodes: CanvasNode[], edges: Edge[]): Flow {
  return {
    schemaVersion: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type ?? "text",
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    })),
  };
}
function sender() {
  return `+1555${String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10000000).padStart(7, "0")}`;
}
export function FlowBuilder({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <Editor id={id} />
    </ReactFlowProvider>
  );
}
function Editor({ id }: { id: string }) {
  const me = useIdentity(),
    client = useQueryClient(),
    canvas = useReactFlow();
  const editable = ["OWNER", "ADMIN", "MANAGER"].includes(me.role);
  const bot = useQuery({
    queryKey: ["bot", me.tenant.id, id],
    queryFn: () => api<Bot>(`/bots/${id}`),
  });
  const [nodes, setNodes] = useState<CanvasNode[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [name, setName] = useState(""),
    [selected, setSelected] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [published, setPublished] = useState<number | null>(null),
    [template, setTemplate] = useState("Quotation Request Bot"),
    [version, setVersion] = useState(""),
    [simPhone, setSimPhone] = useState(""),
    [input, setInput] = useState(""),
    [testing, setTesting] = useState(false),
    [showSim, setShowSim] = useState(false);
  const revision = useRef(1),
    initialized = useRef(false),
    savingNow = useRef(false),
    history = useRef<Flow[]>([]),
    future = useRef<Flow[]>([]),
    importInput = useRef<HTMLInputElement>(null);
  const graph = useMemo(() => toFlow(nodes, edges), [nodes, edges]);
  const snapshot = useRef({ graph, name });
  snapshot.current = { graph, name };
  const versions = useQuery({
    queryKey: ["versions", id],
    queryFn: () =>
      api<Array<{ id: string; number: number; data: Flow; createdAt: string }>>(
        `/bots/${id}/versions`,
      ),
    enabled: !!bot.data,
  });
  const executions = useQuery({
    queryKey: ["executions", id],
    queryFn: () => api<Execution[]>(`/bots/${id}/executions`),
    enabled: !!bot.data && showSim,
    refetchInterval: showSim ? 1500 : false,
  });
  const members = useQuery({
    queryKey: ["members", me.tenant.id],
    queryFn: () => api<Member[]>("/tenants/members"),
    enabled: !!bot.data,
  });
  const execution = executions.data?.find((e) => e.contact.phone === simPhone);
  const messages = useQuery({
    queryKey: ["sim-messages", execution?.conversationId],
    queryFn: () =>
      api<PageResult<MessageRecord>>(
        `/conversations/${execution!.conversationId}/messages?limit=100`,
      ),
    enabled: !!execution && showSim,
    refetchInterval: showSim ? 1500 : false,
  });
  useEffect(() => {
    if (bot.data && !initialized.current) {
      initialized.current = true;
      const draft = flowSchema.parse(bot.data.draft);
      setNodes(draft.nodes);
      setEdges(draft.edges);
      setName(bot.data.name);
      revision.current = bot.data.revision;
      setPublished(bot.data.publishedVersion);
      setSimPhone(sender());
    }
  }, [bot.data]);
  function checkpoint() {
    history.current = [...history.current.slice(-49), snapshot.current.graph];
    future.current = [];
  }
  function replace(flow: Flow) {
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelected("");
    setDirty(true);
  }
  const save = useCallback(async () => {
    if (!editable || savingNow.current || !initialized.current) return null;
    savingNow.current = true;
    setSaving(true);
    setError("");
    const current = snapshot.current;
    try {
      const result = await api<Bot>(`/bots/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: current.name,
          draft: current.graph,
          revision: revision.current,
          priority: bot.data?.priority ?? 100,
        }),
      });
      revision.current = result.revision;
      if (JSON.stringify(current) === JSON.stringify(snapshot.current))
        setDirty(false);
      setNotice("Draft saved");
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return null;
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }, [id, editable, bot.data?.priority]);
  useEffect(() => {
    if (!dirty || saving || !editable || error) return;
    const timer = setTimeout(() => void save(), 1400);
    return () => clearTimeout(timer);
  }, [graph, name, dirty, saving, editable, error, save]);
  function changeNodes(changes: NodeChange<CanvasNode>[]) {
    const edits = changes.some(
      (c) => c.type === "remove" || c.type === "position",
    );
    if (edits && !editable) return;
    if (changes.some((c) => c.type === "remove")) checkpoint();
    setNodes((n) => applyNodeChanges(changes, n));
    if (changes.some((c) => c.type === "remove")) {
      const removed = changes
        .filter((c) => c.type === "remove")
        .map((c) => c.id);
      setEdges((es) =>
        es.filter(
          (e) => !removed.includes(e.source) && !removed.includes(e.target),
        ),
      );
    }
    if (edits) setDirty(true);
  }
  function changeEdges(changes: EdgeChange[]) {
    if (!editable) return;
    if (changes.some((c) => c.type === "remove")) checkpoint();
    setEdges((e) => applyEdgeChanges(changes, e));
    if (changes.some((c) => c.type !== "select")) setDirty(true);
  }
  function connect(connection: Connection) {
    if (!editable) return;
    checkpoint();
    setEdges((e) => addEdge({ ...connection, id: crypto.randomUUID() }, e));
    setDirty(true);
  }
  function add(kind: NodeKind, position?: { x: number; y: number }) {
    if (!editable) return;
    checkpoint();
    const node = makeNode(
      crypto.randomUUID(),
      kind,
      position?.x ?? 80,
      position?.y ?? nodes.length * 30,
      { label: labels[kind] },
    );
    setNodes((n) => [...n, node]);
    setSelected(node.id);
    setDirty(true);
  }
  const active = nodes.find((n) => n.id === selected),
    errors = useMemo(() => validateFlow(graph), [graph]);
  function property(
    key: keyof FlowNode["data"],
    value: string | number | FlowNode["data"]["options"],
  ) {
    if (!editable) return;
    checkpoint();
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected ? { ...n, data: { ...n.data, [key]: value } } : n,
      ),
    );
    setDirty(true);
  }
  async function publish() {
    const saved = await save();
    if (!saved) return;
    try {
      const result = await post<{ version: number }>(`/bots/${id}/publish`, {
        revision: saved.revision,
      });
      setPublished(result.version);
      setNotice(`Published version ${result.version}`);
      await client.invalidateQueries({ queryKey: ["versions", id] });
      await client.invalidateQueries({ queryKey: ["bots"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }
  if (bot.isPending) return <p role="status">Loading flow…</p>;
  if (bot.error) return <Alert>{bot.error.message}</Alert>;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/bots" className="text-xs text-blue-600">
            ← All flows
          </Link>
          <Input
            aria-label="Flow name"
            className="mt-2 max-w-sm font-semibold"
            value={name}
            disabled={!editable}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
          <p className="mt-2 text-xs text-slate-500">
            {published ? `Published v${published}` : "Draft only"} ·{" "}
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"} ·
            Published versions never change
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!editable || saving}
            onClick={() => void save()}
          >
            <Save size={15} />
            Save
          </Button>
          <Button variant="outline" onClick={() => setShowSim((v) => !v)}>
            <Play size={15} />
            Test
          </Button>
          <Button
            disabled={!editable || saving || errors.length > 0}
            onClick={() => void publish()}
          >
            Publish
          </Button>
          {published && editable && (
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await post(`/bots/${id}/unpublish`);
                  setPublished(null);
                  setNotice(
                    "Unpublished. Existing sessions keep their pinned version.",
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Unpublish failed");
                }
              }}
            >
              Unpublish
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-3 text-xs text-green-700">
          {notice}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          aria-label="Undo"
          variant="outline"
          disabled={!editable || !history.current.length}
          onClick={() => {
            const last = history.current.pop();
            if (last) {
              future.current.push(graph);
              replace(last);
            }
          }}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          aria-label="Redo"
          variant="outline"
          disabled={!editable || !future.current.length}
          onClick={() => {
            const next = future.current.pop();
            if (next) {
              history.current.push(graph);
              replace(next);
            }
          }}
        >
          <Redo2 size={15} />
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(graph, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "portalflow-flow.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={15} />
          Export JSON
        </Button>
        <Button
          variant="outline"
          disabled={!editable}
          onClick={() => importInput.current?.click()}
        >
          <Upload size={15} />
          Import JSON
        </Button>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 100000)
                throw new Error("Flow file must be smaller than 100 KB");
              const parsed = flowSchema.parse(JSON.parse(await file.text()));
              checkpoint();
              replace(parsed);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Invalid flow JSON");
            } finally {
              if (importInput.current) importInput.current.value = "";
            }
          }}
        />
        <select
          aria-label="Flow template"
          className="input max-w-56 text-xs"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
        >
          {flowTemplates.map((t) => (
            <option key={t.name}>{t.name}</option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!editable}
          onClick={() => {
            if (
              confirm(
                "Replace the draft with this template? Published versions are unchanged.",
              )
            ) {
              checkpoint();
              replace(
                structuredClone(
                  flowTemplates.find((t) => t.name === template)!.flow,
                ),
              );
            }
          }}
        >
          Use template
        </Button>
      </div>
      <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[160px_minmax(250px,1fr)_230px]">
        <aside className="flex flex-wrap gap-2 border-b border-slate-200 p-3 dark:border-slate-800 lg:flex-col lg:border-r lg:border-b-0">
          <h2 className="w-full py-2 text-xs font-semibold uppercase text-slate-500">
            Node library
          </h2>
          {nodeKinds.map((kind) => (
            <button
              key={kind}
              draggable={editable}
              disabled={!editable}
              onDragStart={(e) =>
                e.dataTransfer.setData("application/portalflow-node", kind)
              }
              onClick={() => add(kind)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800"
            >
              {labels[kind]}
            </button>
          ))}
        </aside>
        <div
          style={{ height: 620 }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const kind = e.dataTransfer.getData("application/portalflow-node");
            if (nodeKinds.includes(kind as NodeKind))
              add(
                kind as NodeKind,
                canvas.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
              );
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={changeNodes}
            onEdgesChange={changeEdges}
            onConnect={connect}
            onNodeClick={(_e, node) => setSelected(node.id)}
            onNodeDragStart={() => checkpoint()}
            nodesDraggable={editable}
            nodesConnectable={editable}
            deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
            fitView
            minZoom={0.2}
            maxZoom={2}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <aside className="border-t border-slate-200 p-4 dark:border-slate-800 lg:border-t-0 lg:border-l">
          <h2 className="mb-5 text-xs font-semibold uppercase text-slate-500">
            Node properties
          </h2>
          {active ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="node-label">Label</label>
                <Input
                  id="node-label"
                  value={active.data.label}
                  disabled={!editable}
                  onChange={(e) => property("label", e.target.value)}
                />
              </div>
              {["send_image", "send_document"].includes(active.type ?? "") && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="node-media-url">Media link (https)</label>
                    <Input
                      id="node-media-url"
                      type="url"
                      placeholder="https://example.com/brochure.pdf"
                      value={active.data.mediaUrl}
                      disabled={!editable}
                      onChange={(e) => property("mediaUrl", e.target.value)}
                    />
                    <p className="mt-1 text-[10px] text-slate-500">
                      A public link WhatsApp can download. Uploads are not
                      available yet.
                    </p>
                  </div>
                  {active.type === "send_document" && (
                    <div>
                      <label htmlFor="node-filename">File name shown</label>
                      <Input
                        id="node-filename"
                        placeholder="Price list.pdf"
                        value={active.data.filename}
                        disabled={!editable}
                        onChange={(e) => property("filename", e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
              {[
                "text",
                "ask",
                "buttons",
                "list",
                "handoff",
                "send_image",
                "send_document",
              ].includes(active.type ?? "") && (
                <div>
                  <label htmlFor="node-message">
                    {["send_image", "send_document"].includes(active.type ?? "")
                      ? "Caption (optional)"
                      : "Message"}
                  </label>
                  <textarea
                    id="node-message"
                    className="input min-h-28 text-sm"
                    value={active.data.text}
                    disabled={!editable}
                    onChange={(e) => property("text", e.target.value)}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Use {"{{name}}"} for a captured variable.
                  </p>
                </div>
              )}
              {[
                "ask",
                "save_input",
                "buttons",
                "list",
                "condition",
                "keyword_match",
                "set_variable",
              ].includes(active.type ?? "") && (
                <div>
                  <label htmlFor="node-variable">
                    {active.type === "keyword_match"
                      ? "Check variable"
                      : "Variable"}
                  </label>
                  <Input
                    id="node-variable"
                    value={active.data.variable}
                    disabled={!editable}
                    onChange={(e) => property("variable", e.target.value)}
                  />
                </div>
              )}
              {active.type === "keyword_match" && (
                <p className="-mt-2 text-[10px] text-slate-500">
                  trigger_text holds the message that started the flow.
                </p>
              )}
              {["ask", "save_input"].includes(active.type ?? "") && (
                <div>
                  <label htmlFor="input-type">Answer type</label>
                  <select
                    id="input-type"
                    className="input"
                    value={active.data.inputKind}
                    disabled={!editable}
                    onChange={(e) => property("inputKind", e.target.value)}
                  >
                    {["text", "email", "number"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              {["buttons", "list"].includes(active.type ?? "") && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">
                    Menu options
                  </legend>
                  {(active.data.options ?? []).map((option, index) => (
                    <div
                      key={option.id}
                      className="space-y-1 rounded border p-2"
                    >
                      <label htmlFor={`option-${option.id}`}>
                        Option {index + 1} title
                      </label>
                      <Input
                        id={`option-${option.id}`}
                        value={option.title}
                        maxLength={20}
                        disabled={!editable}
                        onChange={(e) =>
                          property(
                            "options",
                            active.data.options.map((o) =>
                              o.id === option.id
                                ? { ...o, title: e.target.value }
                                : o,
                            ),
                          )
                        }
                      />
                      <p className="text-xs text-slate-500">
                        Value: {option.id}
                      </p>
                      <Button
                        variant="ghost"
                        disabled={!editable}
                        onClick={() =>
                          property(
                            "options",
                            active.data.options.filter(
                              (o) => o.id !== option.id,
                            ),
                          )
                        }
                      >
                        Remove option {index + 1}
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    disabled={
                      !editable ||
                      (active.data.options?.length ?? 0) >=
                        (active.type === "buttons" ? 3 : 10)
                    }
                    onClick={() =>
                      property("options", [
                        ...(active.data.options ?? []),
                        {
                          id: `opt_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
                          title: `Option ${(active.data.options?.length ?? 0) + 1}`,
                        },
                      ])
                    }
                  >
                    Add option
                  </Button>
                  <p className="text-xs text-slate-500">
                    Connect each option handle to its next node. The selected
                    option ID is saved in the variable.
                  </p>
                </fieldset>
              )}
              {active.type === "delay" && (
                <div>
                  <label htmlFor="delay-seconds">Delay (seconds)</label>
                  <Input
                    id="delay-seconds"
                    type="number"
                    min={1}
                    max={604800}
                    step={1}
                    value={active.data.delaySeconds ?? 60}
                    disabled={!editable}
                    onChange={(e) =>
                      property("delaySeconds", Number(e.target.value))
                    }
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    1 second to 7 days. A stored deadline survives restarts.
                    Replies still require an open service window.
                  </p>
                </div>
              )}
              {["ask", "save_input", "buttons", "list"].includes(
                active.type ?? "",
              ) && (
                <div>
                  <label htmlFor="answer-timeout">
                    Answer timeout (seconds)
                  </label>
                  <Input
                    id="answer-timeout"
                    type="number"
                    min={1}
                    max={86400}
                    step={1}
                    value={active.data.timeoutSeconds ?? 86400}
                    disabled={!editable}
                    onChange={(e) =>
                      property("timeoutSeconds", Number(e.target.value))
                    }
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    The worker expires unanswered questions without sending a
                    follow-up.
                  </p>
                </div>
              )}
              {active.type === "condition" && (
                <div>
                  <label htmlFor="operator">Operator</label>
                  <select
                    id="operator"
                    className="input"
                    value={active.data.operator}
                    disabled={!editable}
                    onChange={(e) => property("operator", e.target.value)}
                  >
                    {["equals", "contains", "exists", "gte"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              {active.type === "keyword_match" && (
                <div>
                  <label htmlFor="match-mode">Match mode</label>
                  <select
                    id="match-mode"
                    className="input"
                    value={active.data.operator}
                    disabled={!editable}
                    onChange={(e) => property("operator", e.target.value)}
                  >
                    <option value="contains">Message contains a keyword</option>
                    <option value="equals">Message is exactly a keyword</option>
                  </select>
                </div>
              )}
              {active.type === "http_request" && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="http-url">Address (https)</label>
                    <Input
                      id="http-url"
                      type="url"
                      placeholder="https://hooks.example.com/portalflow"
                      value={active.data.url}
                      disabled={!editable}
                      onChange={(e) => property("url", e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="http-method">Method</label>
                    <select
                      id="http-method"
                      className="input"
                      value={active.data.method}
                      disabled={!editable}
                      onChange={(e) => property("method", e.target.value)}
                    >
                      <option value="POST">
                        POST (sends chosen variables)
                      </option>
                      <option value="GET">GET (sends nothing)</option>
                    </select>
                  </div>
                  {active.data.method === "POST" && (
                    <div>
                      <label htmlFor="http-send">Variables to send</label>
                      <Input
                        id="http-send"
                        placeholder="name, phone, requirement"
                        value={active.data.sendVariables}
                        disabled={!editable}
                        onChange={(e) =>
                          property("sendVariables", e.target.value)
                        }
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="http-field">
                      Response field (optional)
                    </label>
                    <Input
                      id="http-field"
                      placeholder="status"
                      value={active.data.responseField}
                      disabled={!editable}
                      onChange={(e) =>
                        property("responseField", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="http-save">Save result in variable</label>
                    <Input
                      id="http-save"
                      placeholder="order_status"
                      value={active.data.variable}
                      disabled={!editable}
                      onChange={(e) => property("variable", e.target.value)}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Public https addresses only; private networks are blocked.
                    5-second limit, redirects are not followed. Without a
                    response field the HTTP status code is saved. Connect the
                    green success and red failure outputs.
                  </p>
                </div>
              )}
              {active.type === "assign_agent" && (
                <div>
                  <label htmlFor="assign-member">Assign to</label>
                  <select
                    id="assign-member"
                    className="input text-sm"
                    value={active.data.value}
                    disabled={!editable}
                    onChange={(e) => property("value", e.target.value)}
                  >
                    <option value="">Choose a teammate</option>
                    {members.data
                      ?.filter((m) => m.role !== "VIEWER")
                      .map((m) => (
                        <option key={m.user.id} value={m.user.id}>
                          {m.user.name} ({m.role.toLowerCase()})
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-[10px] text-slate-500">
                    The bot keeps running; add Human handoff to pause it.
                  </p>
                </div>
              )}
              {active.type === "start" && (
                <div>
                  <label htmlFor="trigger">Trigger</label>
                  <select
                    id="trigger"
                    className="input text-sm"
                    value={active.data.trigger}
                    disabled={!editable}
                    onChange={(e) => property("trigger", e.target.value)}
                  >
                    <option value="first">First customer message</option>
                    <option value="keyword">Exact keyword</option>
                    <option value="tag_added">Tag added to contact</option>
                    <option value="api">Started by API or teammate</option>
                  </select>
                </div>
              )}
              {([
                "condition",
                "keyword_match",
                "set_variable",
                "apply_tag",
                "remove_tag",
              ].includes(active.type ?? "") ||
                (active.type === "start" &&
                  ["keyword", "tag_added"].includes(active.data.trigger))) && (
                <div>
                  <label htmlFor="node-value">
                    {active.type === "keyword_match"
                      ? "Keywords (comma separated)"
                      : active.type === "start" &&
                          active.data.trigger === "tag_added"
                        ? "Tag"
                        : "Value"}
                  </label>
                  <Input
                    id="node-value"
                    value={active.data.value}
                    disabled={!editable}
                    onChange={(e) => property("value", e.target.value)}
                  />
                </div>
              )}
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label="Duplicate node"
                    variant="outline"
                    onClick={() => {
                      checkpoint();
                      const copy = {
                        ...active,
                        id: crypto.randomUUID(),
                        position: {
                          x: active.position.x + 40,
                          y: active.position.y + 40,
                        },
                        data: {
                          ...active.data,
                          label: `${active.data.label} copy`,
                        },
                      };
                      setNodes((n) => [...n, copy]);
                      setSelected(copy.id);
                      setDirty(true);
                    }}
                  >
                    <Copy size={15} />
                  </Button>
                  <Button
                    aria-label="Delete node"
                    variant="outline"
                    onClick={() => {
                      checkpoint();
                      setNodes((n) => n.filter((v) => v.id !== selected));
                      setEdges((e) =>
                        e.filter(
                          (v) => v.source !== selected && v.target !== selected,
                        ),
                      );
                      setSelected("");
                      setDirty(true);
                    }}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Select a node to edit its behavior. Drag handles to connect nodes.
            </p>
          )}
        </aside>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="mb-2 text-sm font-semibold">Flow validation</h2>
          {errors.length ? (
            <ul className="list-inside list-disc text-xs text-red-600">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-green-700">
              Valid graph · All nodes reachable · No cycles
            </p>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="mb-2 text-sm font-semibold">Version history</h2>
          <div className="flex gap-2">
            <select
              aria-label="Published version"
              className="input text-xs"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">Select an immutable version</option>
              {versions.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.number} · {new Date(v.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!editable || !version}
              onClick={() => {
                checkpoint();
                replace(
                  structuredClone(
                    versions.data!.find((v) => v.id === version)!.data,
                  ),
                );
              }}
            >
              Restore draft
            </Button>
          </div>
        </section>
      </div>
      {showSim && (
        <section className="mt-6 rounded-xl border border-blue-200 bg-white p-5 dark:bg-slate-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Live engine simulator</h2>
              <p className="mt-1 text-xs text-slate-500">
                Tests published v{published ?? "—"} through the real worker.
                Sender: {simPhone}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSimPhone(sender());
                setInput("");
              }}
            >
              Reset test sender
            </Button>
          </div>
          {!published && (
            <p className="mb-3 text-sm text-amber-700">
              Publish the validated draft before testing.
            </p>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="mb-4 max-h-72 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                {messages.data?.items.map((m) => (
                  <p
                    key={m.id}
                    className={`rounded-lg p-2 text-sm ${m.direction === "OUTBOUND" ? "bg-blue-100 text-blue-900" : "bg-white text-slate-700"}`}
                  >
                    <strong className="mr-2 text-xs">
                      {m.direction === "OUTBOUND" ? "Bot" : "Customer"}
                    </strong>
                    {m.media && <MediaLink media={m.media} />}
                    {m.text}
                    {m.interactive && (
                      <span className="mt-2 flex flex-wrap gap-2">
                        {m.interactive.options.map((option) => (
                          <Button
                            key={option.id}
                            variant="outline"
                            disabled={
                              !editable ||
                              testing ||
                              execution?.status !== "WAITING" ||
                              !["SENT", "DELIVERED", "READ"].includes(
                                m.status,
                              ) ||
                              m.idempotencyKey !==
                                `bot:${execution.id}:${execution.currentNode}:${execution.steps}`
                            }
                            onClick={async () => {
                              setTesting(true);
                              setError("");
                              try {
                                await post(`/bots/${id}/simulate`, {
                                  externalId: crypto.randomUUID(),
                                  phone: simPhone,
                                  text: option.title,
                                  reply: {
                                    messageId: m.id,
                                    optionId: option.id,
                                  },
                                });
                                await executions.refetch();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Simulation failed",
                                );
                              } finally {
                                setTesting(false);
                              }
                            }}
                          >
                            {option.title}
                          </Button>
                        ))}
                      </span>
                    )}
                  </p>
                ))}
                {!execution && (
                  <p className="text-sm text-slate-500">
                    Send a customer message to start the published flow.
                  </p>
                )}
              </div>
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setTesting(true);
                  setError("");
                  try {
                    await post(`/bots/${id}/simulate`, {
                      externalId: crypto.randomUUID(),
                      phone: simPhone,
                      text: input,
                    });
                    setInput("");
                    await executions.refetch();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Simulation failed",
                    );
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                <Input
                  aria-label="Simulated customer message"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  required
                  placeholder="Type a customer reply…"
                />
                <Button disabled={!editable || !published || testing}>
                  Send test
                </Button>
              </form>
              {execution && (
                <Link
                  className="mt-3 block text-xs text-blue-600"
                  href="/dashboard/inbox"
                >
                  Open the conversation in Inbox →
                </Link>
              )}
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold">
                Execution: {execution?.status ?? "Not started"}
              </p>
              {(executions.error || messages.error) && (
                <Alert>
                  {executions.error?.message || messages.error?.message}
                </Alert>
              )}
              {execution?.wakeAt && (
                <p className="mb-3 text-xs text-slate-500">
                  Scheduled resume
                  {execution.status === "PAUSED" ? " (paused)" : ""}:{" "}
                  {new Date(execution.wakeAt).toLocaleString("en-IN", {
                    timeZone: me.tenant.timezone,
                  })}
                </p>
              )}
              {execution?.waitExpiresAt && (
                <p className="mb-3 text-xs text-slate-500">
                  Answer deadline:{" "}
                  {new Date(execution.waitExpiresAt).toLocaleString("en-IN", {
                    timeZone: me.tenant.timezone,
                  })}
                </p>
              )}
              {execution?.error && <Alert>{execution.error}</Alert>}
              <h3 className="text-xs font-semibold">Captured variables</h3>
              <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950">
                {JSON.stringify(execution?.variables ?? {}, null, 2)}
              </pre>
              <h3 className="mt-4 text-xs font-semibold">Execution log</h3>
              <div className="mt-2 max-h-32 overflow-auto text-xs text-slate-500">
                {execution?.logs.map((log, i) => (
                  <p key={i}>
                    {log.nodeId}:{" "}
                    {log.optionId
                      ? `selected → ${log.optionId}`
                      : (log.state ?? `branch → ${log.branch}`)}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
