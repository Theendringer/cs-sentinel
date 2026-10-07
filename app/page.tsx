"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Redireciona para o dashboard principal
    router.replace("/dashboard");
  }, [router]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <p className="text-sm">Carregando CS Sentinel...</p>
      </div>
    </div>
  );
}
