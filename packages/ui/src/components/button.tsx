import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "destructive";
};

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-md)] font-medium transition-[background-color,box-shadow] duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary:
      "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 active:brightness-95",
    secondary:
      "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--muted)] active:bg-[var(--border)]",
    destructive:
      "bg-[var(--destructive)] text-[var(--primary-foreground)] hover:brightness-110 active:brightness-95",
  };

  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}