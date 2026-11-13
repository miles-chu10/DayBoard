import type { CaptureTarget } from "@shared/capture";

/** A list the menu-bar quick add can aim at, or "auto" to let the AI choose the destination. */
export interface TargetOption {
  key: string;
  target: CaptureTarget | null;
  title: string;
  group: "Google Tasks" | "Reminders" | null;
}

export const AUTO_KEY = "auto";
const AUTO: TargetOption = { key: AUTO_KEY, target: null, title: "Let AI decide", group: null };

interface ListInfo {
  id: string;
  title: string;
}

export function targetKey(target: CaptureTarget): string {
  return `${target.kind}:${target.listId}`;
}

/** Every list the quick add can write to now; "Let AI decide" leads while AI capture is on. */
export function targetOptions(input: {
  ai: boolean;
  tasks: ListInfo[] | null;
  reminders: ListInfo[] | null;
}): TargetOption[] {
  const lists = (kind: CaptureTarget["kind"], items: ListInfo[] | null): TargetOption[] =>
    (items ?? []).map((list) => {
      const target = { kind, listId: list.id };
      return {
        key: targetKey(target),
        target,
        title: list.title,
        group: kind === "task" ? "Google Tasks" : "Reminders",
      };
    });
  return [
    ...(input.ai ? [AUTO] : []),
    ...lists("task", input.tasks),
    ...lists("reminder", input.reminders),
  ];
}

/** The saved choice while it still exists, else the first option (AI, else the first list). */
export function chooseTarget(options: TargetOption[], saved: string | null): TargetOption | null {
  return options.find((option) => option.key === saved) ?? options[0] ?? null;
}
