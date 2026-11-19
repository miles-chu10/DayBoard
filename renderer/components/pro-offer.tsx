import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Button, Text, cn } from "../ui";
import { openExternal } from "../lib/ipc";
import { PRO_BENEFITS, proBuyUrl, proPrice, type ProBuySource } from "../lib/license";

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
    <section aria-label="DayBoard Pro" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1">
        <Text variant="large-strong">DayBoard Pro · {price} once</Text>
        <Text variant="small" color="secondary">
          {note ? `${note} ` : ""}One payment, no subscription. 14-day refunds.
        </Text>
      </div>
      <ul className="flex flex-col gap-1.5 text-small">
        {PRO_BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>
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
