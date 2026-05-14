"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Phase 30 — page de login (stealth simple).
 *
 * Discrétion :
 * - Aucune mention "Bot-montage", aucun logo
 * - Background full noir, juste un input centré et un bouton
 * - <title> du HTML vide (rien dans l'onglet du browser)
 * - Pas de description SEO, pas de favicon spécifique
 * - Robots noindex via meta
 *
 * Sécurité côté client : pas de signal d'erreur sur "mauvais mot de
 * passe" vs "trop de tentatives" en clair — on s'aligne sur le
 * backend qui renvoie un message générique. La vraie vérif est
 * server-side (Argon2id + rate limit).
 */
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-focus l'input au chargement.
    inputRef.current?.focus();
  }, []);

  // Set neutral title and meta tags client-side (since we can't use
  // `metadata` export in a "use client" file).
  useEffect(() => {
    document.title = "·";
    // Disable browser autofill heuristics on this page.
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
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      // Direct backend call (bypass Next proxy buffer for cookies +
      // for consistency with the multipart uploads). Backend sets
      // the cookie with Domain=.grumtor.com so it works on both
      // bot.* and api.* subdomains.
      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
      const res = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
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
      // Cookie set by backend, full page reload to apply middleware
      // checks across the app.
      window.location.href = next.startsWith("/") ? next : "/";
    } catch (err) {
      setError("Erreur réseau");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-6">
        {/* Bouton Telegram contact en haut */}
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

        {/* Form */}
        <form onSubmit={onSubmit} className="w-full">
          <input
            ref={inputRef}
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
            disabled={submitting || !password}
            className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-900 py-3 text-sm text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "…" : "Entrer"}
          </button>
        </form>

        {error && (
          <p className="text-center text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
