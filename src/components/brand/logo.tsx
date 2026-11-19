import { cn } from "@/lib/utils";

// The logo is plain files in public/brand (logo.svg, logo-white.svg,
// mark.svg, mark-white.svg). The final logo isn't picked yet: to change it,
// replace those files and keep their names. The <img> takes its width from
// the file's own proportions, so a new shape needs no code change.

/** The wordmark. Set the height with a class; `white` for dark backgrounds. */
export function Logo({
  className,
  white,
}: {
  className?: string;
  white?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local SVG; next/image adds nothing here
    <img
      src={white ? "/brand/logo-white.svg" : "/brand/logo.svg"}
      alt="Dialvo"
      className={cn("block h-6 w-auto", className)}
    />
  );
}

/** The mark on its own, e.g. as the caller's avatar. */
export function Mark({
  className,
  white,
}: {
  className?: string;
  white?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local SVG
    <img
      src={white ? "/brand/mark-white.svg" : "/brand/mark.svg"}
      alt=""
      aria-hidden
      className={cn("block size-6", className)}
    />
  );
}

/** The mark in a blue circle: the agent's picture in product visuals. */
export function MarkAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[#1F3BFF]",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local SVG, swapped with the logo files */}
      <img src="/brand/mark-white.svg" alt="" className="h-[58%] w-[58%]" />
    </span>
  );
}
