/**
 * Concentric-ring loader, redrawn in SVG from Bilal Naseer's free "loading"
 * animation (https://lottiefiles.com/free-animation/loading-6qYNAffZi3).
 * No Lottie runtime: the rings rise, draw on, draw off, and drop in CSS.
 * `prefers-reduced-motion` keeps the seated arcs and does not spin.
 *
 * Lottie Simple License (FL 9.13.21)
 * Copyright © 2021 Design Barn Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of the public animation files available for download at the LottieFiles site
 * (“Files”) to download, reproduce, modify, publish, distribute, publicly
 * display, and publicly digitally perform such Files, including for commercial
 * purposes, provided that any display, publication, performance, or
 * distribution of Files must contain (and be subject to) the same terms and
 * conditions of this license. Modifications to Files are deemed derivative
 * works and must also be expressly distributed under the same terms and
 * conditions of this license. You may not purport to impose any additional or
 * different terms or conditions on, or apply any technical measures that
 * restrict exercise of, the rights granted under this license. This license
 * does not include the right to collect or compile Files from LottieFiles to
 * replicate or develop a similar or competing service.
 *
 * Use of Files without attributing the creator(s) of the Files is permitted
 * under this license, though attribution is strongly encouraged. If
 * attributions are included, such attributions should be visible to the end
 * user.
 *
 * FILES ARE PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. EXCEPT TO THE EXTENT
 * REQUIRED BY APPLICABLE LAW, IN NO EVENT WILL THE CREATOR(S) OF FILES OR
 * DESIGN BARN, INC. BE LIABLE ON ANY LEGAL THEORY FOR ANY SPECIAL, INCIDENTAL,
 * CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES ARISING OUT OF THIS LICENSE OR
 * THE USE OF SUCH FILES.
 */

const RINGS = [
  { id: "blue", r: 187.678, stroke: "#00A8F2" },
  { id: "orange", r: 140.759, stroke: "#F9A806" },
  { id: "pink", r: 93.84, stroke: "#F203D0" },
] as const;

/** Hero mark for the route loading screen. Decorative: the lines carry the status. */
export function LoadSpinner() {
  return (
    <svg
      className="load-spin"
      viewBox="0 0 500 500"
      aria-hidden="true"
      focusable="false"
    >
      {RINGS.map((ring) => (
        <circle
          key={ring.id}
          className={`load-spin-ring load-spin-ring-${ring.id}`}
          cx="250"
          cy="250"
          r={ring.r}
          stroke={ring.stroke}
        />
      ))}
    </svg>
  );
}
