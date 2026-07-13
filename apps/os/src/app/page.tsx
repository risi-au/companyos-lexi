import { redirect } from "next/navigation";

/**
 * Fallback only. Authenticated `/` is redirected to `/s/root` in middleware
 * (see `src/middleware.ts`) so production never relies on this page after login.
 * Keep a single top-level home page — do not add `app/(app)/page.tsx` (Next 15.5
 * can 500 server-only pages in a route group when clientReferenceManifest is omitted).
 */
export default function HomePage() {
  redirect("/s/root");
}

