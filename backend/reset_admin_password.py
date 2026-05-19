"""Reset the admin password directly in the DB.

Usage: python reset_admin_password.py [username]

Prompts for a new password (with confirmation), hashes it with Argon2id
using the same parameters as the running app, then UPDATEs the
`users` row. Defaults to username="admin" if no arg given.

Use when :
  - You forgot the admin password.
  - The bootstrap put a hash but you can't remember which password it
    matches.
  - A teammate needs their password reset (just pass their username).

No env var, no .env editing required. Edits the DB in place.
"""
from __future__ import annotations

import getpass
import sqlite3
import sys
from pathlib import Path

from argon2 import PasswordHasher

# Same parameters as app/auth.py — keep in sync if those ever change.
HASHER = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)


def main() -> int:
    username = sys.argv[1] if len(sys.argv) > 1 else "admin"

    # Locate the DB next to the backend dir (same logic as app.config).
    here = Path(__file__).resolve().parent
    db_path = here.parent / "data" / "botmontage.db"
    if not db_path.is_file():
        print(f"× DB introuvable : {db_path}", file=sys.stderr)
        return 1

    print(f"Reset password pour user {username!r} dans {db_path.name}")
    print("=" * 60)

    while True:
        pw = getpass.getpass("Nouveau password : ")
        if not pw or len(pw) < 4:
            print("→ Trop court (min 4 chars). Recommence.\n")
            continue
        pw2 = getpass.getpass("Confirme        : ")
        if pw != pw2:
            print("→ Les deux saisies diffèrent. Recommence.\n")
            continue
        break

    print("\nGénération du hash Argon2id…")
    new_hash = HASHER.hash(pw)

    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        )
        row = cur.fetchone()
        if row is None:
            print(f"× User {username!r} introuvable.", file=sys.stderr)
            return 2
        conn.execute(
            "UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?",
            (new_hash, row[0]),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"\n✓ Password de {username!r} (id={row[0]}) mis à jour.")
    print("  Reconnecte-toi sur /login (pas besoin de restart le backend).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
