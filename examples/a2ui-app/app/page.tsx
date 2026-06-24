import Chat from "./chat";

export default function Page() {
  return (
    <main className="page">
      <div className="masthead">
        <h1>🚩 FlagDeck</h1>
        <span className="sub">Chat with a GroqCloud agent — it manages your flags and draws the panel inline</span>
      </div>
      <p className="sub">
        Write in plain language. A GroqCloud LLM (with FlagDeck tools) decides what to do, calls the
        matching tool, and renders an interactive <code>A2UI</code> panel right in the conversation.
        The panel is live — toggle or slide inside it and it round-trips through the same store.
      </p>
      <Chat />
    </main>
  );
}
