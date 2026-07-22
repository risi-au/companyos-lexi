"use client";

type DigestItem = {
  id: string;
  title: string;
  scopePath: string;
  workType: string;
  status?: string;
  updatedAt?: Date;
  whyItNeedsYou?: string;
  whatHappensAfter?: string;
};

type DigestLane = {
  key: string;
  label: string;
  items: DigestItem[];
  note?: string;
};

type Digest = {
  scopePath: string;
  lanes: DigestLane[];
};

interface DigestViewProps {
  digest: Digest;
}

export function DigestView({ digest }: DigestViewProps) {
  return (
    <div className="space-y-[var(--space-6)]">
      <header>
        <h1 className="text-[var(--font-size-lg)] font-medium text-[var(--foreground)]">Digest</h1>
        <p className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          Generated {new Date().toLocaleString()}
        </p>
      </header>

      {digest.lanes.map((lane) => (
        <section key={lane.key} className="space-y-[var(--space-2)]">
          <div>
            <h2 className="text-[var(--font-size-md)] font-medium text-[var(--foreground)]">{lane.label}</h2>
          </div>
          {lane.note ? (
            <p className="rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--muted)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
              {lane.note}
            </p>
          ) : (
            <ul className="space-y-[var(--space-2)]">
              {lane.items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
                >
                  <div className="flex items-center gap-[var(--space-2)]">
                    <span className="text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">{item.title}</span>
                    <span className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--muted)] px-[var(--space-2)] py-px text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                      {item.workType}
                    </span>
                    <span className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{item.scopePath}</span>
                  </div>
                  {item.whyItNeedsYou && (
                    <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--foreground)]">{item.whyItNeedsYou}</div>
                  )}
                  {item.whatHappensAfter && (
                    <div className="mt-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                      After you act: {item.whatHappensAfter}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
