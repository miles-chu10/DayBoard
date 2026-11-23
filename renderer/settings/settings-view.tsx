import { useEffect, useState } from "react";
import { BadgeCheck, Layers, RefreshCw, Server, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  FieldLayout,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsRoot,
  TabsTrigger,
  Toolbar,
  ToolbarContent,
  ToolbarRow,
  ToolbarTitle,
} from "@renderer/ui";

import { useAppearanceSync } from "../lib/appearance";
import { useBackendSync } from "../lib/queries";
import { AITab } from "./ai-tab";
import { GeneralTab } from "./general-tab";
import { McpTab } from "./mcp-tab";
import { SourcesTab } from "./sources-tab";
import { LicenseTab } from "./license-tab";
import { UpdatesTab } from "./updates-tab";
import { UsageCheckInSettings } from "./usage-settings";
import { FeedbackSettings } from "./feedback-settings";
import { isAppStoreBuild } from "@shared/app-store-build";
import { isSettingsTab as isKnownTab, type SettingsTab } from "@shared/settings-navigation";

// The App Store edition sells through the App Store, so it has no License tab.
const isSettingsTab = (value: unknown): value is SettingsTab =>
  isKnownTab(value) && !(isAppStoreBuild && value === "license");

const TAB_CONTENT_CLASS = "mx-auto flex w-full max-w-[40rem] flex-col gap-7 px-5 pb-8 pt-1";

const SECTIONS = [
  { id: "general", title: "General", icon: SlidersHorizontal },
  { id: "sources", title: "Sources", icon: Layers },
  { id: "ai", title: "AI", icon: Sparkles },
  { id: "mcp", title: "MCP Servers", icon: Server },
  { id: "license", title: "License", icon: BadgeCheck },
  { id: "updates", title: "Updates", icon: RefreshCw },
] as const satisfies readonly { id: SettingsTab; title: string; icon: unknown }[];

const NAV_ITEM_CLASS =
  "h-8 w-full justify-start gap-2 rounded-md px-2 text-regular font-normal text-primary hover:bg-list-hover " +
  "data-[state=active]:bg-list-selection data-[state=active]:font-semibold data-[state=active]:shadow-none";

export function SettingsView() {
  useBackendSync();
  useAppearanceSync();
  const [tab, setTab] = useState<SettingsTab>(() => {
    const requested = window.location.hash.slice(1);
    return isSettingsTab(requested) ? requested : "general";
  });
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("settings:selectTab", (payload) => {
        const requested =
          payload && typeof payload === "object" && "tab" in payload ? payload.tab : undefined;
        if (isSettingsTab(requested)) setTab(requested);
      }),
    [],
  );

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper], [role='dialog']")) {
        return;
      }

      event.preventDefault();
      window.dayboard.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const sections = SECTIONS.filter((section) => isSettingsTab(section.id));
  return (
    <TabsRoot
      value={tab}
      orientation="vertical"
      onValueChange={(value) => {
        if (isSettingsTab(value)) setTab(value);
      }}
      className="flex h-full"
    >
      <div className="flex w-[11.5rem] shrink-0 flex-col border-r border-separator/60 bg-background-secondary px-2 pt-3">
        <Tabs
          variant="transparent"
          aria-label="Settings sections"
          className="h-auto flex-col items-stretch gap-0.5 rounded-none p-0"
        >
          {sections.map(({ id, title, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className={NAV_ITEM_CLASS}>
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-md bg-control-subtle text-secondary"
              >
                <Icon className="size-[15px]" strokeWidth={1.75} />
              </span>
              {title}
            </TabsTrigger>
          ))}
        </Tabs>
      </div>
      <ScrollArea
        className="h-full min-w-0 flex-1"
        toolbar={
          <Toolbar inset="none">
            <ToolbarRow className="mx-auto w-full max-w-[40rem] px-8">
              <ToolbarContent>
                <ToolbarTitle as="h1" className="text-[17px] font-semibold">
                  {sections.find((section) => section.id === tab)?.title}
                </ToolbarTitle>
              </ToolbarContent>
            </ToolbarRow>
          </Toolbar>
        }
      >
        <FieldLayout layout="row">
          <TabsContent value="general" className={TAB_CONTENT_CLASS}>
            <GeneralTab />
          </TabsContent>
          <TabsContent value="sources" className={TAB_CONTENT_CLASS}>
            <SourcesTab />
          </TabsContent>
          <TabsContent value="ai" className={TAB_CONTENT_CLASS}>
            <AITab />
          </TabsContent>
          <TabsContent value="mcp" className={TAB_CONTENT_CLASS}>
            <McpTab />
          </TabsContent>
          {isAppStoreBuild ? null : (
            <TabsContent value="license" className={TAB_CONTENT_CLASS}>
              <LicenseTab />
            </TabsContent>
          )}
          <TabsContent value="updates" className={TAB_CONTENT_CLASS}>
            <UpdatesTab />
            <FeedbackSettings />
            <UsageCheckInSettings />
          </TabsContent>
        </FieldLayout>
      </ScrollArea>
    </TabsRoot>
  );
}
