# bot-montage

Outil perso pour générer des reels Instagram en batch à partir de templates de montage personnels avec des "trous" (placeholders) qu'on remplit avec ses propres vidéos au moment du rendu.

## Concept

1. Construis un **template** dans l'éditeur style Instagram Edits/CapCut : timeline de clips (vidéos fixes ou images fixes uploadées avec le template), placeholders (trous pour les vidéos qu'on insèrera plus tard), texte/GIFs/emojis en overlay, musique optionnelle.
2. Lance un **batch render** : drop N vidéos pour chaque placeholder → le bot produit N reels (chacun = template avec une vidéo dans chaque trou).
3. Optionnel : **spoofing métadonnées iPhone** (QuickTime branding + GPS USA + date random + iPhone 17 Pro etc.) pour que les vidéos passent pour des captures iPhone.

## Stack

- **Frontend** : Next.js 15 (App Router) + TypeScript + Tailwind v3 + shadcn/ui + Zustand + zod
- **Backend** : Python 3.11 + FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2
- **DB** : PostgreSQL 16
- **Queue** : Celery + Redis
- **Media** : ffmpeg + ffprobe + exiftool + AtomicParsley + mutagen + Inter/Montserrat/NotoColorEmoji
- **Auth** : JWT cookie HttpOnly + bcrypt
- **Hébergement** : Railway (Postgres + Redis managés, app combined backend+worker, frontend séparé)

## Pages

- `/` — Dashboard (stats + 8 derniers jobs + bouton "Lancer un render")
- `/templates` — grille des templates avec play overlay → preview vidéo, bouton "Lance un render" par card
- `/editor/{id}` — éditeur clip-based plein écran (timeline + canvas + inspector)
- `/jobs` — liste des render jobs avec polling 2s
- `/jobs/{id}` — détail + downloads par fichier + ZIP global

## Dev local

### 1. Variables

```bash
cp .env.example .env
# Édite .env :
#   BACKEND_PASSWORD=<mot de passe de login>
#   JWT_SECRET=<chaîne aléatoire 32+ chars>
```

### 2. Lancer la stack

```bash
docker compose up --build
```

- Frontend : http://localhost:3000
- Backend : http://localhost:8000 (docs : `/docs`)
- Postgres : `localhost:5432` (user/pw/db = `botmontage`)
- Redis : `localhost:6379`

### 3. Migrations

Au premier boot, le backend ne lance pas les migrations automatiquement (elles peuvent hang sur Railway si DATABASE_URL est mal config). Lance-les manuellement :

```bash
docker compose exec backend alembic upgrade head
```

Ou en prod via l'endpoint `/api/_admin/migrate?secret=<JWT_SECRET>`.

### 4. Vérifier les outils média

```bash
docker compose exec backend ffmpeg -version
docker compose exec backend exiftool -ver
docker compose exec backend AtomicParsley --help
```

## Déploiement Railway

Voir `CLAUDE_CONTEXT.md` section 10 pour le détail des pièges Railway. En résumé :

1. **Postgres + Redis** managés (plugins).
2. **Service `app`** : un seul container qui combine backend + worker Celery (Railway ne permet pas de partager un volume entre 2 services).
   - Root Directory : `/backend`
   - Start Command : `sh -c "celery -A app.celery_app.celery_app worker --loglevel=info --concurrency=2 & uvicorn app.main:app --host 0.0.0.0 --port $PORT"`
   - Volume monté à `/data` (5 GB).
   - Variables : `DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` (toutes via `${{ Postgres.DATABASE_URL }}` ou `${{ Redis.REDIS_URL }}`), `BACKEND_PASSWORD`, `JWT_SECRET`, `JWT_EXPIRE_HOURS=168`, `CORS_ORIGINS=<frontend URL>`, `PORT=8000`.
3. **Service `frontend`** : Root Directory `/frontend`. Variables : `BACKEND_URL=https://<backend>.up.railway.app`, `JWT_SECRET=<MÊME que backend>`, `NEXT_TELEMETRY_DISABLED=1`.
4. Une fois déployé : run la migration via la console F12 du browser :
   ```js
   fetch('/api/_admin/migrate?secret=TON_JWT_SECRET', { method: 'POST' }).then(r => r.json()).then(console.log)
   ```

## Auth

- Page `/login` : un seul champ password.
- `POST /api/auth/login` compare avec `BACKEND_PASSWORD` (hashé bcrypt en mémoire au boot).
- Cookie `auth_token` HttpOnly + JWT.
- Middleware Next.js vérifie le JWT (via `jose` + `JWT_SECRET`) sur toutes les routes sauf `/login` et `/api/*`.

## Modèle de données

Voir `CLAUDE_CONTEXT.md` section 5 pour le détail. En résumé :

- **Template** : `clips: Clip[]` + `layers: Layer[]` + `audio_overlay`
  - **Clip** ∈ `fixed` (vidéo uploadée), `image` (image fixe uploadée, durée custom), `placeholder` (trou rempli au render)
  - **Layer** ∈ `text` / `image` overlay / `gif` / `emoji` (overlays au-dessus de la vidéo)
- **Asset** : table conservée mais utilisée uniquement pour les fonts persistantes
- **RenderJob** : `assignments: [{template_id, fills: {clip_id: token}}, ...]` + `metadata_profile`

## Contexte technique complet

Voir `CLAUDE_CONTEXT.md` — document interne pour reprendre le projet sans contexte préalable.
