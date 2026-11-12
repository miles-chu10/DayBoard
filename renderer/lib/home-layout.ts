export const HOME_MODULES = ["meeting", "agenda", "suggested", "waiting"] as const;
export type HomeModuleId = (typeof HOME_MODULES)[number];
export type HomeModule = { id: HomeModuleId; hidden: boolean; collapsed: boolean; wide: boolean };
export const defaultHomeLayout = (): HomeModule[] =>
  HOME_MODULES.map((id) => ({
    id,
    hidden: false,
    collapsed: false,
    wide: id === "meeting",
  }));
export function isHomeLayout(value: unknown): value is HomeModule[] {
  return (
    Array.isArray(value) &&
    value.length === HOME_MODULES.length &&
    new Set(value.map((item) => item?.id)).size === HOME_MODULES.length &&
    value.every(
      (item) =>
        item &&
        HOME_MODULES.includes(item.id) &&
        typeof item.hidden === "boolean" &&
        typeof item.collapsed === "boolean" &&
        typeof item.wide === "boolean",
    )
  );
}
export function moveHomeModule(layout: HomeModule[], id: HomeModuleId, to: number): HomeModule[] {
  const from = layout.findIndex((item) => item.id === id);
  if (from < 0 || to < 0 || to >= layout.length || from === to) return layout;
  const next = [...layout];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
