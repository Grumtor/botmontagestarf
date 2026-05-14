"""Generate the Argon2id hash of a password + a session secret, ready
to drop into your `.env` file.

Usage (from `backend/`, with venv activated):
    python set_password.py

The script will prompt for the password (input is hidden, like sudo),
hash it with Argon2id (OWASP 2024 params), and print the lines to copy
into `backend/.env`. NEVER store the plain password anywhere.

If you've forgotten your password, just re-run this script with a new
one : the new hash replaces the old in .env.
"""
from __future__ import annotations

import getpass
import secrets
import sys

# Ensure we can import the app package even when run directly.
sys.path.insert(0, ".")

from app.auth import hash_password  # noqa: E402


def main() -> None:
    print("=" * 60)
    print("bot-montage — set master password")
    print("=" * 60)
    print()
    print("Choisis un mot de passe FORT (>= 16 chars, mix maj/min/")
    print("chiffres/symboles). Tu vas le retaper deux fois.")
    print()
    print("Le hash sera ajouté à backend/.env — le mot de passe en")
    print("clair n'est stocké NULLE PART.")
    print()

    while True:
        p1 = getpass.getpass("Mot de passe : ")
        if len(p1) < 8:
            print("→ Trop court (min 8 chars). Recommence.\n")
            continue
        p2 = getpass.getpass("Confirme       : ")
        if p1 != p2:
            print("→ Les deux saisies diffèrent. Recommence.\n")
            continue
        break

    print()
    print("Génération du hash Argon2id (peut prendre 1-2 secondes)…")
    h = hash_password(p1)
    print()
    print("Génération du secret de session (HMAC)…")
    sess = secrets.token_hex(32)
    print()
    print("=" * 60)
    print("  Ajoute ces lignes à backend/.env :")
    print("=" * 60)
    print()
    print(f"BOTMONTAGE_PASSWORD_HASH={h}")
    print(f"BOTMONTAGE_SESSION_SECRET={sess}")
    print()
    print("=" * 60)
    print()
    print("Sur le VPS, fais pareil mais MET LE MEME SECRET (pas")
    print("forcement le même password — tu peux choisir un mdp")
    print("différent par environnement).")
    print()
    print("Si tu veux que les sessions persistent entre PC local et")
    print("VPS, garde le MEME `BOTMONTAGE_SESSION_SECRET` partout.")
    print()


if __name__ == "__main__":
    main()
