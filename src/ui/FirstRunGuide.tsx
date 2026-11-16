"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TOUR_DISMISSED, TOUR_STEPS, TOUR_STORAGE_KEY } from "./tour";

interface Ring {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * First open on this browser. A card in the phone column, with a hairline
 * around the control it is talking about. Skip and Done both dismiss it.
 * The rest of the app stays usable.
 */
export function FirstRunGuide() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [ring, setRing] = useState<Ring | null>(null);
  const [place, setPlace] = useState<"top" | "bottom">("bottom");
  const step = TOUR_STEPS[index];

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed =
        window.localStorage.getItem(TOUR_STORAGE_KEY) === TOUR_DISMISSED;
    } catch {
      dismissed = false;
    }
    if (!dismissed) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open || !step) return;
    if (pathname !== step.href) router.push(step.href);
  }, [open, step, pathname, router]);

  useEffect(() => {
    if (!open || !step || pathname !== step.href) {
      setRing(null);
      return;
    }
    let stopped = false;
    let scrolled = false;
    let observed: HTMLElement | null = null;
    const apply = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      if (stopped || rect.width < 1 || rect.height < 1) return;
      const top = Math.round(rect.top) - 4;
      const left = Math.round(rect.left) - 4;
      const width = Math.round(rect.width) + 8;
      const height = Math.round(rect.height) + 8;
      setRing((prev) =>
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width &&
        prev.height === height
          ? prev
          : { top, left, width, height },
      );
      const mid = rect.top + rect.height / 2;
      const nextPlace = mid > window.innerHeight * 0.45 ? "top" : "bottom";
      setPlace((prev) => (prev === nextPlace ? prev : nextPlace));
    };
    const observer = new ResizeObserver(() => {
      if (observed) apply(observed);
    });
    const measure = (scroll: boolean) => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!(el instanceof HTMLElement)) return;
      if (observed !== el) {
        observer.observe(el);
        observed = el;
      }
      if (scroll && !scrolled) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        scrolled = true;
      }
      apply(el);
    };
    measure(true);
    const tick = window.setInterval(() => measure(false), 150);
    const onMove = () => measure(false);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      stopped = true;
      observer.disconnect();
      window.clearInterval(tick);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, step, pathname]);

  function dismiss() {
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, TOUR_DISMISSED);
    } catch {
      // Still close. The tour must not trap the page.
    }
    setOpen(false);
    setRing(null);
  }

  if (!open || !step) return null;
  const last = index >= TOUR_STEPS.length - 1;

  return (
    <>
      {ring ? (
        <div
          className="tour-ring"
          style={{
            top: ring.top,
            left: ring.left,
            width: ring.width,
            height: ring.height,
          }}
          aria-hidden="true"
        />
      ) : null}
      <section
        className={`tour ${place === "top" ? "tour-top" : "tour-bottom"}`}
        aria-label="First-run guide"
        data-tour-card=""
      >
        <p className="tour-kicker">
          {index + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={dismiss}>
            Skip tour
          </button>
          <button
            type="button"
            className="tour-next"
            onClick={() => {
              if (last) dismiss();
              else setIndex((n) => n + 1);
            }}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </section>
    </>
  );
}
