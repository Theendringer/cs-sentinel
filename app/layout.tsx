import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kenit | CS Sentinel - Observability & CS Cockpit",
  description:
    "Cockpit inteligente de observabilidade e retenção preventiva de clientes com IA autônoma, MongoDB e Firestore.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-[#F8FAFC] text-slate-900 antialiased selection:bg-[#1D00EB] selection:text-white">
        <div className="min-h-screen flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
