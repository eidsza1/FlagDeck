import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPanel,
  resolveUserAction,
  A2UI_VERSION,
  SURFACE_ID,
  type Component,
} from "../src/a2ui.ts";
import type { Flag } from "../src/flags.ts";

function makeFlag(key: string, over: Partial<Flag> = {}): Flag {
  return {
    key,
    description: "",
    enabled: false,
    rolloutPercentage: 0,
    rules: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const flags: Flag[] = [
  makeFlag("checkout.new-flow", {
    description: "New checkout",
    enabled: true,
    rolloutPercentage: 25,
    rules: [{ conditions: [{ attribute: "plan", operator: "eq", values: ["pro"] }], serve: true }],
  }),
  makeFlag("search.semantic"),
];

test("buildPanel emits the three A2UI messages in order", () => {
  const msgs = buildPanel(flags);
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every((m) => m.version === A2UI_VERSION));
  assert.equal(msgs[0].createSurface?.surfaceId, SURFACE_ID);
  assert.equal(msgs[1].updateDataModel?.surfaceId, SURFACE_ID);
  assert.equal(msgs[2].updateComponents?.surfaceId, SURFACE_ID);
});

test("data model carries the flags and transient ui state", () => {
  const dm = buildPanel(flags)[1].updateDataModel!.value as { flags: Flag[]; ui: unknown };
  assert.equal(dm.flags.length, 2);
  assert.deepEqual(dm.ui, { newKey: "", filter: "" });
});

test("component tree has a root and one card per flag", () => {
  const uc = buildPanel(flags)[2].updateComponents!;
  assert.equal(uc.root, "root");
  const ids = new Set(uc.components.map((c) => c.id));
  assert.ok(ids.has("card:checkout.new-flow"));
  assert.ok(ids.has("card:search.semantic"));
  // every referenced child/children id must exist (no dangling references)
  const byId = new Map(uc.components.map((c) => [c.id, c]));
  for (const c of uc.components) {
    if (c.child) assert.ok(byId.has(c.child), `missing child ${c.child}`);
    for (const ch of c.children ?? []) assert.ok(byId.has(ch), `missing child ${ch}`);
  }
});

test("inputs are bound to index-based data-model paths", () => {
  const comps = buildPanel(flags)[2].updateComponents!.components;
  const enabled = comps.find((c) => c.id === "enabled:checkout.new-flow") as Component;
  const rollout = comps.find((c) => c.id === "rollout:checkout.new-flow") as Component;
  assert.deepEqual(enabled.value, { path: "/flags/0/enabled" });
  assert.deepEqual(rollout.value, { path: "/flags/0/rolloutPercentage" });
});

test("resolveUserAction: bound enabled change -> toggle_flag", () => {
  const call = resolveUserAction({ path: "/flags/0/enabled", value: false }, { flags });
  assert.deepEqual(call, { tool: "toggle_flag", arguments: { key: "checkout.new-flow", enabled: false } });
});

test("resolveUserAction: bound rollout change -> update_flag", () => {
  const call = resolveUserAction({ path: "/flags/1/rolloutPercentage", value: 70 }, { flags });
  assert.deepEqual(call, { tool: "update_flag", arguments: { key: "search.semantic", rolloutPercentage: 70 } });
});

test("resolveUserAction: delete button event -> delete_flag", () => {
  const call = resolveUserAction({ event: { name: "delete_flag", key: "search.semantic" } });
  assert.deepEqual(call, { tool: "delete_flag", arguments: { key: "search.semantic" } });
});

test("resolveUserAction: create button reads newKey from data model", () => {
  const call = resolveUserAction({ event: { name: "create_flag" } }, { ui: { newKey: "billing.v2" } });
  assert.equal(call?.tool, "create_flag");
  assert.equal((call?.arguments as { key: string }).key, "billing.v2");
});

test("resolveUserAction: create with empty key is not actionable", () => {
  assert.equal(resolveUserAction({ event: { name: "create_flag" } }, { ui: { newKey: "  " } }), null);
});

test("resolveUserAction: unknown path is not actionable", () => {
  assert.equal(resolveUserAction({ path: "/flags/0/description", value: "x" }, { flags }), null);
});
