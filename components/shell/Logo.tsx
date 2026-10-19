import Image, { type StaticImageData } from "next/image";
import joumpa from "@/public/brand/joumpa-airport-vip-service.png";
import gapura from "@/public/brand/gapura-airport-services.png";
import { cx } from "@/components/ui/cx";

/*
 * The two official logos, never stretched, recoloured, cropped or redrawn. Each is drawn at
 * a set height with `width: auto` and its own aspect ratio (JOUMPA 1030 × 263, Gapura
 * 1052 × 569); the boxes cannot shrink, so a narrow parent cannot squash them. Both sit on
 * white (the JOUMPA tagline is dark grey).
 *
 * Optical balance: the JOUMPA wordmark fills most of its file's height while the Gapura word
 * sits in the lower half of a tall mark, so the JOUMPA logo is drawn at JOUMPA_SCALE of the
 * Gapura height.
 */
const JOUMPA_SCALE = 0.6;

function PartnerLogo({ src, alt, height, eager }: { src: StaticImageData; alt: string; height: number; eager: boolean }) {
  return (
    <Image
      src={src}
      alt={alt}
      width={Math.round(height * (src.width / src.height))}
      height={height}
      loading={eager ? "eager" : "lazy"}
      className="w-auto max-w-none shrink-0"
      style={{ height, aspectRatio: `${src.width} / ${src.height}` }}
    />
  );
}

type LogoProps = {
  /**
   * Height of the lockup in px (the Gapura logo; JOUMPA follows at JOUMPA_SCALE of it).
   * DESIGN.md sizes: sidebar 24, phone top bar 24, printed report 32, login 40.
   */
  height: 24 | 28 | 32 | 40;
  /** Logos sit at the top of every screen, so they load eagerly by default. */
  eager?: boolean;
  className?: string;
};

/**
 * Co-brand lockup: JOUMPA Airport VIP Service, a 1px --line divider, then Gapura Airport Services.
 * Server-component friendly.
 */
export function Logo({ height, eager = true, className }: LogoProps) {
  return (
    <span className={cx("inline-flex shrink-0 items-center", className)} style={{ gap: Math.round(height / 3) }}>
      <PartnerLogo src={joumpa} alt="JOUMPA Airport VIP Service" height={Math.round(height * JOUMPA_SCALE)} eager={eager} />
      <span aria-hidden="true" className="w-px shrink-0 self-stretch bg-line" />
      <PartnerLogo src={gapura} alt="Gapura Airport Services" height={height} eager={eager} />
    </span>
  );
}
