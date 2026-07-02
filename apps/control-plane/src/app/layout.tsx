import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CompanyOS Control Plane",
  description: "Platform super-admin",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}