import { useState } from "react";
import { Button, Callout, Markdown, Status, Text } from "@renderer/ui";

import { useAITask } from "../lib/ai";
import {
  buildAssistantSnapshot,
  buildAssistantSystem,
  type AssistantPromptInput,
} from "../lib/ai-prompts";

interface Exchange {
  question: string;
  answer: string;
}

const READ_ONLY = { task: false, reminder: false, event: false } as const;
const SYSTEM = `${buildAssistantSystem({ canCreate: READ_ONLY, permission: "read-only" })}
You are answering inside the menu bar panel. Keep it under 120 words unless asked for more.`;

/** How much of the last answer travels with a follow-up. */
const CARRIED = 2_000;

export type AskSnapshot = Omit<AssistantPromptInput, "canCreate" | "permission">;

/**
 * Ask from the menu bar: one streamed, read-only answer about the day, shown in the panel. A
 * follow-up carries the previous question and answer so "and tomorrow?" makes sense.
 */
export function usePanelAsk(snapshot: () => AskSnapshot) {
  const ai = useAITask();
  const [thread, setThread] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState<string | null>(null);

  function ask(text: string) {
    const next = text.trim();
    if (!next) return;
    const previous = question ? { question, answer: ai.output } : null;
    if (previous?.answer) setThread((current) => [...current, previous]);
    setQuestion(next);
    const earlier = previous?.answer
      ? `Earlier in this panel the user asked: ${previous.question}\nYou answered: ${previous.answer.slice(0, CARRIED)}\n\n`
      : "";
    void ai.run({
      system: SYSTEM,
      prompt: `${buildAssistantSnapshot({ ...snapshot(), canCreate: READ_ONLY, permission: "read-only" })}\n\n${earlier}Question: ${next}`,
      maxOutputTokens: 700,
    });
  }

  function reset() {
    ai.clear();
    setThread([]);
    setQuestion(null);
  }

  return { ai, thread, question, ask, reset };
}

export function PanelAsk({
  state,
  onClose,
}: {
  state: ReturnType<typeof usePanelAsk>;
  onClose: () => void;
}) {
  const { ai, thread, question } = state;
  const model = ai.model
    ? [ai.model.name, ai.model.effortLabel ?? ai.model.effort].filter(Boolean).join(" · ")
    : null;
  return (
    <section aria-label="Ask" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <Text as="h2" variant="small-strong" className="flex-1">
          Ask
        </Text>
        {ai.isRunning ? (
          <Button size="small" onClick={ai.stop}>
            Stop
          </Button>
        ) : null}
        <Button size="small" variant="transparent" onClick={onClose}>
          Close
        </Button>
      </div>
      {thread.map((exchange, index) => (
        <div key={index} className="flex flex-col gap-1 px-1 opacity-70">
          <Text as="p" variant="small-strong">
            {exchange.question}
          </Text>
          <div className="text-small">
            <Markdown>{exchange.answer}</Markdown>
          </div>
        </div>
      ))}
      {question ? (
        <div className="flex flex-col gap-1.5 rounded-xl bg-well p-3" aria-live="polite">
          <Text as="p" variant="strong">
            {question}
          </Text>
          {ai.message ? <Callout color="orange">{ai.message}</Callout> : null}
          {ai.output ? (
            <div className="text-small">
              <Markdown isStreaming={ai.isRunning}>{ai.output}</Markdown>
            </div>
          ) : ai.isRunning ? (
            <Status variant="loading">Reading your day…</Status>
          ) : null}
          {model && !ai.isRunning ? (
            <Text as="p" variant="mini" color="tertiary">
              {model}
            </Text>
          ) : null}
        </div>
      ) : null}
      <Text as="p" variant="small" color="tertiary" className="px-1">
        Answers read your day and change nothing. Ask a follow-up below with ⌘↩.
      </Text>
    </section>
  );
}
