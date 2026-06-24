import type { Flag } from "./flags.js";

/**
 * A2UI (Agent-to-UI) declarative panel for FlagDeck.
 *
 * Instead of shipping ready-made HTML (see ui.ts), this module emits the
 * declarative A2UI JSON format: the agent describes *surfaces*, *components* and
 * a *data model*, and an A2UI renderer (Lit / Angular / Flutter — React on the
 * 2026 roadmap) turns it into native UI. User interaction comes back as
 * `userAction` events (button events) or data-model updates (bound inputs),
 * which `resolveUserAction` maps to the matching MCP tool call.
 *
 * Format target: A2UI v0.9.1, basic catalog.
 * https://a2ui.org · catalog: https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json
 */

export const A2UI_VERSION = "v0.9.1";
export const SURFACE_ID = "flagdeck";
export const CATALOG_ID =
  "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json";
export const A2UI_MIME = "application/vnd.a2ui+json";

/** A value that is either a literal or a binding to a data-model path. */
export type Dynamic<T> = T | { path: string };

export interface Component {
  id: string;
  component: string;
  child?: string;
  children?: string[];
  text?: Dynamic<string>;
  label?: Dynamic<string>;
  value?: Dynamic<string | number | boolean>;
  variant?: string;
  min?: number;
  max?: number;
  justify?: string;
  align?: string;
  /** Button action; its event.name (plus context) is sent back to the agent. */
  action?: { event: { name: string; [k: string]: unknown } };
}

export interface A2UIMessage {
  version: string;
  createSurface?: { surfaceId: string; catalogId: string };
  updateDataModel?: { surfaceId: string; path: string; value: unknown };
  updateComponents?: { surfaceId: string; root: string; components: Component[] };
}

function rulesSummary(flag: Flag): string {
  if (flag.rules.length === 0) return "No targeting rules.";
  return flag.rules
    .map((r, i) => {
      const conds = r.conditions
        .map((c) => `${c.attribute} ${c.operator} ${JSON.stringify(c.values)}`)
        .join(" AND ");
      return `#${i + 1} ${conds} → serve ${r.serve}`;
    })
    .join("\n");
}

/**
 * Builds the full A2UI message bundle that renders the flags panel:
 *   1. createSurface   — declare the canvas + component catalog
 *   2. updateDataModel — push the flags + transient UI state
 *   3. updateComponents — the component tree, bound to the data model
 */
export function buildPanel(flags: Flag[]): A2UIMessage[] {
  const components: Component[] = [];
  const rootChildren: string[] = [];

  components.push({
    id: "title",
    component: "Text",
    variant: "h2",
    text: `🚩 FlagDeck — ${flags.length} ${flags.length === 1 ? "flag" : "flags"}`,
  });
  rootChildren.push("title");

  // "New flag" row: a key field bound to /ui/newKey + a create button.
  components.push({ id: "new-key", component: "TextField", label: "New flag key", value: { path: "/ui/newKey" } });
  components.push({ id: "create-label", component: "Text", text: "Create flag" });
  components.push({
    id: "create",
    component: "Button",
    variant: "primary",
    child: "create-label",
    action: { event: { name: "create_flag" } },
  });
  components.push({ id: "new-row", component: "Row", align: "end", justify: "start", children: ["new-key", "create"] });
  rootChildren.push("new-row");

  flags.forEach((flag, i) => {
    const k = flag.key;
    const enabledId = `enabled:${k}`;
    const deleteLabelId = `delete-label:${k}`;
    const deleteId = `delete:${k}`;
    const controlsId = `controls:${k}`;
    const keyId = `key:${k}`;
    const descId = `desc:${k}`;
    const rolloutId = `rollout:${k}`;
    const rulesId = `rules:${k}`;
    const colId = `col:${k}`;
    const cardId = `card:${k}`;

    components.push({ id: keyId, component: "Text", variant: "h4", text: k });

    const colChildren: string[] = [keyId];
    if (flag.description) {
      components.push({ id: descId, component: "Text", variant: "caption", text: flag.description });
      colChildren.push(descId);
    }

    // Bound CheckBox (master switch) — change emits a data-model update.
    components.push({
      id: enabledId,
      component: "CheckBox",
      label: "Enabled",
      value: { path: `/flags/${i}/enabled` },
    });
    // Delete button — emits an explicit event carrying the key.
    components.push({ id: deleteLabelId, component: "Text", text: "Delete" });
    components.push({
      id: deleteId,
      component: "Button",
      variant: "borderless",
      child: deleteLabelId,
      action: { event: { name: "delete_flag", key: k } },
    });
    components.push({
      id: controlsId,
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: [enabledId, deleteId],
    });
    colChildren.push(controlsId);

    // Bound Slider (percentage rollout) — change emits a data-model update.
    components.push({
      id: rolloutId,
      component: "Slider",
      label: "Rollout %",
      value: { path: `/flags/${i}/rolloutPercentage` },
      min: 0,
      max: 100,
    });
    colChildren.push(rolloutId);

    components.push({ id: rulesId, component: "Text", variant: "caption", text: rulesSummary(flag) });
    colChildren.push(rulesId);

    components.push({ id: colId, component: "Column", align: "stretch", children: colChildren });
    components.push({ id: cardId, component: "Card", child: colId });
    rootChildren.push(cardId);
  });

  components.push({ id: "root", component: "Column", align: "stretch", children: rootChildren });

  return [
    { version: A2UI_VERSION, createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: SURFACE_ID,
        path: "/",
        value: { flags, ui: { newKey: "", filter: "" } },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId: SURFACE_ID, root: "root", components } },
  ];
}

/** A normalized user interaction coming back from an A2UI renderer. */
export interface UserAction {
  /** Present for Button interactions. */
  event?: { name: string; [k: string]: unknown };
  /** Present for bound-input interactions: the changed data-model path. */
  path?: string;
  /** The new value for a bound-input interaction. */
  value?: unknown;
}

export interface ToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Closes the A2UI action loop: maps a `userAction` (button event or bound-input
 * data-model update) to the FlagDeck MCP tool that should run. Index-based
 * binding paths are resolved against the current data model (`{ flags }`).
 *
 * Returns null when the action is not actionable (e.g. create with an empty key).
 */
export function resolveUserAction(
  action: UserAction,
  dataModel: { flags?: Flag[]; ui?: { newKey?: string } } = {}
): ToolCall | null {
  // 1. Explicit button events.
  if (action.event) {
    const { name } = action.event;
    if (name === "delete_flag") {
      const key = action.event.key;
      return typeof key === "string" ? { tool: "delete_flag", arguments: { key } } : null;
    }
    if (name === "create_flag") {
      const key = dataModel.ui?.newKey?.trim();
      if (!key) return null;
      return {
        tool: "create_flag",
        arguments: { key, description: "", enabled: false, rolloutPercentage: 0, rules: [] },
      };
    }
    return null;
  }

  // 2. Bound-input changes: /flags/{index}/{field}.
  if (action.path) {
    const m = /^\/flags\/(\d+)\/(enabled|rolloutPercentage)$/.exec(action.path);
    if (!m) return null;
    const idx = Number(m[1]);
    const field = m[2];
    const key = dataModel.flags?.[idx]?.key;
    if (typeof key !== "string") return null;
    if (field === "enabled") {
      return { tool: "toggle_flag", arguments: { key, enabled: Boolean(action.value) } };
    }
    return { tool: "update_flag", arguments: { key, rolloutPercentage: Number(action.value) } };
  }

  return null;
}
