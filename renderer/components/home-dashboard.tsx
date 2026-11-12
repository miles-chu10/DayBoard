import { createContext, useContext, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, SlidersHorizontal } from "lucide-react";
import { Button, Text } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import {
  defaultHomeLayout,
  isHomeLayout,
  moveHomeModule,
  type HomeModuleId,
  type HomeModule,
} from "../lib/home-layout";
import { readStored, writeStored } from "../lib/storage";

const KEY = "home:layout:v1";
const CardContext = createContext<{ collapsed: boolean; toggle: () => void } | null>(null);
export function HomeCard({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const card = useContext(CardContext);
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-1 rounded-xl bg-well px-2 pb-2 pt-1"
    >
      <div className="flex min-h-9 flex-wrap items-center gap-2 px-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`${card?.collapsed ? "Expand" : "Collapse"} ${title}`}
          aria-expanded={!card?.collapsed}
          onClick={card?.toggle}
        >
          <ChevronDown
            className={cn("size-3 shrink-0 transition-transform", card?.collapsed && "-rotate-90")}
          />
          <Text variant="strong" as="h2" className="min-w-0 truncate">
            {title}
          </Text>
        </button>
        {count !== undefined ? (
          <Text variant="small" color="secondary" className="tabular-nums">
            {count}
          </Text>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-1">{action}</span>
      </div>
      {!card?.collapsed && children}
    </section>
  );
}

export function HomeDashboard({
  modules,
  rangeControl,
}: {
  rangeControl?: ReactNode;
  modules: { id: HomeModuleId; title: string; content: ReactNode }[];
}) {
  const [layout, setLayout] = useState(() => readStored(KEY, isHomeLayout) ?? defaultHomeLayout());
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<HomeModuleId | null>(null);
  const [notice, setNotice] = useState("");
  function save(next: HomeModule[]) {
    setLayout(next);
    try {
      writeStored(KEY, next);
      setNotice("");
    } catch {
      setNotice("Layout changed for this window, but could not be saved. Check available storage.");
    }
  }
  function patch(id: HomeModuleId, change: Partial<HomeModule>) {
    save(layout.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }
  const shown = layout.filter(
    (item) => modules.some((module) => module.id === item.id) && (editing || !item.hidden),
  );
  // A tall Agenda occupies the left column; short action cards stack beside it. Custom
  // ordering/sizes remain ordinary row-major grid placement, never CSS visual reordering.
  const defaultPlacement =
    layout.map((item) => item.id).join() === HOME_MODULES_ORDER &&
    !layout.find((item) => item.id === "agenda")?.wide &&
    !layout.find((item) => item.id === "agenda")?.hidden &&
    layout.every((item) => item.wide === (item.id === "meeting"));
  const rendered = shown.map((item) => {
    const module = modules.find((candidate) => candidate.id === item.id)!;
    const index = layout.findIndex((candidate) => candidate.id === item.id);
    return (
      <div
        key={item.id}
        data-home-module={item.id}
        className={cn(
          "min-w-0",
          item.wide && "@3xl:col-span-2",

          editing && "rounded-xl border border-separator p-2",
          editing && item.hidden && "opacity-60",
        )}
        onDragOver={(event) => {
          if (dragging) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragging) save(moveHomeModule(layout, dragging, index));
          setDragging(null);
        }}
      >
        {editing && (
          <div
            className="mb-2 flex flex-wrap items-center gap-1"
            aria-label={`Customize ${module.title}`}
          >
            <button
              type="button"
              draggable
              aria-label={`Drag ${module.title}`}
              title={`Drag ${module.title} to reorder`}
              className="cursor-grab rounded p-1"
              onDragStart={(event) => {
                setDragging(item.id);
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(null)}
            >
              <GripVertical className="size-4" />
            </button>
            <Text variant="small-strong">{module.title}</Text>
            <Button
              size="small"
              iconOnly
              variant="transparent"
              aria-label={`Move ${module.title} up`}
              disabled={index === 0}
              onClick={() => save(moveHomeModule(layout, item.id, index - 1))}
            >
              <ArrowUp />
            </Button>
            <Button
              size="small"
              iconOnly
              variant="transparent"
              aria-label={`Move ${module.title} down`}
              disabled={index === layout.length - 1}
              onClick={() => save(moveHomeModule(layout, item.id, index + 1))}
            >
              <ArrowDown />
            </Button>
            <Button
              size="small"
              variant="transparent"
              aria-label={`${item.hidden ? "Show" : "Hide"} ${module.title}`}
              onClick={() => patch(item.id, { hidden: !item.hidden })}
            >
              {item.hidden ? "Show" : "Hide"}
            </Button>
            <Button
              size="small"
              variant="transparent"
              aria-label={`Set ${module.title} ${item.wide ? "half" : "wide"}`}
              onClick={() => patch(item.id, { wide: !item.wide })}
            >
              {item.wide ? "Wide" : "Half"}
            </Button>
          </div>
        )}
        <CardContext.Provider
          value={{
            collapsed: item.collapsed,
            toggle: () => patch(item.id, { collapsed: !item.collapsed }),
          }}
        >
          {item.id === "meeting" ? (
            <HomeCard title="Up next meeting">{module.content}</HomeCard>
          ) : (
            module.content
          )}
        </CardContext.Provider>
      </div>
    );
  });
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap items-center justify-end gap-2"
        aria-label="Home layout controls"
      >
        {rangeControl}
        {editing && (
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              save(defaultHomeLayout());
              setNotice("Default Home layout restored.");
            }}
          >
            Reset layout
          </Button>
        )}
        <Button
          size="small"
          variant={editing ? "accent" : "transparent"}
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        >
          <SlidersHorizontal />
          {editing ? "Done" : "Customize"}
        </Button>
      </div>
      <p className="sr-only" role="status">
        {notice}
      </p>
      {editing && (
        <Text color="secondary" variant="small">
          Drag a handle or use the arrow buttons to reorder. Hidden cards stay here until you select
          Done.
        </Text>
      )}
      {!shown.length && (
        <Text color="secondary">
          All Home cards are hidden. Choose Customize to show them again.
        </Text>
      )}
      <div className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-2" aria-label="Home cards">
        {defaultPlacement && !editing ? (
          <>
            {rendered.find((node) => node.key === "meeting")}
            {rendered.find((node) => node.key === "agenda")}
            <div className="flex min-w-0 flex-col gap-4">
              {rendered.filter((node) => node.key === "suggested" || node.key === "waiting")}
            </div>
          </>
        ) : (
          rendered
        )}
      </div>
    </div>
  );
}
const HOME_MODULES_ORDER = "meeting,agenda,suggested,waiting";
