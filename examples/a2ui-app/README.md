# FlagDeck · A2UI demo (Next.js)

A tiny **Next.js** app that renders FlagDeck's [A2UI](https://a2ui.org) output as native
UI and closes the `userAction` loop — so you can *see* declarative agent-driven UI working.

It reuses the real FlagDeck building blocks from the parent build (`../../dist`):
`buildPanel()`, `resolveUserAction()`, and the file-backed `FlagStore`.

```
browser ──GET /api/a2ui──▶  buildPanel(flags)            ──▶ A2UI bundle
   │                                                            │
   ▼ render (React)                                             │
 interact (toggle / slider / delete / create)                  │
   │                                                            ▼
   └──POST /api/action {action,ui}──▶ resolveUserAction ──▶ MCP tool ──▶ FlagStore
                                                                │
                                            fresh A2UI bundle ◀─┘
```

## Run

From the repo root, build FlagDeck first so `../../dist` exists:

```bash
npm run build          # in the FlagDeck repo root
```

Then start the demo:

```bash
cd examples/a2ui-app
npm install
npm run dev            # → http://localhost:5174
```

Toggle a flag, drag a rollout slider, delete a card, or create a new flag — each
interaction appears in the **userAction → tool** panel and persists to the same JSON store
(`/tmp/flagdeck-example/flags.json`) the MCP server uses.

## How it maps to A2UI

- [`app/a2ui-renderer.tsx`](app/a2ui-renderer.tsx) — a minimal React renderer for the A2UI
  basic-catalog subset FlagDeck emits (`Text`, `Row`, `Column`, `Card`, `Button`,
  `CheckBox`, `Slider`, `TextField`), resolving `{ path }` bindings against the data model.
- [`app/api/a2ui/route.ts`](app/api/a2ui/route.ts) — serves the A2UI bundle.
- [`app/api/action/route.ts`](app/api/action/route.ts) — resolves a `userAction` to a tool
  call and applies it.
- [`lib/flagdeck.ts`](lib/flagdeck.ts) — the server-side glue over `../../dist`.

This stands in for a real A2UI host: a production renderer (Lit/Angular/Flutter) would do
the same job natively; the React renderer here keeps the demo self-contained.
