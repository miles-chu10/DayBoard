import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Badge, Button, Text, cn } from "../ui";
import { openExternal } from "../lib/ipc";
import { PRO_BENEFITS, proBuyUrl, proPrice, type ProBuySource } from "../lib/license";
import { AppMark } from "./app-mark";

/** What Pro adds, as a checklist. */
export function ProBenefits({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2 text-small", className)}>
      {PRO_BENEFITS.map((benefit) => (
        <li key={benefit} className="flex items-start gap-2">
          <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-support-green-10 text-support-green">
            <Check className="size-3" strokeWidth={2.5} aria-hidden />
          </span>
          <span>{benefit}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * DayBoard Pro's price, how long the launch price lasts and what Pro adds, with its buy button.
 * Shown where someone decides whether to buy: Settings → License and the sidebar's trial card.
 */
export function ProOffer({
  checkoutUrl,
  from,
  secondary,
  className,
}: {
  checkoutUrl: string;
  from: ProBuySource;
  /** A second action beside the buy button, such as "Enter key". */
  secondary?: ReactNode;
  className?: string;
}) {
  const { price, note } = proPrice();
  const buyUrl = proBuyUrl(checkoutUrl, from);
  return (
    <section
      aria-label="DayBoard Pro"
      data-pro-offer
      className={cn("flex flex-col gap-3.5", className)}
    >
      <div className="flex items-center gap-3">
        <AppMark className="size-11" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text variant="large-strong">DayBoard Pro</Text>
          <Text variant="small" color="secondary">
            One payment, no subscription. 14-day refunds.
          </Text>
        </div>
        <div className="flex shrink-0 items-baseline gap-1" aria-label={`${price} once`}>
          <Text variant="heading2">{price}</Text>
          <Text variant="small" color="secondary">
            once
          </Text>
        </div>
      </div>
      {note ? (
        <Badge color="blue" className="self-start">
          {note.replace(/\.$/, "")}
        </Badge>
      ) : null}
      <ProBenefits />
      {buyUrl || secondary ? (
        <div className="flex flex-wrap gap-2">
          {buyUrl ? (
            <Button variant="accent" onClick={() => void openExternal(buyUrl)}>
              Get DayBoard Pro
            </Button>
          ) : null}
          {secondary}
        </div>
      ) : null}
    </section>
  );
}
