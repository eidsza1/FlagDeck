"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import A2UIRenderer from "./a2ui-renderer";

type Msg = { role: "user" | "assistant"; text: string; bundle?: unknown[] };

const GREETING: Msg = {
  role: "assistant",
  text:
    'Hi! I manage your feature flags. Try: "show me the flags", "create billing.v2 at 10%", or "turn on checkout.new-flow and roll it out to 50%".',
};

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, text: m.text })) }),
      }).then((r) => r.json());
      setMsgs((m) => [...m, { role: "assistant", text: res.text ?? "", bundle: res.bundle ?? undefined }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "⚠️ Request failed." }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat">
      <div className="messages">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text && <div className="bubble">{m.text}</div>}
            {m.bundle && (
              <div className="inline-panel">
                <A2UIRenderer initialBundle={m.bundle as never} />
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble typing">…</div></div>}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask me to show or change feature flags…"
          rows={2}
        />
        <button className="btn primary" onClick={send} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
