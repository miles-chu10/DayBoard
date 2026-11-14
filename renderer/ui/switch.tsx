import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "./utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentProps<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative inline-flex h-[22px] w-9 shrink-0 items-center rounded-full transition-colors duration-150 ease-out",
      "bg-control data-[state=checked]:bg-accent",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:cursor-not-allowed disabled:opacity-40",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "block size-[18px] translate-x-0.5 rounded-full bg-white shadow transition-transform duration-150 ease-out",
        "data-[state=checked]:translate-x-[18px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
