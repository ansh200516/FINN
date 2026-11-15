import { useEffect, useState } from "react";
import {
  advanceGhost,
  COMPOSER_EXAMPLES,
  fieldHint,
  type GhostState,
  ghostDelay,
} from "@/ui/composer";

/**
 * Types the example questions into the placeholder. Typing stops while
 * the field has the user's text. `prefers-reduced-motion` leaves the
 * first example as a static placeholder. The input value is never set.
 */
export function useTypingExample(paused: boolean) {
  const examples = COMPOSER_EXAMPLES;
  const [ghost, setGhost] = useState<GhostState>({
    index: 0,
    shown: "",
    phase: "typing",
  });
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setAnimate(!media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!animate || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimate(false);
      return;
    }
    const delay = ghostDelay(ghost);
    const id = window.setTimeout(() => {
      setGhost((current) => advanceGhost(current, examples));
    }, delay);
    return () => window.clearTimeout(id);
  }, [ghost, animate, paused]);

  return fieldHint({
    animate,
    paused,
    examples,
    shown: ghost.shown,
    index: ghost.index,
  });
}
