"use client";

import { useEffect, useState } from "react";

import { Auth, type UserMe } from "@/lib/api";

/** React hook : returns the currently-authenticated user (or null
 *  while loading / unauthed). Calls /api/auth/me once on mount.
 *
 *  Pas de cache global pour l'instant — chaque composant qui en a
 *  besoin refait l'appel. C'est cheap, la route est ultra-rapide.
 *  Si ça devient un point chaud, on mettra un Context en haut. */
export function useCurrentUser(): UserMe | null {
  const [user, setUser] = useState<UserMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    Auth.whoami().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}
