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
    "inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--font-size-md)] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary:
      "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_4px_0_var(--primarydark)] transition-[transform,box-shadow] duration-[120ms] ease-out active:translate-y-[3px] active:shadow-[0_1px_0_var(--primarydark)]",
    secondary:
      "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_1px_0_transparent] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_2px_8px_rgb(59_49_64_/_0.08)] active:translate-y-0 active:bg-[var(--muted)]",
    destructive:
      "bg-[var(--destructive)] text-[var(--primary-foreground)] shadow-[0_4px_0_var(--primarydark)] transition-[transform,box-shadow] duration-[120ms] ease-out active:translate-y-[3px] active:shadow-[0_1px_0_var(--primarydark)]",
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