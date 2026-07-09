import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const gantari = localFont({
  src: [
    { path: "./fonts/Gantari-latin.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/Gantari-latin-ext.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-gantari",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-latin.woff2", weight: "400 700", style: "normal" },
    { path: "./fonts/JetBrainsMono-latin-ext.woff2", weight: "400 700", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const themeInitScript = `
(function () {
  var allowed = { auto: true, light: true, green: true, charcoal: true };
  function resolveTheme(choice) {
    var theme = allowed[choice] ? choice : "auto";
    var bg = "";
    if (theme === "auto") {
      var h = new Date().getHours();
      if (h >= 21 || h < 5) theme = "charcoal";
      else {
        theme = "light";
        if (h < 8) bg = "var(--bg-dawn)";
        else if (h >= 17) bg = "var(--bg-dusk)";
      }
    }
    return { theme: theme, bg: bg };
  }
  function storedTheme() {
    try {
      return localStorage.getItem("theme") || "auto";
    } catch (_) {
      return "auto";
    }
  }
  var resolved = resolveTheme(storedTheme());
  document.documentElement.classList.toggle("dark", resolved.theme === "green" || resolved.theme === "charcoal");
  function stampBody() {
    if (!document.body) return false;
    document.body.dataset.theme = resolved.theme;
    if (resolved.bg) document.body.style.setProperty("--bg", resolved.bg);
    else document.body.style.removeProperty("--bg");
    return true;
  }
  if (!stampBody()) {
    var observer = new MutationObserver(function () {
      if (stampBody()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();`;

export const metadata: Metadata = {
  title: process.env.INSTANCE_NAME || "CompanyOS",
  description: "AI-native system of record for running businesses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body data-theme="light" className={`${gantari.variable} ${jetbrainsMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
