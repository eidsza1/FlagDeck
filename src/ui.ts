import type { Flag } from "./flags.js";

/**
 * Builds an interactive HTML panel for the given flags.
 *
 * The markup follows the mcp-ui convention: it is returned as an embedded
 * resource with mimeType "text/html" and rendered in a sandboxed iframe by
 * MCP UI hosts (e.g. VS Code's chat, or any mcp-ui compatible client).
 *
 * The panel is a small self-contained single-page app: the server injects the
 * current flags as JSON and all rendering/interaction happens client-side.
 * Mutations are sent back to the host via `window.parent.postMessage` using the
 * mcp-ui action protocol, e.g.:
 *   { type: "tool", payload: { toolName: "toggle_flag", params: { key, enabled } } }
 * The host then invokes the corresponding MCP tool on this server.
 */
export function renderPanel(flags: Flag[]): string {
  // Inject the model safely: prevent "</script>" breakout and JS line separators.
  const data = JSON.stringify(flags)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${STYLE}</style>
</head>
<body>
  <div id="app"></div>
<script>
const FLAGS = ${data};
${WIDGET_JS}
</script>
</body>
</html>`;
}

const STYLE = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#1f2328; --muted:#57606a; --border:#d0d7de; --card:#fff; --pill:#eaeef2; --track:#d0d7de; --accent:#1f883d; --danger:#cf222e; --field:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --border:#30363d; --card:#161b22; --pill:#21262d; --track:#30363d; --field:#0d1117; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:var(--fg); background:var(--bg); }
  .wrap { padding:12px; max-width:760px; }
  h1 { font-size:14px; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
  h1 .count { font-weight:400; color:var(--muted); }
  .toolbar { display:flex; gap:8px; margin-bottom:10px; align-items:center; }
  input, select { font:inherit; color:var(--fg); background:var(--field); border:1px solid var(--border); border-radius:6px; padding:4px 8px; }
  input:focus, select:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .filter { flex:1; }
  .btn { font:inherit; cursor:pointer; border:1px solid var(--border); background:var(--pill); color:var(--fg); border-radius:6px; padding:4px 10px; }
  .btn:hover { border-color:var(--muted); }
  .btn.primary { background:var(--accent); color:#fff; border-color:transparent; }
  .btn.danger { background:var(--danger); color:#fff; border-color:transparent; }
  .btn.icon { padding:2px 7px; line-height:1; }
  .card { border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px; background:var(--card); }
  .row { display:flex; align-items:center; gap:10px; }
  .info { flex:1; min-width:0; }
  .key { font-weight:600; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .desc { color:var(--muted); margin-top:2px; word-break:break-word; }
  .meta { color:var(--muted); margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .pill { background:var(--pill); border-radius:999px; padding:1px 8px; font-size:11px; }
  .rollout { display:flex; align-items:center; gap:8px; margin-top:8px; }
  .rollout input[type=range] { flex:1; accent-color:var(--accent); }
  .rollout .val { width:42px; text-align:right; font-variant-numeric:tabular-nums; }
  .switch { position:relative; display:inline-block; width:40px; height:22px; flex:none; }
  .switch input { opacity:0; width:0; height:0; }
  .slider { position:absolute; cursor:pointer; inset:0; background:var(--track); border-radius:999px; transition:.15s; }
  .slider::before { content:""; position:absolute; height:16px; width:16px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.15s; }
  .switch input:checked + .slider { background:var(--accent); }
  .switch input:checked + .slider::before { transform:translateX(18px); }
  .rules { margin-top:8px; border-top:1px solid var(--border); padding-top:8px; }
  .rules-title { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .rule { display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap; }
  .rule code { background:var(--pill); border-radius:4px; padding:1px 6px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
  .rule .serve { font-weight:600; }
  .rule .serve.on { color:var(--accent); }
  .rule .serve.off { color:var(--danger); }
  .addrule { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:6px; }
  .addrule input { width:96px; }
  .empty { color:var(--muted); padding:20px; text-align:center; }
  .create { border:1px dashed var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
`;

// Client-side widget logic. Plain ES5-ish JS using the DOM API only — no nested
// template literals or ${...}, so it survives interpolation into the page above.
const WIDGET_JS = `
function h(tag, attrs, kids) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = !!v;
    else e.setAttribute(k, v);
  }
  (kids || []).forEach(function (c) {
    if (c == null) return;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return e;
}

function callTool(name, params) {
  window.parent.postMessage({ type: "tool", payload: { toolName: name, params: params } }, "*");
}

var OPERATORS = ["eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte"];
var KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;
var state = { flags: FLAGS.slice(), filter: "", creating: false };
var listEl;

function coerce(v) {
  var t = String(v).trim();
  if (t !== "" && !isNaN(Number(t))) return Number(t);
  return v;
}

function findFlag(key) {
  for (var i = 0; i < state.flags.length; i++) if (state.flags[i].key === key) return state.flags[i];
  return null;
}

function renderRule(flag, rule, idx) {
  var conds = rule.conditions.map(function (c) {
    return h("code", null, [c.attribute + " " + c.operator + " " + JSON.stringify(c.values)]);
  });
  var remove = h("button", {
    class: "btn icon", title: "Remove rule", text: "\\u2715",
    onclick: function () {
      flag.rules = flag.rules.filter(function (_, i) { return i !== idx; });
      callTool("update_flag", { key: flag.key, rules: flag.rules });
      renderList();
    }
  });
  return h("div", { class: "rule" },
    [h("span", { class: "serve " + (rule.serve ? "on" : "off"), text: rule.serve ? "serve ON" : "serve OFF" })]
      .concat(conds).concat([remove]));
}

function addRuleForm(flag) {
  var attr = h("input", { placeholder: "attribute" });
  var op = h("select", null, OPERATORS.map(function (o) { return h("option", { value: o, text: o }); }));
  var val = h("input", { placeholder: "value(s)" });
  var serve = h("select", null, [h("option", { value: "true", text: "serve ON" }), h("option", { value: "false", text: "serve OFF" })]);
  var add = h("button", {
    class: "btn", text: "+ rule",
    onclick: function () {
      if (!attr.value.trim() || !val.value.trim()) return;
      var multi = (op.value === "in" || op.value === "not_in");
      var values = multi
        ? val.value.split(",").map(function (s) { return coerce(s); })
        : [coerce(val.value)];
      flag.rules = flag.rules.concat([{ conditions: [{ attribute: attr.value.trim(), operator: op.value, values: values }], serve: serve.value === "true" }]);
      callTool("update_flag", { key: flag.key, rules: flag.rules });
      renderList();
    }
  });
  return h("div", { class: "addrule" }, [attr, op, val, serve, add]);
}

function card(flag) {
  var toggle = h("label", { class: "switch", title: "Enable/disable" }, [
    h("input", {
      type: "checkbox", checked: flag.enabled,
      onchange: function (ev) {
        flag.enabled = ev.target.checked;
        callTool("toggle_flag", { key: flag.key, enabled: flag.enabled });
        renderList();
      }
    }),
    h("span", { class: "slider" })
  ]);

  var del = h("button", {
    class: "btn icon", title: "Delete flag", text: "\\u2715",
    onclick: function (ev) {
      var b = ev.target;
      if (b.dataset.armed) {
        state.flags = state.flags.filter(function (f) { return f.key !== flag.key; });
        callTool("delete_flag", { key: flag.key });
        renderList();
      } else {
        b.dataset.armed = "1";
        b.textContent = "Delete?";
        b.classList.add("danger");
      }
    }
  });

  var header = h("div", { class: "row" }, [
    h("div", { class: "info" }, [
      h("div", { class: "key", text: flag.key }),
      flag.description ? h("div", { class: "desc", text: flag.description }) : null,
      h("div", { class: "meta" }, [
        h("span", { class: "pill", text: flag.enabled ? "enabled" : "disabled" }),
        h("span", { class: "pill", text: flag.rules.length + (flag.rules.length === 1 ? " rule" : " rules") })
      ])
    ]),
    toggle,
    del
  ]);

  var valLabel = h("span", { class: "val", text: flag.rolloutPercentage + "%" });
  var range = h("input", {
    type: "range", min: "0", max: "100", step: "1", value: String(flag.rolloutPercentage),
    oninput: function (ev) { valLabel.textContent = ev.target.value + "%"; },
    onchange: function (ev) {
      flag.rolloutPercentage = Number(ev.target.value);
      callTool("update_flag", { key: flag.key, rolloutPercentage: flag.rolloutPercentage });
    }
  });
  var rollout = h("div", { class: "rollout" }, [h("span", { class: "pill", text: "rollout" }), range, valLabel]);

  var rulesKids = [h("div", { class: "rules-title", text: "Targeting rules" })];
  flag.rules.forEach(function (r, i) { rulesKids.push(renderRule(flag, r, i)); });
  rulesKids.push(addRuleForm(flag));
  var rules = h("div", { class: "rules" }, rulesKids);

  return h("div", { class: "card" }, [header, rollout, rules]);
}

function createForm() {
  var key = h("input", { placeholder: "flag.key", class: "filter" });
  var desc = h("input", { placeholder: "description (optional)", class: "filter" });
  var create = h("button", {
    class: "btn primary", text: "Create",
    onclick: function () {
      var k = key.value.trim();
      if (!KEY_RE.test(k)) { key.style.borderColor = "var(--danger)"; return; }
      if (findFlag(k)) { key.style.borderColor = "var(--danger)"; return; }
      var flag = { key: k, description: desc.value, enabled: false, rolloutPercentage: 0, rules: [], createdAt: "", updatedAt: "" };
      state.flags.push(flag);
      callTool("create_flag", { key: k, description: desc.value, enabled: false, rolloutPercentage: 0, rules: [] });
      state.creating = false;
      mount();
    }
  });
  var cancel = h("button", { class: "btn", text: "Cancel", onclick: function () { state.creating = false; mount(); } });
  return h("div", { class: "create" }, [key, desc, create, cancel]);
}

function renderList() {
  if (!listEl) return;
  listEl.textContent = "";
  var q = state.filter.toLowerCase();
  var shown = state.flags.filter(function (f) {
    return !q || f.key.toLowerCase().indexOf(q) >= 0 || (f.description || "").toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

  if (shown.length === 0) {
    listEl.appendChild(h("p", { class: "empty", text: state.flags.length ? "No flags match the filter." : "No feature flags yet. Create one above." }));
    return;
  }
  shown.forEach(function (f) { listEl.appendChild(card(f)); });
}

function mount() {
  var app = document.getElementById("app");
  app.textContent = "";
  var wrap = h("div", { class: "wrap" });

  wrap.appendChild(h("h1", null, [
    "\\uD83D\\uDEA9 FlagDeck ",
    h("span", { class: "count", text: state.flags.length + (state.flags.length === 1 ? " flag" : " flags") })
  ]));

  var filter = h("input", {
    class: "filter", placeholder: "Filter flags\\u2026", value: state.filter,
    oninput: function (ev) { state.filter = ev.target.value; renderList(); }
  });
  var newBtn = h("button", {
    class: "btn primary", text: state.creating ? "Close" : "+ New flag",
    onclick: function () { state.creating = !state.creating; mount(); }
  });
  wrap.appendChild(h("div", { class: "toolbar" }, [filter, newBtn]));

  if (state.creating) wrap.appendChild(createForm());

  listEl = h("div", { class: "list" });
  wrap.appendChild(listEl);
  app.appendChild(wrap);
  renderList();
}

mount();
`;
