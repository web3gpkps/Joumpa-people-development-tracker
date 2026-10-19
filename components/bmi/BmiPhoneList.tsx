"use client";

import { BmiCard, type BmiCardProps } from "./BmiCard";
import { useStableOrder } from "./stable-order";

type BmiPhoneListProps = {
  /** The full label of the chosen check, "BMI Cek ke-3 (Periode 9-22 Nov 2026)": shown above the cards. */
  label: string;
  /** Already sorted due/late first; the order then stays put while people are saved. */
  cards: Array<Omit<BmiCardProps, "accessKey">>;
  accessKey: string;
  /** More people match than are listed (a "Tampilkan" button follows the list). */
  more: boolean;
};

const cardKey = (c: Omit<BmiCardProps, "accessKey">) => c.person.code;

/** Phone view of Cek BMI: one card per person for the chosen slot. */
export function BmiPhoneList({ label, cards, accessKey, more }: BmiPhoneListProps) {
  const ordered = useStableOrder(cards, cardKey);
  return (
    <>
      <h3 className="bmi-phone-period">{label}</h3>
      <ol aria-label={label} data-more={more} className="flex flex-col divide-y divide-line">
        {ordered.map((card) => (
          <BmiCard key={`${card.person.code}-${card.period}`} accessKey={accessKey} {...card} />
        ))}
      </ol>
    </>
  );
}
