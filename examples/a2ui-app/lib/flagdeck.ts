// Server-side glue: reuse FlagDeck's compiled building blocks so the demo runs
// against the very same generator, action resolver, and file store as the MCP
// server. (Build FlagDeck first: `npm run build` in the repo root.)
import { FlagStore } from "../../../dist/store.js";
import { buildPanel, resolveUserAction, type UserAction, type ToolCall, type A2UIMessage } from "../../../dist/a2ui.js";
import { evaluate, type Flag } from "../../../dist/flags.js";

const store = new FlagStore("/tmp/flagdeck-example/flags.json");

let seeded = false;
async function seed(): Promise<void> {
  if (seeded) return;
  seeded = true;
  if ((await store.list()).length > 0) return;
  const ts = new Date().toISOString();
  const base = { rules: [], createdAt: ts, updatedAt: ts };
  await store.upsert({ key: "checkout.new-flow", description: "Redesigned checkout experience", enabled: true, rolloutPercentage: 25, ...base });
  await store.upsert({ key: "search.semantic", description: "Vector search ranking", enabled: false, rolloutPercentage: 0, ...base });
  await store.upsert({ key: "dashboard.dark-mode", description: "", enabled: true, rolloutPercentage: 100, ...base });
}

// Apply a resolved tool call to the store (mirrors the MCP tool handlers).
async function applyToolCall(call: ToolCall): Promise<void> {
  const a = call.arguments as Record<string, unknown>;
  const key = a.key as string | undefined;
  const existing = key ? await store.get(key) : undefined;
  const now = new Date().toISOString();
  switch (call.tool) {
    case "create_flag":
      if (existing || !key) return;
      await store.upsert({ key, description: (a.description as string) ?? "", enabled: !!a.enabled, rolloutPercentage: (a.rolloutPercentage as number) ?? 0, rules: (a.rules as Flag["rules"]) ?? [], createdAt: now, updatedAt: now });
      return;
    case "toggle_flag":
      if (existing) await store.upsert({ ...existing, enabled: a.enabled as boolean, updatedAt: now });
      return;
    case "update_flag":
      if (existing) await store.upsert({ ...existing, ...("rolloutPercentage" in a ? { rolloutPercentage: a.rolloutPercentage as number } : {}), ...("rules" in a ? { rules: a.rules as Flag["rules"] } : {}), updatedAt: now });
      return;
    case "delete_flag":
      if (key) await store.delete(key);
      return;
  }
}

export async function getBundle() {
  await seed();
  return buildPanel(await store.list());
}

export async function applyAction(action: UserAction, ui: { newKey?: string }) {
  await seed();
  const flags = await store.list();
  const resolved = resolveUserAction(action, { flags, ui });
  if (resolved) await applyToolCall(resolved);
  return { resolved, bundle: buildPanel(await store.list()) };
}

// --- Chat agent tools -------------------------------------------------------
// Executes a tool the LLM called. Returns text for the model plus, when the
// tool draws UI, an A2UI bundle for the client to render inline.
export async function executeChatTool(
  name: string,
  input: Record<string, unknown> | null | undefined
): Promise<{ text: string; bundle?: A2UIMessage[] }> {
  await seed();
  const args = input && typeof input === "object" ? input : {};
  const now = new Date().toISOString();
  const key = args.key as string | undefined;

  switch (name) {
    case "list_flags": {
      const flags = await store.list();
      return { text: JSON.stringify(flags.map((f) => ({ key: f.key, enabled: f.enabled, rolloutPercentage: f.rolloutPercentage, rules: f.rules.length }))) };
    }
    case "create_flag": {
      if (!key) return { text: "error: key is required" };
      if (await store.get(key)) return { text: `error: flag "${key}" already exists` };
      await store.upsert({ key, description: (args.description as string) ?? "", enabled: !!args.enabled, rolloutPercentage: (args.rolloutPercentage as number) ?? 0, rules: [], createdAt: now, updatedAt: now });
      return { text: `created "${key}"` };
    }
    case "update_flag": {
      const existing = key ? await store.get(key) : undefined;
      if (!existing) return { text: `error: flag "${key}" not found` };
      await store.upsert({ ...existing, ...("rolloutPercentage" in args ? { rolloutPercentage: args.rolloutPercentage as number } : {}), ...("enabled" in args ? { enabled: args.enabled as boolean } : {}), updatedAt: now });
      return { text: `updated "${key}"` };
    }
    case "toggle_flag": {
      const existing = key ? await store.get(key) : undefined;
      if (!existing) return { text: `error: flag "${key}" not found` };
      await store.upsert({ ...existing, enabled: !!args.enabled, updatedAt: now });
      return { text: `${args.enabled ? "enabled" : "disabled"} "${key}"` };
    }
    case "delete_flag": {
      const ok = key ? await store.delete(key) : false;
      return { text: ok ? `deleted "${key}"` : `error: flag "${key}" not found` };
    }
    case "evaluate_flag": {
      const f = key ? await store.get(key) : undefined;
      if (!f) return { text: `error: flag "${key}" not found` };
      const r = evaluate(f, { userId: args.userId as string | undefined, attributes: args.attributes as Record<string, string | number | boolean> | undefined });
      return { text: JSON.stringify(r) };
    }
    case "show_flag_panel": {
      const flags = await store.list();
      return { text: `Displayed the interactive flag panel (${flags.length} flag${flags.length === 1 ? "" : "s"}).`, bundle: buildPanel(flags) };
    }
    default:
      return { text: `error: unknown tool ${name}` };
  }
}
