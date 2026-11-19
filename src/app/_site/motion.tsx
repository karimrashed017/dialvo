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

/** Counts 0..frames-1 every `ms` while the element is on screen. */
export function useTicker<T extends Element>(
  frames: number,
  ms: number,
  still = 0,
) {
  const ref = useRef<T>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setT(still));
      return () => cancelAnimationFrame(id);
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(timer);
      timer = undefined;
      if (e.isIntersecting)
        timer = setInterval(() => setT((n) => (n + 1) % frames), ms);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [frames, ms, still]);
  return [ref, t] as const;
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
