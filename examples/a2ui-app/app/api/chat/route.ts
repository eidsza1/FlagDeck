import { NextResponse } from "next/server";
import OpenAI from "openai";
import { executeChatTool } from "@/lib/flagdeck";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GroqCloud is OpenAI-compatible — same SDK, different base URL + key + model.
const BASE_URL = "https://api.groq.com/openai/v1";
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM = `You are FlagDeck's assistant. You manage feature flags through the provided tools.
When the user asks to see, list, or manage flags — and after you create, update, toggle, or delete a flag — call show_flag_panel so an interactive panel is drawn for them.
Keep text replies to one short sentence and let the panel show the details. Flag keys are lowercase, dot/dash separated (e.g. checkout.new-flow).`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "list_flags", description: "List all feature flags.", parameters: { type: "object", properties: {} } } },
  {
    type: "function",
    function: {
      name: "create_flag",
      description: "Create a new feature flag.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Unique flag key, lowercase dotted, e.g. checkout.new-flow" },
          description: { type: "string" },
          enabled: { type: "boolean" },
          rolloutPercentage: { type: "number", description: "0-100" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_flag",
      description: "Update an existing flag's rollout percentage and/or enabled state.",
      parameters: { type: "object", properties: { key: { type: "string" }, rolloutPercentage: { type: "number" }, enabled: { type: "boolean" } }, required: ["key"] },
    },
  },
  {
    type: "function",
    function: { name: "toggle_flag", description: "Enable or disable a flag.", parameters: { type: "object", properties: { key: { type: "string" }, enabled: { type: "boolean" } }, required: ["key", "enabled"] } },
  },
  { type: "function", function: { name: "delete_flag", description: "Delete a flag.", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } } },
  {
    type: "function",
    function: { name: "evaluate_flag", description: "Evaluate a flag for a given user/attributes context.", parameters: { type: "object", properties: { key: { type: "string" }, userId: { type: "string" }, attributes: { type: "object" } }, required: ["key"] } },
  },
  { type: "function", function: { name: "show_flag_panel", description: "Draw the interactive feature-flag panel for the user.", parameters: { type: "object", properties: {} } } },
];

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: { role: "user" | "assistant"; text: string }[] };

  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    ...messages.map((m) => ({ role: m.role, content: m.text && m.text.trim() ? m.text : "(panel shown)" }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
  ];

  let panelBundle: unknown = null;

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ text: "⚠️ No GroqCloud API key configured. Set GROQ_API_KEY and restart the dev server.", bundle: null });
    }
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });

    const MAX_STEPS = 10;
    for (let step = 0; step < MAX_STEPS; step++) {
      // On the final step, forbid further tool calls so the model must finish
      // with a text reply instead of looping into "too many steps".
      const lastStep = step === MAX_STEPS - 1;
      const resp = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        tools: TOOLS,
        tool_choice: lastStep ? "none" : "auto",
        messages: history,
      });

      const msg = resp.choices[0].message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        history.push(msg); // assistant turn carrying the tool_calls
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            /* leave args empty on malformed JSON */
          }
          const out = await executeChatTool(tc.function.name, args);
          if (out.bundle) panelBundle = out.bundle;
          history.push({ role: "tool", tool_call_id: tc.id, content: out.text });
        }
        continue;
      }

      // Some open models leak raw tool-call syntax into the text — strip it.
      let text = (msg.content ?? "").replace(/<function>[\s\S]*?<\/function>/g, "").replace(/<\/?function[^>]*>/g, "").trim();
      if (!text) text = panelBundle ? "Here's the flag panel." : "Done.";
      return NextResponse.json({ text, bundle: panelBundle });
    }
    return NextResponse.json({ text: panelBundle ? "Done — here's the updated panel." : "Done.", bundle: panelBundle });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const msg = status === 401
      ? "GroqCloud rejected the API key (401). Check GROQ_API_KEY."
      : `Request failed: ${String((err as Error)?.message ?? err)}`;
    return NextResponse.json({ text: `⚠️ ${msg}`, bundle: null });
  }
}
