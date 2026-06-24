#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { FlagStore } from "./store.js";
import { evaluate, type Flag } from "./flags.js";
import { renderPanel } from "./ui.js";
import { buildPanel, A2UI_MIME } from "./a2ui.js";

const STORE_PATH =
  process.env.FLAGDECK_STORE ??
  join(homedir(), ".flagdeck", "flags.json");

const store = new FlagStore(STORE_PATH);

const server = new McpServer({
  name: "flagdeck",
  version: "1.0.0",
});

// ---- Reusable zod shapes ---------------------------------------------------

const operatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
]);

const conditionSchema = z.object({
  attribute: z.string().min(1).describe("Context attribute to compare, e.g. \"plan\"."),
  operator: operatorSchema,
  values: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .min(1)
    .describe("Comparison values; scalar operators use the first element."),
});

const ruleSchema = z.object({
  description: z.string().optional(),
  conditions: z.array(conditionSchema).min(1),
  serve: z.boolean().describe("Result to serve when all conditions match."),
});

const keySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use lowercase letters, digits, '.', '_', '-'.")
  .describe("Unique flag key, e.g. \"checkout.new-flow\".");

// ---- Helpers ---------------------------------------------------------------

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function now() {
  return new Date().toISOString();
}

// ---- Tools -----------------------------------------------------------------

server.registerTool(
  "list_flags",
  {
    title: "List feature flags",
    description: "Return all feature flags with their current configuration.",
    inputSchema: {},
  },
  async () => {
    const flags = await store.list();
    return ok({ count: flags.length, flags });
  }
);

server.registerTool(
  "get_flag",
  {
    title: "Get a feature flag",
    description: "Return a single feature flag's full configuration by key.",
    inputSchema: { key: keySchema },
  },
  async ({ key }) => {
    const flag = await store.get(key);
    if (!flag) return err(`Flag "${key}" not found.`);
    return ok(flag);
  }
);

server.registerTool(
  "create_flag",
  {
    title: "Create a feature flag",
    description:
      "Create a new feature flag. Fails if a flag with the same key already exists.",
    inputSchema: {
      key: keySchema,
      description: z.string().default(""),
      enabled: z.boolean().default(false).describe("Master on/off switch."),
      rolloutPercentage: z
        .number()
        .min(0)
        .max(100)
        .default(0)
        .describe("Percent of traffic served true when no rule matches."),
      rules: z.array(ruleSchema).default([]),
    },
  },
  async ({ key, description, enabled, rolloutPercentage, rules }) => {
    if (await store.has(key)) {
      return err(`Flag "${key}" already exists. Use update_flag instead.`);
    }
    const ts = now();
    const flag: Flag = {
      key,
      description,
      enabled,
      rolloutPercentage,
      rules,
      createdAt: ts,
      updatedAt: ts,
    };
    await store.upsert(flag);
    return ok(flag);
  }
);

server.registerTool(
  "update_flag",
  {
    title: "Update a feature flag",
    description:
      "Update fields of an existing flag. Only provided fields are changed; omitted fields are left as-is.",
    inputSchema: {
      key: keySchema,
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      rolloutPercentage: z.number().min(0).max(100).optional(),
      rules: z.array(ruleSchema).optional().describe("Replaces the entire rule list when provided."),
    },
  },
  async ({ key, description, enabled, rolloutPercentage, rules }) => {
    const existing = await store.get(key);
    if (!existing) return err(`Flag "${key}" not found.`);
    const updated: Flag = {
      ...existing,
      description: description ?? existing.description,
      enabled: enabled ?? existing.enabled,
      rolloutPercentage: rolloutPercentage ?? existing.rolloutPercentage,
      rules: rules ?? existing.rules,
      updatedAt: now(),
    };
    await store.upsert(updated);
    return ok(updated);
  }
);

server.registerTool(
  "toggle_flag",
  {
    title: "Toggle a feature flag",
    description: "Quickly enable or disable a flag's master switch.",
    inputSchema: {
      key: keySchema,
      enabled: z.boolean().describe("true to enable, false to disable."),
    },
  },
  async ({ key, enabled }) => {
    const existing = await store.get(key);
    if (!existing) return err(`Flag "${key}" not found.`);
    const updated: Flag = { ...existing, enabled, updatedAt: now() };
    await store.upsert(updated);
    return ok({ key, enabled: updated.enabled });
  }
);

