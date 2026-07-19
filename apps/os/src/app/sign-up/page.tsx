import { isGoogleAuthEnabled } from "@/lib/google-auth";
import { SignUpForm } from "./sign-up-form";

// Google credentials are runtime instance configuration, not image build inputs.
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return <SignUpForm googleEnabled={isGoogleAuthEnabled()} />;
}
