"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// The site's scroll motion: headlines arrive word by word out of a soft
// blur, everything else rises 24px and fades in as it scrolls into view. People who ask their
// system for less motion get the finished state straight away.

function useInView<T extends Element>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setSeen(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

/** A headline whose words arrive one after another out of a blur. */
export function Words({
  text,
  as: Tag = "h2",
  className,
  delay = 0,
  step = 0.06,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  step?: number;
}) {
  const [ref, seen] = useInView<HTMLHeadingElement>();
  const words = text.split(" ");
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-block transition-[opacity,filter,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,filter,transform]"
          style={{
            opacity: seen ? 1 : 0.001,
            filter: seen ? "blur(0)" : "blur(12px)",
            transform: seen ? "none" : "translateY(18px)",
            transitionDelay: `${delay + i * step}s`,
          }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}

/** Rises 24px and fades in when it scrolls into view. */
export function Rise({
  children,
  className,
  delay = 0,
  as: Tag = "div",
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
  style?: CSSProperties;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <Tag
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        className,
      )}
      style={{
        ...style,
        opacity: seen ? 1 : 0.001,
        transform: seen ? "none" : "translateY(24px)",
        transitionDelay: `${delay}s`,
      }}
    >
      {children}
    </Tag>
  );
}

/** True once the page has scrolled past `px`: the nav turns to glass. */
export function useScrolled(px = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > px);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [px]);
  return scrolled;
}

/**
 * The hero's product shot: it starts low and tilted back, then straightens
 * and rises over the painting as the page scrolls, like the template's.
 */
export function HeroLift({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const p = Math.min(Math.max(window.scrollY / 520, 0), 1);
        el.style.transform = `perspective(1600px) translateY(${(1 - p) * 40}px) rotateX(${(1 - p) * 14}deg) scale(${0.94 + p * 0.06})`;
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", on);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="origin-top will-change-transform"
      style={{
        transform:
          "perspective(1600px) translateY(40px) rotateX(14deg) scale(0.94)",
      }}
    >
      {children}
    </div>
  );
}

/** Counts up to a number once it's in view. */
export function CountUp({
  to,
  suffix = "",
  prefix = "",
  decimals = 0,
}: {
  to: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - start) / 1400, 1);
      setN(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to]);
  return (
    <span ref={ref}>
      {prefix}
      {n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
