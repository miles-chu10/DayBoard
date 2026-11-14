import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "./utils";

export interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  /** Accessible name of the single thumb, which carries role="slider". */
  thumbLabel: string;
  /** Spoken value, such as a level name instead of its index. */
  thumbValueText?: string;
  thumbClassName?: string;
  rangeClassName?: string;
  /** Draws a tick mark at every step, as a macOS slider with discrete values does. */
  ticks?: boolean;
}

// Radix keeps the thumb inside the track, so a stop sits half a thumb in from each end.
const THUMB = "1.125rem";

/** A macOS-style single-thumb slider: a thin track, accent fill up to a white thumb. */
export function Slider({
  className,
  thumbLabel,
  thumbValueText,
  thumbClassName,
  rangeClassName,
  ticks,
  ...props
}: SliderProps) {
  const { min = 0, max = 100, step = 1 } = props;
  const stops = ticks ? Math.round((max - min) / step) : 0;
  return (
    <SliderPrimitive.Root
      className={cn(
        "group relative flex h-6 touch-none select-none items-center data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-control">
        <SliderPrimitive.Range className={cn("absolute h-full bg-accent", rangeClassName)} />
      </SliderPrimitive.Track>
      {stops > 0
        ? Array.from({ length: stops + 1 }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 translate-y-1.5 rounded-full bg-tertiary opacity-60"
              style={{
                left: `calc(${THUMB} / 2 + (100% - ${THUMB}) * ${index / stops})`,
              }}
            />
          ))
        : null}
      <SliderPrimitive.Thumb
        aria-label={thumbLabel}
        aria-valuetext={thumbValueText}
        className={cn(
          "block size-[1.125rem] rounded-full bg-white shadow-[0_0.5px_2px_rgb(0_0_0/0.35),0_0_0_0.5px_rgb(0_0_0/0.12)]",
          "transition-[background-color,box-shadow] duration-150 ease-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          thumbClassName,
        )}
      />
    </SliderPrimitive.Root>
  );
}
