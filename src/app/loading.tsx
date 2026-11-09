import { LoadSpinner } from "@/ui/LoadSpinner";

/** Route-level loading: only the rings, centered on the viewport. */
export default function Loading() {
  return (
    <main className="load-screen" aria-busy="true" aria-label="Loading">
      <LoadSpinner />
    </main>
  );
}
