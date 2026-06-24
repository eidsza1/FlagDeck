// End-to-end A2UI action-loop demo.
//
// Drives the real FlagDeck MCP server over stdio and exercises the full loop:
//   flag_panel_a2ui  →  simulate a userAction  →  resolveUserAction()  →  call the
//   resolved MCP tool  →  flag_panel_a2ui again  →  observe the change.
//
// Run:  npm run demo:a2ui   (builds first, then runs this)
import { spawn } from "node:child_process";
import { resolveUserAction } from "../dist/a2ui.js";

const STORE = "/tmp/flagdeck-a2ui-demo/flags.json";
const env = { ...process.env, FLAGDECK_STORE: STORE };
const srv = spawn("node", ["dist/index.js"], { env, stdio: ["pipe", "pipe", "ignore"] });

let buf = "";
const waiters = new Map();
srv.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});

let id = 0;
const rpc = (method, params) =>
  new Promise((res) => { const i = id++; waiters.set(i, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result.content.find((b) => b.type === "text")?.text;
  const resource = r.result.content.find((b) => b.type === "resource");
  return { text, bundle: resource ? JSON.parse(resource.resource.text) : null, isError: r.result.isError };
};
const dataModelOf = (bundle) => bundle.find((m) => m.updateDataModel).updateDataModel.value;
const flagsOf = (bundle) => dataModelOf(bundle).flags;
const line = (s) => console.log(s);

// --- handshake + seed --------------------------------------------------------
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "demo", version: "1" } });
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
await call("create_flag", { key: "checkout.new-flow", description: "New checkout", enabled: false, rolloutPercentage: 10, rules: [] });
await call("create_flag", { key: "search.semantic", enabled: true, rolloutPercentage: 0, rules: [] });

// --- render the A2UI panel ---------------------------------------------------
let { bundle } = await call("flag_panel_a2ui", {});
let flags = flagsOf(bundle);
line("① rendered panel — data model:");
flags.forEach((f, i) => line(`   /flags/${i}  ${f.key}: enabled=${f.enabled}, rollout=${f.rolloutPercentage}`));

// --- simulate user dragging the rollout slider on flag 0 to 80 ---------------
let action = { path: "/flags/0/rolloutPercentage", value: 80 };
let resolved = resolveUserAction(action, { flags });
line(`\n② userAction ${JSON.stringify(action)}`);
line(`   resolveUserAction → ${JSON.stringify(resolved)}`);
await call(resolved.tool, resolved.arguments);

// --- simulate user ticking the Enabled checkbox on flag 0 --------------------
action = { path: "/flags/0/enabled", value: true };
resolved = resolveUserAction(action, { flags });
line(`\n③ userAction ${JSON.stringify(action)}`);
line(`   resolveUserAction → ${JSON.stringify(resolved)}`);
await call(resolved.tool, resolved.arguments);

// --- re-render and confirm the data model changed ----------------------------
({ bundle } = await call("flag_panel_a2ui", {}));
flags = flagsOf(bundle);
const f0 = flags.find((f) => f.key === "checkout.new-flow");
line(`\n④ re-rendered — checkout.new-flow is now: enabled=${f0.enabled}, rollout=${f0.rolloutPercentage}`);
line(`   ${f0.enabled && f0.rollout !== 10 ? "" : ""}${f0.enabled && f0.rolloutPercentage === 80 ? "✓ loop closed: slider + checkbox round-tripped through MCP tools" : "✗ unexpected state"}`);

// --- simulate clicking the Delete button on flag 1 ---------------------------
action = { event: { name: "delete_flag", key: "search.semantic" } };
resolved = resolveUserAction(action, { flags });
line(`\n⑤ userAction ${JSON.stringify(action)}`);
line(`   resolveUserAction → ${JSON.stringify(resolved)}`);
await call(resolved.tool, resolved.arguments);
({ bundle } = await call("flag_panel_a2ui", {}));
line(`   remaining flags: ${flagsOf(bundle).map((f) => f.key).join(", ") || "(none)"}`);

srv.kill();
