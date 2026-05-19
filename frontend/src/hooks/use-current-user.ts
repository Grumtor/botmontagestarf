"use client";

import { useEffect, useState } from "react";

import { Auth, type UserMe } from "@/lib/api";

/** Listeners enregistrés par les hooks actifs. Quand un composant
 *  appelle `notifyUserRefresh()`, tous les hooks re-fetch /api/auth/me
 *  → la sidebar (et autres consommateurs) voient les nouvelles valeurs
 *  de crédits / limite templates sans rechargement de page. */
const listeners = new Set<() => void>();

/** Trigger a re-fetch sur tous les hooks `useCurrentUser` actifs.
 *  À appeler après une action qui modifie le user en DB :
 *    - batch render lancé (crédits décrémentés)
 *    - admin top-up des crédits sur son propre compte
 *    - changement de password etc. */
export function notifyUserRefresh(): void {
  for (const l of listeners) l();
}

/** React hook : returns the currently-authenticated user (or null
 *  while loading / unauthed). Re-fetches when `notifyUserRefresh()`
 *  est appelé n'importe où dans l'app. */
export function useCurrentUser(): UserMe | null {
  const [user, setUser] = useState<UserMe | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      Auth.whoami().then((u) => {
        if (!cancelled) setUser(u);
      });
    }
    load();
    listeners.add(load);
    return () => {
      cancelled = true;
      listeners.delete(load);
    };
  }, []);

  return user;
}
