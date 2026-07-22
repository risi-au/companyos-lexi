import { getCurrentActorPrincipalId } from "@/lib/api";
import { api } from "@/lib/api";
import { DigestView } from "@/modules/digest";

export default async function DigestPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;

  const digest = await api.getDigest({ scopePath: "root" }, actor);

  return (
    <div className="space-y-[var(--space-4)]">
      <DigestView digest={digest} />
    </div>
  );
}

