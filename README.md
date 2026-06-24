# FlagDeck

An [MCP](https://modelcontextprotocol.io) server for managing **feature flags**. It lets an
MCP client (Claude Desktop, Claude Code, etc.) create, toggle, target, and evaluate feature
flags through a small set of tools. Flags are persisted to a JSON file, and evaluation is
deterministic — the same user always lands in the same rollout bucket.

## Features

- **Toggles** — a master on/off switch per flag.
- **Percentage rollouts** — serve a flag to a sticky percentage of traffic, bucketed by `userId`.
- **Targeting rules** — serve on/off based on context attributes (`plan`, `country`, `age`, …)
  using `eq`, `neq`, `in`, `not_in`, `contains`, `gt`, `gte`, `lt`, `lte` operators.
- **Deterministic evaluation** with a human-readable `reason` for every decision.
- **File-backed persistence** — survives restarts; no database required.

## Install & build

```bash
npm install
npm run build
```

## Tools

| Tool            | Description                                                            |
| --------------- | --------------------------------------------------------------------- |
| `list_flags`    | List all flags and their configuration.                               |
| `get_flag`      | Get one flag by key.                                                   |
| `create_flag`   | Create a new flag (fails if the key already exists).                  |
| `update_flag`   | Update fields of an existing flag (omitted fields are left as-is).    |
| `toggle_flag`   | Quickly enable/disable a flag's master switch.                        |
| `delete_flag`   | Delete a flag.                                                         |
| `evaluate_flag` | Evaluate a flag for a `{ userId, attributes }` context.               |
| `flag_panel`    | Render an interactive flags panel (mcp-ui HTML widget) with live toggles. |
| `flag_panel_a2ui` | Render the flags panel as a declarative **A2UI** document (no HTML).  |

### Evaluation precedence

1. If the flag is **disabled**, the result is `false`.
2. The **first targeting rule** whose conditions all match (logical AND) decides the result.
3. Otherwise the **percentage rollout** decides, bucketed deterministically by `userId`
   (or `"anonymous"` when no `userId` is given).

## Testing the server

### 1. MCP Inspector (editor-independent)

The fastest way to poke at the tools is the official Inspector. It launches the
server and opens a browser UI where you can list tools and run calls:

```bash
npm run inspect
# equivalently:
npm run build
npx @modelcontextprotocol/inspector node dist/index.js --stdio
```

Try `create_flag`, then `flag_panel`, then `evaluate_flag` from the Inspector UI.

### 2. VS Code (stdio)

This repo ships a [`.vscode/mcp.json`](.vscode/mcp.json) that points VS Code at the
local build, so testing your own changes is just rebuild + reload:

```bash
npm run build         # produces dist/index.js
```

Then in VS Code (use **VS Code Insiders** — MCP UI features land there first):

1. Open this folder.
2. Open the **MCP: List Servers** command (or the Chat view's tools picker) and
   start the **flagdeck** server.
3. In Agent/Chat mode, ask: **"open the feature flag panel"**.

The agent calls `flag_panel`, and a host that supports MCP UI renders an
**interactive widget** with live toggle switches — flipping a switch calls
`toggle_flag` back on the server. Hosts without UI support show the text fallback
(a `• key — enabled, rollout …` summary).

> The `flag_panel` tool returns the widget as an mcp-ui embedded resource
> (`ui://flagdeck/panel`, `mimeType: text/html`). Whether it renders as a live
> widget or as text depends on the host's MCP UI support; the tool always
> includes a plain-text fallback so it degrades gracefully.

## Declarative UI with A2UI (`flag_panel_a2ui`)

Where `flag_panel` returns ready-made **HTML**, `flag_panel_a2ui` returns a declarative
[**A2UI**](https://a2ui.org) document — the agent describes *surfaces*, *components* and a
*data model*, and an A2UI renderer turns it into native UI. The same payload renders on any
A2UI client regardless of framework, and components come from a trusted catalog (data, not
executable code).

**Renderer status (mid-2026):** official renderers exist for **Lit, Angular, and Flutter**;
**React and SwiftUI are on the roadmap**. For the web, **Lit** is the safe choice today.
(Check the [renderers page](https://a2ui.org/renderers/) before picking one.)

### What the tool emits

A bundle of three A2UI v0.9.1 messages against the
[basic catalog](https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json):

1. `createSurface` — declares the canvas + catalog.
2. `updateDataModel` — pushes `{ flags, ui }` state.
3. `updateComponents` — the component tree (`Card`/`Column`/`Row`/`Text`/`CheckBox`/`Slider`/
   `Button`/`TextField`), with inputs **bound** to data-model paths like `/flags/0/enabled`.

### The action loop

```
agent emits A2UI ──▶ renderer draws native UI ──▶ user interacts
      ▲                                                  │
      └────────── resolveUserAction() ◀── userAction ────┘
```

- **Bound inputs** (CheckBox, Slider) emit a data-model update for their path.
- **Buttons** (Delete, Create) emit an explicit `action.event` with context.

[`resolveUserAction(action, dataModel)`](src/a2ui.ts) closes the loop by mapping each
`userAction` to the MCP tool to run:

| userAction                                   | → MCP tool                          |
| -------------------------------------------- | ----------------------------------- |
| `path: /flags/{i}/enabled`, `value`          | `toggle_flag { key, enabled }`      |
| `path: /flags/{i}/rolloutPercentage`, `value`| `update_flag { key, rolloutPercentage }` |
| `event: { name: "delete_flag", key }`        | `delete_flag { key }`               |
| `event: { name: "create_flag" }` (+`ui.newKey`) | `create_flag { key, … }`         |

A host/bridge wires its A2UI renderer's `userAction` callback through `resolveUserAction`,
then calls the returned tool on this server — and the next `flag_panel_a2ui` reflects the change.

> The tool returns the bundle as an embedded resource (`mimeType: application/vnd.a2ui+json`)
> plus a plain-text fallback, so non-A2UI hosts still get a readable summary.

### See it running

A small **Next.js** demo app in [`examples/a2ui-app`](examples/a2ui-app) renders the A2UI
output as native UI and closes the loop in the browser:

```bash
npm run build                 # repo root — produces ../../dist for the app
cd examples/a2ui-app && npm install && npm run dev   # → http://localhost:5174
```

Toggle a flag, drag a rollout slider, delete or create one — each interaction is shown in a
"userAction → tool" panel and persisted through `resolveUserAction` to the same store the
MCP server uses. Or test the loop headlessly with `npm run demo:a2ui` from the repo root.

## Configure in an MCP client

Add to your client's MCP server config (e.g. Claude Desktop's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flagdeck": {
      "command": "node",
      "args": ["/absolute/path/to/FlagDeck/dist/index.js"],
      "env": {
        "FLAGDECK_STORE": "/absolute/path/to/flags.json"
      }
    }
  }
}
```

`FLAGDECK_STORE` is optional and defaults to `~/.flagdeck/flags.json`.

## Example

Create a flag that is off for everyone except `pro` users, then rolling out to 25% of the rest:

```jsonc
// create_flag
{
  "key": "checkout.new-flow",
  "description": "Redesigned checkout",
  "enabled": true,
  "rolloutPercentage": 25,
  "rules": [
    {
      "description": "pro users always on",
      "conditions": [{ "attribute": "plan", "operator": "eq", "values": ["pro"] }],
      "serve": true
    }
  ]
}
```

```jsonc
// evaluate_flag → { value: true, reason: "matched rule #1 (pro users always on) → serve true" }
{ "key": "checkout.new-flow", "userId": "u1", "attributes": { "plan": "pro" } }
```

## Development

```bash
npm run dev    # run from source with --watch
npm test       # run the evaluation-engine unit tests
```

## Project layout

```
src/
  flags.ts   # flag types + deterministic evaluation engine
  store.ts   # JSON file-backed persistence
  ui.ts      # interactive HTML panel (mcp-ui widget) generator
  a2ui.ts    # declarative A2UI panel generator + userAction → tool resolver
  index.ts   # MCP server + tool definitions
test/
  flags.test.ts
```

## License

MIT
