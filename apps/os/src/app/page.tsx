import { Button } from "@companyos/ui";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-[var(--space-4)] bg-[var(--background)] p-[var(--space-8)]">
      <h1 className="text-[var(--font-size-3xl)] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
        CompanyOS
      </h1>
      <Button>Get started</Button>
    </main>
  );
}