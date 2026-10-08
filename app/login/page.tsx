"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signInWithEmailAndPassword } from "firebase/auth";
import { clientAuth } from "@/lib/firebase-client";
import { AlertCircle, ArrowRight, Lock, CheckCircle2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage("");

    try {
      await signInWithEmailAndPassword(clientAuth, email, password);
      router.push("/dashboard");
    } catch (err: any) {
      console.warn("Falha de autenticação Firebase:", err.code, err.message);
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found") {
        setErrorMessage("Credenciais inválidas. Verifique seu e-mail e senha cadastrados.");
      } else if (err.code === "auth/configuration-not-found" || err.code === "auth/invalid-api-key") {
        setErrorMessage("Firebase Auth não configurado na web. Utilize o botão 'Acesso Rápido' abaixo.");
      } else {
        setErrorMessage(err.message || "Erro ao conectar com Firebase Auth.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] p-4 text-slate-900">
      <div className="w-full max-w-md">
        {/* Card Principal Kenit */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 shadow-card-md">
          {/* Topo com Logo Kenit */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex items-center justify-center">
              <Image
                src="/logo-kenit-full.png"
                alt="Kenit"
                width={160}
                height={48}
                className="h-10 w-auto object-contain"
                priority
              />
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF0FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D00EB]">
              CS Cockpit & Observabilidade
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Retenção Preventiva com IA Autônoma (Google Gemini)
            </p>
          </div>

          {errorMessage && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-semibold">Erro de Acesso</p>
                <p className="mt-0.5 opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Formulário */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                E-mail do CSM
              </label>
              <input
                type="email"
                required
                placeholder="cs.manager@kenit.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1D00EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1D00EB]/20 transition"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Senha de Acesso
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1D00EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1D00EB]/20 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1D00EB] hover:bg-[#1500B8] py-3 text-sm font-semibold text-white shadow-card-sm transition disabled:opacity-50"
            >
              {loading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  <span>Entrar no Cockpit</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Indicadores de Conexão */}
          <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Firebase Auth
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#1D00EB]" />
              MongoDB Atlas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              Gemini Agent
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
