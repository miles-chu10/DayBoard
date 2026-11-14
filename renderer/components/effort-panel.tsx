import { useId, useRef, type ReactNode } from "react";
import { ChevronsUpDown, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Slider,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";

import { ULTRA_WARNING, effortHint, effortLabel, selectionLabel } from "../../shared/ai-effort";

export interface EffortPanelProps {
  modelLabel: string;
  /** The provider that serves the model, shown beside its name. */
  providerLabel: string;
  /** The provider's mark, drawn before the model name. */
  modelIcon?: ReactNode;
  /** Levels the model accepts, lowest first; empty when it has no effort control. */
  levels: string[];
  /** Shown in place of the slider when `levels` is empty. */
  note: string;
  /** The level shown; `explicit` is false while the model default applies. */
  selection: { level: string | null; explicit: boolean };
  /** Who picks the effort while no level is chosen. */
  defaultNote: string;
  /** The provider's own one-line description of each level, where it has one. */
  descriptions?: Record<string, string>;
  /** Saves a level, or "" to return to the model default. */
  onChange: (level: string) => void;
  /** Present only where Fast mode exists. */
  fast: { on: boolean; onToggle: () => void; note?: string } | null;
  /** Tooltip for the dimmed Ultra stop on routes that have a slider but no Ultra. */
  ultraNote: string | null;
  /** Items of the provider and model menu that the model row opens. */
  modelMenu: ReactNode;
  /** The model, effort and Fast mode the next request uses. */
  nextRequest: string;
  /** What the chat's last reply recorded; null before any reply. */
  lastReply: string | null;
}

const SECTION_LABEL = "text-small font-medium text-tertiary";

/** The model and effort popover above the composer's model chip. */
export function EffortPanel({
  modelLabel,
  providerLabel,
  modelIcon,
  levels,
  note,
  selection,
  defaultNote,
  descriptions,
  onChange,
  fast,
  ultraNote,
  modelMenu,
  nextRequest,
  lastReply,
}: EffortPanelProps) {
  // With an unknown default the thumb rests on the middle stop, and a press there must still count.
  const movedRef = useRef(false);
  const fastId = useId();
  const index = selection.level
    ? levels.indexOf(selection.level)
    : Math.floor((levels.length - 1) / 2);
  const label = selectionLabel(selection.level);
  const value = selection.explicit
    ? label
    : selection.level
      ? `Default (${effortLabel(selection.level)})`
      : "Default";
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1.5 p-3">
        <span className={SECTION_LABEL}>Model</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Change model: ${modelLabel}`}
              title={modelLabel}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg bg-control-subtle px-2.5 text-left text-regular text-primary",
                "transition-colors hover:bg-control data-[state=open]:bg-control",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              {modelIcon}
              <span className="min-w-0 truncate font-medium">{modelLabel}</span>
              <span className="shrink-0 text-small text-tertiary">{providerLabel}</span>
              <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-tertiary" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={6}>
            {modelMenu}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-1 border-t border-separator p-3">
        <div className="flex h-5 items-center gap-2">
          <span className={SECTION_LABEL}>Effort</span>
          {levels.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Reset effort to the model default"
                title="Use the model default"
                disabled={!selection.explicit}
                onClick={() => onChange("")}
                className={cn(
                  "ml-auto rounded px-1 text-small text-accent hover:underline disabled:invisible",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                )}
              >
                Reset
              </button>
              <span
                className={cn(
                  "text-regular font-medium",
                  selection.explicit ? "text-primary" : "text-secondary",
                )}
              >
                {value}
              </span>
            </>
          ) : null}
        </div>
        {levels.length > 1 ? (
          <>
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-2">
              <Slider
                ticks
                min={0}
                max={levels.length - 1}
                step={1}
                value={[index]}
                thumbLabel="Effort"
                thumbValueText={label}
                thumbClassName={
                  selection.explicit
                    ? undefined
                    : "bg-background shadow-none ring-[1.5px] ring-inset ring-tertiary"
                }
                rangeClassName={selection.explicit ? undefined : "bg-transparent"}
                onPointerDown={() => {
                  movedRef.current = false;
                }}
                onValueChange={([next]) => {
                  movedRef.current = true;
                  onChange(levels[next]);
                }}
                onPointerUp={() => {
                  if (!movedRef.current && !selection.explicit) onChange(levels[index]);
                }}
              />
              {ultraNote ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      tabIndex={0}
                      aria-label="Ultra, not available for this model"
                      className="row-span-2 flex cursor-default flex-col items-center gap-2.5 self-start rounded border-l border-separator pl-2 pt-2 text-small text-quaternary outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="size-2 rounded-full border border-current" />
                      Ultra
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-60 leading-snug">
                    {ultraNote}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <div className="flex justify-between pt-1.5 text-small text-tertiary" aria-hidden>
                <span>{effortLabel(levels[0])}</span>
                <span>{effortLabel(levels[levels.length - 1])}</span>
              </div>
            </div>
            <p className="min-h-5 pt-1 text-small text-tertiary">
              {!selection.explicit || !selection.level
                ? defaultNote
                : selection.level === "ultra"
                  ? ULTRA_WARNING
                  : descriptions?.[selection.level] || effortHint(selection.level)}
            </p>
          </>
        ) : (
          <p className="text-small text-secondary">
            {levels.length === 1
              ? `${effortLabel(levels[0])} is the only effort for this model.`
              : note}
          </p>
        )}
      </div>

      {fast ? (
        <div className="flex items-start gap-2 border-t border-separator px-3 py-2.5">
          <Zap
            className={cn(
              "mt-0.5 size-4 shrink-0",
              fast.on ? "fill-current text-accent" : "text-tertiary",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <label htmlFor={fastId} className="block text-regular text-primary">
              Fast mode
            </label>
            {fast.note ? (
              <span id={`${fastId}-note`} className="block text-small text-tertiary">
                {fast.note}
              </span>
            ) : null}
          </div>
          <Switch
            id={fastId}
            checked={fast.on}
            onCheckedChange={fast.onToggle}
            aria-describedby={fast.note ? `${fastId}-note` : undefined}
          />
        </div>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-separator bg-control-subtle px-3 py-2 text-small">
        <dt className="text-tertiary">Next request: </dt>
        <dd className="min-w-0 text-secondary">{nextRequest}</dd>
        {lastReply ? (
          <>
            <dt className="text-tertiary">Last reply: </dt>
            <dd className="min-w-0 break-words text-secondary">{lastReply}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
