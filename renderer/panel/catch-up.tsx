import { useEffect, useEffectEvent, useState } from "react";
import { Button, Kbd, Text } from "@renderer/ui";

import { relativeDue } from "../lib/dates";
import { SOURCE_META } from "../lib/sources";
import type { Todo } from "../lib/todos";
import { DeleteButton } from "./panel-rows";
import type { PanelWrites } from "./panel-writes";
import { RECURRING_NOTE, canEditTodo, moveChoices } from "./todo-edit";

/**
 * Overdue work, one item at a time: check it off, give it a new day, drop its date, delete it, or
 * skip it. The queue is the overdue list as it stood when Catch up opened, oldest first.
 */
export function CatchUp({
  todos,
  now,
  writes,
  toggle,
  onExit,
}: {
  /** The open overdue to-dos right now. */
  todos: Todo[];
  now: Date;
  writes: PanelWrites;
  toggle: (todo: Todo) => void;
  onExit: () => void;
}) {
  const [queue] = useState(() => todos.map((todo) => todo.key));
  const [index, setIndex] = useState(0);
  const byKey = new Map(todos.map((todo) => [todo.key, todo]));
  // Anything handled elsewhere since Catch up opened is passed over.
  let position = index;
  while (position < queue.length && !byKey.has(queue[position])) position += 1;
  const todo = position < queue.length ? byKey.get(queue[position])! : null;
  const next = () => setIndex(position + 1);
  const busy = todo ? writes.busy === todo.key : false;
  const editable = todo ? canEditTodo(todo) : false;
  const choices = todo && editable ? moveChoices(now, todo.dueDate) : [];

  const done = () => {
    if (!todo || busy) return;
    toggle(todo);
    next();
  };
  const move = (choice: (typeof choices)[number]) => {
    if (!todo || busy) return;
    void writes.moveTodo(todo, choice.date, choice.label).then((moved) => {
      if (moved) next();
    });
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    const choice = choices.find((candidate) => candidate.key === key);
    const action = key === "d" ? done : key === "s" ? next : choice ? () => move(choice) : null;
    if (!action || !todo) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (!todo) {
    return (
      <section aria-label="Catch up" className="flex flex-col items-center gap-2 px-4 py-8">
        <Text as="h2" variant="large-strong">
          All Caught Up
        </Text>
        <Text as="p" variant="small" color="secondary" align="center">
          {queue.length === 1
            ? "You went through the one overdue item."
            : `You went through all ${queue.length} overdue items.`}
        </Text>
        <Button size="small" variant="accent" onClick={onExit}>
          Back to today
        </Button>
      </section>
    );
  }

  const due = todo.dueDate ? relativeDue(todo.dueDate, todo.dueTime, now).label : null;
  return (
    <section aria-label="Catch up" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <Text as="h2" variant="small-strong" className="flex-1">
          Catch up
        </Text>
        <Text as="span" variant="small" color="secondary" className="tabular-nums" role="status">
          {position + 1} of {queue.length}
        </Text>
        <Button size="small" variant="transparent" onClick={onExit}>
          Done for now
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Overdue items handled"
        aria-valuemin={0}
        aria-valuemax={queue.length}
        aria-valuenow={position}
        className="h-1 overflow-hidden rounded-full bg-control-subtle"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${(position / queue.length) * 100}%` }}
        />
      </div>
      <article className="flex flex-col gap-1 rounded-xl bg-well p-3">
        <Text as="p" variant="small" color="red">
          {due ? `Due ${due.toLowerCase()}` : "Overdue"}
        </Text>
        <Text as="h3" variant="large-strong">
          {todo.title}
        </Text>
        <Text as="p" variant="small" color="tertiary">
          {SOURCE_META[todo.source].label} · {todo.listTitle}
        </Text>
        {todo.notes ? (
          <Text
            as="p"
            variant="small"
            color="secondary"
            className="line-clamp-4 whitespace-pre-line"
          >
            {todo.notes}
          </Text>
        ) : null}
      </article>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="accent" className="col-span-2" disabled={busy} onClick={done}>
          Done
          <Kbd className="bg-white/20 text-inherit">D</Kbd>
        </Button>
        {choices.map((choice) => (
          <Button key={choice.id} variant="muted" disabled={busy} onClick={() => move(choice)}>
            {choice.label}
            <Kbd>{choice.key}</Kbd>
          </Button>
        ))}
      </div>
      {editable ? null : (
        <Text as="p" variant="small" color="secondary" className="px-1">
          {RECURRING_NOTE}
        </Text>
      )}
      <div className="flex items-center justify-between">
        {editable ? <DeleteButton todo={todo} onDeleted={next} /> : <span />}
        <Button size="small" variant="transparent" onClick={next}>
          Skip
          <Kbd>S</Kbd>
        </Button>
      </div>
    </section>
  );
}
