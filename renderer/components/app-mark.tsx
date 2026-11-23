import appIcon from "../../app-icon.png";

import { cn } from "../ui";

/** DayBoard's app icon, for places that name the product or its Pro license. */
export function AppMark({ className }: { className?: string }) {
  return <img src={appIcon} alt="" draggable={false} className={cn("shrink-0", className)} />;
}
