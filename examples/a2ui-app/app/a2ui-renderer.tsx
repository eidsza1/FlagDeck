"use client";

import { useEffect, useState, type ReactNode } from "react";

// --- A2UI shapes (minimal, client-side) ------------------------------------
type Dynamic = string | number | boolean | { path: string };
interface Component {
  id: string;
  component: string;
  child?: string;
  children?: string[];
  text?: Dynamic;
  label?: Dynamic;
  value?: Dynamic;
  variant?: string;
  min?: number;
  max?: number;
  justify?: string;
  action?: { event: { name: string; [k: string]: unknown } };
}
type Message = {
  updateDataModel?: { value: Record<string, unknown> };
  updateComponents?: { root: string; components: Component[] };
};
interface UserAction { event?: { name: string; [k: string]: unknown }; path?: string; value?: unknown }
interface LogEntry { action: UserAction; tool: string | null }

const isBinding = (v: Dynamic | undefined): v is { path: string } =>
  typeof v === "object" && v !== null && "path" in v;

function readPath(model: Record<string, unknown>, path: string): unknown {
  return path.split("/").filter(Boolean).reduce<unknown>(
    (acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]),
    model
  );
}

export default function A2UIRenderer({ initialBundle }: { initialBundle?: Message[] }) {
  const [bundle, setBundle] = useState<Message[] | null>(initialBundle ?? null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    if (initialBundle) return; // inline bundle (e.g. from chat) — don't fetch
    fetch("/api/a2ui").then((r) => r.json()).then(setBundle);
  }, [initialBundle]);

  async function sendAction(action: UserAction) {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ui: { newKey } }),
    }).then((r) => r.json());
    setBundle(res.bundle);
    setLog((l) => [{ action, tool: res.resolved ? res.resolved.tool : null }, ...l].slice(0, 12));
    if (action.event?.name === "create_flag") setNewKey("");
  }

  if (!bundle) return <p>Loading A2UI surface…</p>;

  const dataModel = (bundle.find((m) => m.updateDataModel)?.updateDataModel?.value ?? {}) as Record<string, unknown>;
  const uc = bundle.find((m) => m.updateComponents)?.updateComponents;
  if (!uc) return <p>No components.</p>;
  const byId = new Map(uc.components.map((c) => [c.id, c]));

  const dyn = (v: Dynamic | undefined): unknown => (isBinding(v) ? readPath(dataModel, v.path) : v);

  function render(id: string | undefined): ReactNode {
    if (!id) return null;
    const c = byId.get(id);
    if (!c) return null;

    switch (c.component) {
      case "Text":
        return <div key={id} className={`a2-Text ${c.variant ?? "body"}`}>{String(dyn(c.text) ?? "")}</div>;

      case "Row":
        return <div key={id} className={`a2-Row ${c.justify ?? ""}`}>{(c.children ?? []).map(render)}</div>;

      case "Column":
        return <div key={id} className={`a2-Column ${c.justify ?? "stretch"}`}>{(c.children ?? []).map(render)}</div>;

      case "Card":
        return <div key={id} className="a2-Card">{render(c.child)}</div>;

      case "Button":
        return (
          <button key={id} className={`a2-Button ${c.variant ?? "default"}`}
            onClick={() => c.action && sendAction({ event: c.action.event })}>
            {render(c.child)}
          </button>
        );

      case "CheckBox":
        return (
          <label key={id} className="a2-CheckBox">
            <input type="checkbox" checked={Boolean(dyn(c.value))}
              onChange={(e) => isBinding(c.value) && sendAction({ path: c.value.path, value: e.target.checked })} />
            {String(dyn(c.label) ?? "")}
          </label>
        );

      case "Slider": {
        const val = Number(dyn(c.value) ?? 0);
        return (
          <div key={id} className="a2-Slider">
            <label>{String(dyn(c.label) ?? "")}</label>
            <input type="range" min={c.min ?? 0} max={c.max ?? 100} defaultValue={val}
              onChange={(e) => isBinding(c.value) && sendAction({ path: c.value.path, value: Number(e.target.value) })} />
            <span className="val">{val}%</span>
          </div>
        );
      }

      case "TextField": {
        // /ui/* fields are transient client state (e.g. the new-flag key).
        const path = isBinding(c.value) ? c.value.path : "";
        const local = path === "/ui/newKey";
        return (
          <div key={id} className="a2-TextField">
            <label>{String(dyn(c.label) ?? "")}</label>
            <input type="text" value={local ? newKey : String(dyn(c.value) ?? "")}
              placeholder="e.g. billing.v2"
              onChange={(e) => local && setNewKey(e.target.value)} />
          </div>
        );
      }

      default:
        return <div key={id}>[{c.component}]</div>;
    }
  }

  return (
    <div className="layout">
      <div className="surface">{render(uc.root)}</div>
      <aside className="log">
        <h2>userAction → tool</h2>
        {log.length === 0 ? (
          <p className="empty">Interact with the panel — toggle a flag, drag a rollout slider, delete or create one. Each interaction is shown here as it maps to an MCP tool.</p>
        ) : (
          <ol>
            {log.map((e, i) => (
              <li key={i}>
                <code className="action">{e.action.event ? `event ${e.action.event.name}` : `${e.action.path} = ${JSON.stringify(e.action.value)}`}</code>
                <br />
                <span className="arrow">→ </span>
                <code className="tool">{e.tool ?? "(no-op)"}</code>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
