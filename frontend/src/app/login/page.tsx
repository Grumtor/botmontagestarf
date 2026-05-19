"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Disable static prerendering — this page uses useSearchParams which
// requires the browser env. force-dynamic makes Next.js render it on
// demand, so no prerender-time error about Suspense.
export const dynamic = "force-dynamic";

/**
 * Phase 30 — page de login (stealth simple).
 *
 * Discrétion :
 * - Aucune mention "Bot-montage", aucun logo
 * - Background full noir, juste un input centré et un bouton
 * - <title> du HTML vide (rien dans l'onglet du browser)
 * - Pas de description SEO, pas de favicon spécifique
 * - Robots noindex via meta
 */

// Sub-component that uses useSearchParams — must be inside <Suspense>
// boundary per Next 15 SSR rules.
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const inputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    document.title = "·";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive, nosnippet";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
      const res = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        if (res.status === 429) {
          setError("Trop de tentatives. Attends quelques minutes.");
        } else {
          setError("Identifiants invalides");
        }
        setSubmitting(false);
        return;
      }
      window.location.href = next.startsWith("/") ? next : "/";
    } catch (err) {
      setError("Erreur réseau");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-6">
      <a
        href="https://t.me/Grumtor"
        target="_blank"
        rel="noopener noreferrer"
        className="text-center text-xs text-zinc-500 transition hover:text-zinc-300"
      >
        Contacter{" "}
        <span className="font-mono underline">https://t.me/Grumtor</span>
        {" "}pour plus d&apos;information
      </a>

      <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          disabled={submitting}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-center text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-600 disabled:opacity-50"
          aria-label="Nom d'utilisateur"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          disabled={submitting}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-center text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-600 disabled:opacity-50"
          aria-label="Mot de passe"
        />
        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 py-3 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "…" : "Entrer"}
        </button>
      </form>

      {error && (
        <p className="text-center text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      {/* Suspense wrapper is required because LoginForm uses
          `useSearchParams()` which suspends during SSR. */}
      <Suspense fallback={<div className="text-zinc-700">…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
