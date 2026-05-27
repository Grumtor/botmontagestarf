import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Phase 38 — formatte un nombre de crédits sans décimale superflue.
 * Les crédits peuvent désormais être fractionnaires (0.5 / video pour
 * le spoofing) donc on a besoin d'afficher "12" pour 12.0 et "12.5"
 * pour 12.5, sans afficher "12.0".
 */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Si entier (ou très proche d'un entier après calculs flottants) → pas de décimale.
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  // Sinon 1 décimale (les seules valeurs fractionnaires possibles sont des .5).
  return n.toFixed(1);
}
