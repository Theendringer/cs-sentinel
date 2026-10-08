import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kenit CS Sentinel | Observability & Cockpit",
  description:
    "Plataforma operacional e cockpit de observabilidade preventiva para Customer Success - Kenit.",
  icons: {
    icon: "/logo-kenit.png",
    shortcut: "/logo-kenit.png",
    apple: "/logo-kenit.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-[#F8FAFC] text-slate-900 antialiased selection:bg-[#1D00EB] selection:text-white">
        <div className="min-h-screen flex flex-col">{children}</div>
      </body>
    </html>
  );
}
