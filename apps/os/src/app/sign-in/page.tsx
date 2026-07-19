import { Suspense } from "react";
import { isGoogleAuthEnabled } from "@/lib/google-auth";
import { SignInForm } from "./sign-in-form";

// Google credentials are runtime instance configuration, not image build inputs.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm googleEnabled={isGoogleAuthEnabled()} />
    </Suspense>
  );
}