server.registerTool(
  "delete_flag",
  {
    title: "Delete a feature flag",
    description: "Permanently delete a feature flag by key.",
    inputSchema: { key: keySchema },
  },
  async ({ key }) => {
    const deleted = await store.delete(key);
    if (!deleted) return err(`Flag "${key}" not found.`);
    return ok({ key, deleted: true });
  }
);

server.registerTool(
  "evaluate_flag",
  {
    title: "Evaluate a feature flag",
    description:
      "Evaluate a flag for a given context (userId + attributes) and return the boolean value with a reason explaining the decision.",
    inputSchema: {
      key: keySchema,
      userId: z
        .string()
        .optional()
        .describe("Stable identifier used for sticky percentage bucketing."),
      attributes: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Attributes referenced by targeting rules, e.g. { plan: \"pro\" }."),
    },
  },
  async ({ key, userId, attributes }) => {
    const flag = await store.get(key);
    if (!flag) return err(`Flag "${key}" not found.`);
    const result = evaluate(flag, { userId, attributes });
    return ok(result);
  }
);

server.registerTool(
  "flag_panel",
  {
    title: "Open the feature flag panel",
    description:
      "Render an interactive panel of all feature flags with live toggle switches. " +
      "Use this when the user asks to see, manage, or open a flags panel/dashboard. " +
      "Hosts that support MCP UI (mcp-ui) render it as an interactive widget; others " +
      "fall back to the included text summary.",
    inputSchema: {},
  },
  async () => {
    const flags = await store.list();
    const html = renderPanel(flags);
    const summary =
      flags.length === 0
        ? "No feature flags yet."
        : flags
            .map(
              (f) =>
                `• ${f.key} — ${f.enabled ? "enabled" : "disabled"}, rollout ${f.rolloutPercentage}%, ${f.rules.length} rule(s)`
            )
            .join("\n");

    return {
      content: [
        {
          type: "resource" as const,
          resource: {
            uri: "ui://flagdeck/panel",
            mimeType: "text/html",
            text: html,
          },
        },
        // Text fallback for hosts that do not render UI resources.
        { type: "text" as const, text: `FlagDeck panel (${flags.length} flags):\n${summary}` },
      ],
    };
  }
);

server.registerTool(
  "flag_panel_a2ui",
  {
    title: "Open the feature flag panel (A2UI)",
    description:
      "Render the feature flags as a declarative A2UI document (surfaces, components, " +
      "and a bound data model) instead of HTML. A2UI hosts render it with a native " +
      "renderer (Lit/Angular/Flutter); user interactions come back as userAction events " +
      "that map to toggle_flag / update_flag / delete_flag / create_flag. Hosts without " +
      "A2UI support fall back to the included text summary.",
    inputSchema: {},
  },
  async () => {
    const flags = await store.list();
    const messages = buildPanel(flags);
    const summary =
      flags.length === 0
        ? "No feature flags yet."
        : flags
            .map(
              (f) =>
                `• ${f.key} — ${f.enabled ? "enabled" : "disabled"}, rollout ${f.rolloutPercentage}%, ${f.rules.length} rule(s)`
            )
            .join("\n");

    return {
      content: [
        {
          type: "resource" as const,
          resource: {
            uri: "ui://flagdeck/a2ui",
            mimeType: A2UI_MIME,
            text: JSON.stringify(messages),
          },
        },
        { type: "text" as const, text: `FlagDeck A2UI panel (${flags.length} flags):\n${summary}` },
      ],
    };
  }
);

// ---- Boot ------------------------------------------------------------------

async function main() {
  // FlagDeck speaks MCP over stdio. The `--stdio` flag is accepted explicitly
  // so client configs can pass it (it is also the default transport).
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--stdio");
  if (unknown.length > 0) {
    console.error(`FlagDeck: ignoring unknown arguments: ${unknown.join(" ")}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stderr is safe for logging; stdout is reserved for the MCP protocol.
  console.error(`FlagDeck MCP server running (stdio). Store: ${STORE_PATH}`);
}

main().catch((error) => {
  console.error("Fatal error starting FlagDeck:", error);
  process.exit(1);
});
