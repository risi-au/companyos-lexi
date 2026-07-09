import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-[var(--space-4)] text-[var(--fg)]">
      <section className="w-full max-w-md rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-[var(--shadow)]">
        <div className="font-mono text-[var(--text-caption)] uppercase tracking-normal text-[var(--mutedfg)]">404</div>
        <h1 className="mt-[var(--space-2)] text-[var(--text-page-title)] font-semibold">This page doesn&apos;t exist.</h1>
        <p className="mt-[var(--space-2)] text-[var(--text-body)] text-[var(--mutedfg)]">
          The record may have moved, or you may not have access to it.
        </p>
        <Link
          href="/s/root"
          className="mt-[var(--space-4)] inline-flex min-h-[44px] items-center rounded-[var(--radius-3)] bg-[var(--primary)] px-[var(--space-4)] text-[var(--text-body)] font-medium text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          Back to root
        </Link>
      </section>
    </main>
  );
}
