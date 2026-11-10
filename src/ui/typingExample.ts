import { useEffect, useState } from "react";
import {
  advanceGhost,
  type ComposerMode,
  type ComposerScope,
  composerExamples,
  fieldHint,
  type GhostState,
  ghostDelay,
} from "@/ui/composer";

/**
 * Types the selected mode's examples. Typing stops while the field has
 * the user's text. `prefers-reduced-motion` leaves the first example
 * as a static placeholder.
 */
export function useTypingExample(
  mode: ComposerMode,
  scope: ComposerScope,
  paused: boolean,
) {
  const examples = composerExamples(mode, scope);
  const key = `${mode}:${scope}`;
  const [cycle, setCycle] = useState(key);
  const [ghost, setGhost] = useState<GhostState>({
    index: 0,
    shown: "",
    phase: "typing",
  });
  const [animate, setAnimate] = useState(false);

  let active = ghost;
  if (cycle !== key) {
    active = { index: 0, shown: "", phase: "typing" };
    setCycle(key);
    setGhost(active);
  }

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
    const delay = ghostDelay(active);
    const id = window.setTimeout(() => {
      setGhost(advanceGhost(active, examples));
    }, delay);
    return () => window.clearTimeout(id);
  }, [active, animate, examples, paused]);

  return fieldHint({
    animate,
    paused,
    examples,
    shown: active.shown,
  });
}
