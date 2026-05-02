# bot-montage

Outil perso pour générer des reels Instagram en batch.

## Stack

- **Frontend** — Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + Zustand
- **Backend** — Python 3.11 + FastAPI + SQLAlchemy 2 + Alembic
- **DB** — PostgreSQL 16
- **Queue** — Celery + Redis 7
- **Media tools** (dans le container backend) — ffmpeg, exiftool, AtomicParsley
- **Déploiement** — Railway (Docker)

## Arborescence

```
.
├── backend/                  FastAPI + Celery
│   ├── app/
│   │   ├── auth/             /api/auth/login + logout, JWT, bcrypt
│   │   ├── models/           SQLAlchemy models
│   │   ├── tasks/            Celery tasks
│   │   ├── celery_app.py
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── alembic/              Migrations
│   ├── alembic.ini
│   ├── Dockerfile            Installe ffmpeg / exiftool / atomicparsley
│   └── requirements.txt
├── frontend/                 Next.js 15
│   ├── src/
│   │   ├── app/
│   │   │   ├── (app)/        Layout authentifié (sidebar + header)
│   │   │   │   ├── page.tsx              Dashboard
│   │   │   │   ├── templates/page.tsx
│   │   │   │   ├── render/new/page.tsx
│   │   │   │   └── jobs/page.tsx
│   │   │   ├── login/page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── app/          Sidebar, Header
│   │   │   └── ui/           shadcn/ui
│   │   ├── lib/utils.ts
│   │   ├── store/            Zustand
│   │   └── middleware.ts     Auth gate
│   ├── Dockerfile            Multi-stage : dev + prod (Railway)
│   ├── package.json
│   └── ...
├── docker-compose.yml        Stack dev complète
├── railway.toml              Config Railway
└── .env.example
```

## Dev local

### 1. Configurer l'env

```bash
cp .env.example .env
# Édite .env :
#   BACKEND_PASSWORD=<ton mot de passe de login>
#   JWT_SECRET=<32+ char random>
```

### 2. Lancer la stack

```bash
docker compose up --build
```

Services lancés :
- Frontend Next.js → http://localhost:3000
- Backend FastAPI → http://localhost:8000 (docs : `/docs`)
- Postgres → `localhost:5432` (user/pw/db = `botmontage`)
- Redis → `localhost:6379`
- Celery worker

À la première visite, `localhost:3000` redirige vers `/login`.

### 3. Migrations Alembic

À l'intérieur du container backend :

```bash
docker compose exec backend alembic revision --autogenerate -m "init"
docker compose exec backend alembic upgrade head
```

### 4. Vérifier les outils média (critère d'acceptation #6)

```bash
docker compose exec backend ffmpeg -version
docker compose exec backend exiftool -ver
docker compose exec backend AtomicParsley --help
```

### 5. Logs

```bash
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f frontend
```

## Déploiement Railway

Railway déploie chaque service depuis un sous-répertoire du repo via Dockerfile.

### Plan

1. **Plugins managés** — Postgres + Redis (depuis "Add Service" → Database).
2. **Service `backend`** — code-based service, Root Directory = `/backend`.
3. **Service `worker`** — code-based service, Root Directory = `/backend`. Override Start Command : `celery -A app.celery_app.celery_app worker --loglevel=info`.
4. **Service `frontend`** — code-based service, Root Directory = `/frontend`.

### Variables (Railway → Variables onglet de chaque service)

**backend & worker :**

```
DATABASE_URL           = ${{ Postgres.DATABASE_URL }}
REDIS_URL              = ${{ Redis.REDIS_URL }}
CELERY_BROKER_URL      = ${{ Redis.REDIS_URL }}
CELERY_RESULT_BACKEND  = ${{ Redis.REDIS_URL }}
BACKEND_PASSWORD       = <ton mot de passe>
JWT_SECRET             = <random 64 char, IDENTIQUE entre backend/worker/frontend>
JWT_EXPIRE_HOURS       = 168
CORS_ORIGINS           = https://<ton frontend>.up.railway.app
```

**frontend :**

```
BACKEND_URL              = ${{ backend.RAILWAY_PRIVATE_DOMAIN }}:8000   # ou l'URL publique
JWT_SECRET               = <même valeur que backend>
NEXT_TELEMETRY_DISABLED  = 1
```

> Note : Railway expose un domaine privé interne entre services (`*.railway.internal`). Préfère cette route pour `BACKEND_URL` afin de garder le trafic interne.

### Migrations sur Railway

Une fois le backend déployé, exécute les migrations :

```bash
railway run --service backend alembic upgrade head
```

## Login

- Page `/login` : un seul champ password.
- `POST /api/auth/login` compare avec `BACKEND_PASSWORD` (hashé bcrypt en mémoire au boot).
- Cookie `auth_token` HttpOnly + JWT `{ authenticated: true }`.
- Le middleware Next.js vérifie le JWT (via `jose` + `JWT_SECRET`) sur toutes les routes sauf `/login` et `/api/*`.
- `POST /api/auth/logout` supprime le cookie.

## Critères d'acceptation

1. ✅ `docker compose up` lance toute la stack
2. ✅ `localhost:3000` redirige vers `/login` si non authentifié
3. ✅ Login → layout sidebar + header + Dashboard placeholder
4. ✅ Navigation entre les 4 pages, item actif visuellement marqué
5. ✅ Logout supprime le cookie et renvoie vers `/login`
6. ✅ `ffmpeg -version`, `exiftool -ver`, `AtomicParsley --help` répondent dans le container backend
