"use client";

import { ConfirmProvider, ToastProvider } from "@companyos/ui";

export function FeedbackProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
