# CLAUDE_CONTEXT.md

> Document interne pour Claude. À lire en cas de perte de contexte. À mettre à jour à chaque prompt/changement majeur.
>
> **Last updated**: après Phase 3 (dialog "Lance un render" sur les templates)
> **Next planned**: à définir avec l'utilisateur — possibles : multi-template batch, cleanup `/data/temp` orphelins, polish UI, retours d'usage réel

---

## 1. Le projet en 30 secondes

**bot-montage** = outil web perso d'Enzo pour générer des reels Instagram en série à partir de templates de montage personnels avec des "trous" (placeholders) qu'on remplit avec des vidéos qu'on importe.

**Workflow type** :
1. Enzo construit un **template** dans l'éditeur (style Instagram Edits) : intro fixe + placeholder + outro fixe + textes/images en overlay + musique
2. Plus tard, il lance un batch render : il drop N vidéos pour chaque placeholder, le bot produit N reels (chacun = template avec une vidéo dans le trou)
3. Optionnel : spoofing métadonnées iPhone (QuickTime branding + GPS USA + date random + iPhone 17 Pro etc.) pour que les vidéos passent pour des captures iPhone

**Hébergé sur Railway** (production), code local sur Windows. Pas de Docker installé sur le poste perso.

---

## 2. Mental model — la pivot

L'app a vécu un **pivot majeur entre la Phase 1 originelle et la Phase 1 du modèle clip-based** (les "phases" actuelles renumérotées). À retenir :

### Avant le pivot (modèle initial, abandonné)
- Template = canvas 9:16 de durée fixe
- Une "source" était un montage déjà existant qu'on choisissait au render
- Les templates appliquaient leurs calques par-dessus la source
- Pages `/sources` et `/assets` pour gérer une bibliothèque persistante

### Après le pivot (modèle actuel)
- Template = **timeline de clips** sur 1 piste vidéo (style CapCut/Edits)
- Chaque clip est soit :
  - **`fixed`** : vidéo uploadée AVEC le template, stockée à vie sous `/data/templates/{id}/clips/`
  - **`placeholder`** : trou marqué `📷 Placeholder · 3.0s` qui sera rempli au render par une vidéo utilisateur
- Au render : N vidéos par placeholder = N reels
- **Plus de pages `/sources` ni `/assets`** (sauf fonts persistantes pour Inter+Montserrat+uploads)
- **Plus de calques Effet/Animation** (virés au pivot)
- Calques restants : `text`, `image`, `gif`, `emoji` (overlays)

---

## 3. Stack technique

| Couche | Tech |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind v3 + shadcn/ui + Zustand + zod |
| Backend | Python 3.11 + FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 |
| DB | PostgreSQL 16 (managed Railway) |
| Queue | Celery + Redis (managed Railway) |
| Media | ffmpeg + ffprobe + exiftool + AtomicParsley + mutagen + Inter/Montserrat/NotoColorEmoji fonts |
| Auth | JWT cookie HttpOnly + bcrypt en mémoire au boot |
| Hébergement | Railway (Postgres + Redis managés, app combined backend+worker, frontend séparé) |

---

## 4. Layout du projet

```
.
├── README.md                          ← user-facing, install/deploy
├── CLAUDE_CONTEXT.md                  ← CE FICHIER (handover)
├── docker-compose.yml                 ← dev local (postgres+redis+backend+worker+frontend)
├── railway.toml                       ← config Railway minimale
├── .env.example                       ← BACKEND_PASSWORD, JWT_SECRET
├── backend-data/                      ← /data en local (gitignored)
│
├── backend/
│   ├── Dockerfile                     ← ffmpeg, exiftool, atomicparsley, fonts-inter, fonts-montserrat, fonts-noto-color-emoji
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/versions/
│   │   ├── 0001_initial.py            ← tables initiales (legacy schema)
│   │   ├── 0002_text_pool.py          ← TextPool (drop en 0005)
│   │   ├── 0003_source_segments.py    ← legacy (drop en 0005)
│   │   ├── 0004_audio_config.py       ← audio_source/audio_overlay (audio_source drop en 0005)
│   │   └── 0005_clip_based_templates.py  ← LE PIVOT
│   └── app/
│       ├── main.py                    ← FastAPI app, lifespan, /api/health, /api/_admin/migrate
│       ├── config.py                  ← Pydantic Settings (DATABASE_URL, JWT_SECRET, etc.)
│       ├── celery_app.py              ← Celery instance
│       ├── middleware.py              ← AuthMiddleware (gate /api/* sauf /auth/, /health, /_admin/)
│       ├── storage.py                 ← chemins /data/*, ensure_dirs, install_builtin_fonts, ensure_placeholder_preview
│       ├── media.py                   ← ffprobe + make_video_thumb helpers
│       ├── db/
│       │   ├── __init__.py            ← engine, SessionLocal, Base, get_db
│       │   └── models.py              ← User, Template, Asset, RenderJob (post-pivot)
│       ├── auth/
│       │   ├── routes.py              ← POST /api/auth/login, /logout, GET /me
│       │   ├── security.py            ← bcrypt + PyJWT
│       │   └── dependencies.py        ← require_auth Depends
│       ├── api/
│       │   ├── templates.py           ← CRUD templates + upload clips/overlays
│       │   ├── assets.py              ← upload/list/delete FONTS uniquement
│       │   ├── fonts.py               ← list + serve (built-in + uploaded)
│       │   ├── files.py               ← serve_asset, template_clip, template_clip_thumb, template_overlay, template_thumb, template_preview, render, render_item
│       │   ├── render.py              ← POST /api/render/upload (token), POST /preview
│       │   └── jobs.py                ← POST /api/render/batch, GET /jobs, /jobs/{id}, /dashboard/stats
│       ├── render/
│       │   ├── pipeline.py            ← build_render_command (clip-based, drawtext, overlays, audio mix)
│       │   ├── batch_runner.py        ← gather_render_inputs (résolution file_id/token → Path), run_render
│       │   ├── metadata.py            ← apply_quicktime_metadata (ftyp patch + mutagen + exiftool)
│       │   └── countries.json         ← 12 pays avec villes/GPS/timezone
│       └── tasks/
│           ├── __init__.py            ← register celery tasks
│           └── render.py              ← process_render_job (Celery)
│
└── frontend/
    ├── Dockerfile                     ← multi-stage Next 15 standalone, ARG BACKEND_URL
    ├── package.json                   ← next 15.1.11+, react 19, zod, jose, zustand, date-fns, lucide
    ├── next.config.ts                 ← rewrites /api/* → BACKEND_URL (build-time !)
    ├── tailwind.config.ts             ← thème dark par défaut, vars HSL CSS
    └── src/
        ├── middleware.ts              ← auth gate Next : redirect /login si pas de cookie JWT valide
        ├── app/
        │   ├── layout.tsx             ← root, html dark, Toaster, TooltipProvider
        │   ├── globals.css            ← vars HSL, body bg
        │   ├── login/page.tsx         ← formulaire password
        │   ├── (app)/                 ← group protégé avec sidebar+header
        │   │   ├── layout.tsx         ← Sidebar + Header + main
        │   │   ├── page.tsx           ← Dashboard (stats + 8 derniers jobs)
        │   │   ├── templates/page.tsx ← grille templates avec preview videos
        │   │   ├── jobs/page.tsx      ← liste jobs avec polling 2s
        │   │   └── jobs/[id]/page.tsx ← détail job avec previews et downloads
        │   └── editor/[id]/           ← HORS du group (app), full-screen
        │       ├── page.tsx           ← server entry, params → numId
        │       └── editor-view.tsx    ← topbar+sidebar+canvas+inspector+timeline avec resize
        ├── components/
        │   ├── app/
        │   │   ├── sidebar.tsx        ← Dashboard / Templates / Jobs (3 entrées seulement)
        │   │   └── header.tsx         ← logout button
        │   ├── ui/                    ← shadcn (button, input, card, dialog, sheet, tabs, tooltip, badge, progress, toast, select)
        │   ├── library/
        │   │   ├── dropzone.tsx       ← drag-drop multi-files (utilisé par le timeline track aussi)
        │   │   └── upload-list.tsx    ← progress bars
        │   ├── templates/
        │   │   ├── template-card.tsx  ← card avec play overlay → video preview
        │   │   ├── new-template-dialog.tsx
        │   │   └── language-filter.tsx
        │   └── editor/
        │       ├── editor-topbar.tsx          ← retour, nom, langue, save, "Aperçu rendu"
        │       ├── editor-sidebar.tsx         ← liste calques + delete (PAS de "+ ajouter" — l'action bar fait ça)
        │       ├── editor-canvas.tsx          ← preview multi-clip (1 video element switching src), layers overlay, drag+resize handles
        │       ├── editor-inspector.tsx       ← route selon ce qui est sélectionné
        │       ├── editor-timeline.tsx        ← action bar + ruler + clip track + audio track + layer tracks, ctrl+wheel zoom
        │       ├── timeline-action-bar.tsx    ← + Vidéo, + Placeholder, + Texte, + Image, + GIF, + Emoji, + Audio
        │       ├── clip-track.tsx             ← clips avec thumbnails background, drag-drop file dropzone, trim handles
        │       ├── clip-inspector.tsx         ← inspector pour clip fixe ou placeholder
        │       ├── text-inspector.tsx         ← style text + emoji picker button
        │       ├── text-layer.tsx             ← rendu canvas du texte (plain/highlight/stroke)
        │       ├── asset-layer.tsx            ← rendu canvas image/gif/emoji
        │       ├── asset-layer-inspector.tsx  ← upload overlay file, rotation, opacity, ratio_locked
        │       ├── audio-tracks.tsx           ← OverlayAudioLane (drag+trim)
        │       ├── audio-inspectors.tsx       ← AudioOverlayInspector
        │       ├── playback-controls.tsx      ← play/pause/stop + scrubber
        │       ├── font-loader.tsx            ← @font-face injection pour toutes les fonts du store
        │       ├── render-preview-dialog.tsx  ← modal avec video player du preview MP4
        │       ├── emoji-picker.tsx           ← popover emoji curated 80
        │       └── use-audio-duration.ts      ← hook pour récupérer durée d'un audio par URL
        ├── lib/
        │   ├── api.ts                 ← TOUS les schemas zod + fetch helpers + Templates/Render/Jobs/Dashboard/Fonts clients
        │   ├── editor-types.ts        ← LAYER_TYPES, LAYER_COLORS, fontFamily, clipDuration, totalDuration, timelineToClip
        │   ├── upload.ts              ← XHR-based file upload with progress
        │   └── utils.ts               ← cn() classnames helper
        ├── store/
        │   ├── editor.ts              ← LE store éditeur (Zustand): template, clips, layers, audioOverlay, currentTime, isPlaying, fonts + autosave debounced 500ms
        │   └── index.ts               ← legacy UI store (ignored)
        └── hooks/use-toast.ts
```

---

## 5. Data model actuel (post-pivot, migration 0005)

### Table `templates`
- `id`, `name`, `description`, `language` (`FR`/`US`), `thumbnail_path`, `created_at`, `updated_at`
- `clips: JSONB[]` — chaque entrée est un clip fixed ou placeholder (voir schéma ci-dessous)
- `layers: JSONB[]` — overlays (text/image/gif/emoji)
- `audio_overlay: JSONB` — `{file_id, volume, start_offset, trim_in}` ou file_id=null

**Format d'un Clip dans `templates.clips`** :

```ts
// FixedClip
{
  id: string,                  // UUID client
  type: "fixed",
  file_id: string,             // hash UUID du fichier sous /data/templates/{tid}/clips/{file_id}.{ext}
  source_duration_sec: number | null,
  source_width: number | null,
  source_height: number | null,
  trim_in: number,             // sec dans le fichier source
  trim_out: number | null,     // sec dans le fichier source (null = jusqu'à la fin)
  audio_enabled: boolean,
  audio_volume: number         // 0..2 (clamp à 1 en preview HTML5, full au render)
}

// PlaceholderClip
{
  id: string,
  type: "placeholder",
  duration_sec: number,        // durée FIXE imposée au render (trim si plus long, freeze last frame si plus court)
  trim_in: 0,                  // pas utilisés mais présents pour compat
  trim_out: null,
  audio_enabled: boolean,
  audio_volume: number
}
```

**Format d'un Layer (overlay) dans `templates.layers`** :
```ts
{
  id: string,
  type: "text" | "image" | "gif" | "emoji",
  start_time: number,          // sec dans le timeline output
  end_time: number,
  x_pct, y_pct, width_pct, height_pct: number,  // 0..100
  z_index: number,
  data: Record<string, unknown>  // type-specific, voir TextLayerData/AssetLayerData dans api.ts
}
```

### Table `assets`
- Conservée mais **uniquement utilisée pour les fonts** (Inter, Montserrat préinstallées + uploads TTF/OTF).
- Les autres types (`image`, `gif`, `emoji`, `audio`) sont legacy (lignes orphelines tolérées).
- Endpoints `/api/assets/upload` accepte uniquement `.ttf`/`.otf` désormais.

### Table `render_jobs`
- `id`, `name`, `status` (queued/running/done/failed), `progress`, `error`, `created_at`, `finished_at`
- `assignments: JSONB[]` — `[{template_id, fills: {clip_id: token}}, ...]`
- `metadata_profile: JSONB` — `{enabled, model, country, language, date_window_days}`
- `output_zip_path: str | null`, `output_files: JSONB[]`

### Tables supprimées par la migration 0005
- `video_sources` (drop)
- `text_pools` (drop)

---

## 6. Layout du stockage `/data/`

```
/data/
├── _placeholder_preview.mp4      ← 30s noir 1080x1920, généré au boot, fallback pour previews
├── assets/
│   └── fonts/                    ← persistant (Inter, Montserrat builtin + uploads)
├── templates/
│   └── {template_id}/
│       ├── clips/
│       │   ├── {file_id}.mp4     ← vidéos fixes uploadées avec le template
│       │   └── {file_id}_thumb.jpg  ← thumbnail 90x160 généré à l'upload
│       ├── overlays/
│       │   └── {file_id}.{ext}   ← images, gifs, emojis, audio overlay
│       ├── thumb.jpg             ← (généré ?) thumbnail global du template
│       └── preview.mp4           ← cache du dernier "Aperçu rendu" déclenché par l'éditeur
├── temp/
│   └── {token}.{ext}             ← user-uploaded videos pending render (cleaned after job)
└── renders/
    ├── {job_id}/
    │   └── *.mp4                 ← outputs du batch
    └── {job_id}.zip              ← ZIP final
```

---

## 7. API surface (current)

### Auth & meta
| Route | Description |
|---|---|
| `POST /api/auth/login` body `{password}` | Set cookie JWT si match `BACKEND_PASSWORD` |
| `POST /api/auth/logout` | Clear cookie |
| `GET /api/auth/me` | Vérif auth |
| `GET /api/health` | `{status: "ok"}` (public) |
| `POST /api/_admin/migrate?secret=<JWT_SECRET>` | Run alembic upgrade head (public, mais signé par JWT_SECRET) |

### Templates
| Route | Description |
|---|---|
| `POST /api/templates` body `{name, language, description?}` | Create empty |
| `GET /api/templates?language=FR\|US` | List |
| `GET /api/templates/{id}` | Detail |
| `PUT /api/templates/{id}` | Update (name, language, description, clips, layers, audio_overlay) — c'est ce que l'autosave appelle |
| `DELETE /api/templates/{id}` | Delete + wipe `/data/templates/{id}/` |
| `POST /api/templates/{id}/duplicate` | Clone + copy files |
| `POST /api/templates/{id}/clips/upload` multipart `file` | Upload .mp4/.mov, retourne `{file_id, duration_sec, width, height}` + génère thumb |
| `POST /api/templates/{id}/overlays/upload` multipart `file` | Upload image/gif/audio, retourne `{file_id}` |

### Assets (fonts only)
| Route | Description |
|---|---|
| `POST /api/assets/upload` multipart `.ttf`/`.otf` | Upload font |
| `GET /api/assets` | List uploaded fonts |
| `DELETE /api/assets/{id}` | Delete |

### Fonts
| Route | Description |
|---|---|
| `GET /api/fonts` | `[{id, name, builtin}]` (id string pour builtin, int pour upload) |
| `GET /api/fonts/{font_id}` | Serve TTF/OTF file |

### Files (serve)
| Route | Returns |
|---|---|
| `GET /api/files/asset/{asset_id}` | Font file |
| `GET /api/files/template_clip/{tid}/{file_id}` | Fixed clip MP4 |
| `GET /api/files/template_clip_thumb/{tid}/{file_id}` | Clip thumbnail JPEG |
| `GET /api/files/template_overlay/{tid}/{file_id}` | Image/audio overlay file |
| `GET /api/files/template_thumb/{tid}` | Template global thumbnail (souvent 404) |
| `GET /api/files/template_preview/{tid}` | Cached preview.mp4 (404 si pas encore généré) |
| `GET /api/files/render/{job_id}` | ZIP du job |
| `GET /api/files/render_item/{job_id}/{index}` | MP4 individuel du job |

### Render
| Route | Description |
|---|---|
| `POST /api/render/upload` multipart `file` | Stash user video dans `/data/temp/`, retourne `{token}` |
| `POST /api/render/preview` body `{template_id, fills}` | Render preview (CRF 28 ultrafast) + cache dans `/data/templates/{id}/preview.mp4`. Auto-fill placeholders manquants avec `_placeholder_preview.mp4` |
| `POST /api/render/batch` body `{name, assignments, metadata_profile}` | Crée RenderJob + spawn Celery task |
| `GET /api/jobs` | List paginé (50 max) |
| `GET /api/jobs/{id}` | Détail |
| `GET /api/dashboard/stats` | `{template_count, render_count}` |

---

## 8. Pipeline ffmpeg (cœur du système)

**Module** : `backend/app/render/pipeline.py` (`build_render_command`)
**Driver** : `backend/app/render/batch_runner.py` (`gather_render_inputs`, `run_render`)

**Flow d'un render** :

1. **Inputs ffmpeg** (un `-i` par clip + un par overlay file + un pour audio_overlay)
2. **Pour chaque clip**, sub-chain video :
   - `[N:v]trim=start=A:end=B,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`
   - Si `target_duration` (placeholder) : `,tpad=stop_mode=clone:stop_duration=X,trim=duration=X,setpts=PTS-STARTPTS`
   - `,fps=30[cv{i}]`
3. **Pour chaque clip**, sub-chain audio :
   - Si `audio_enabled` : `[N:a]atrim,asetpts,volume=V` + éventuellement `apad` + `atrim` pour matcher `target_duration`
   - Sinon : `anullsrc=duration=X[ca{i}]`
4. **Concat** : `[cv0][ca0][cv1][ca1]...concat=n=N:v=1:a=1[main_v][main_a]`
5. **Overlays visuels** (par z_index) :
   - Text → `drawtext=fontfile=...:text=...:fontsize=...:fontcolor=...:enable='between(t,X,Y)'`
     - `style=highlight` → `box=1:boxcolor:boxborderw`
     - `style=stroke` → `bordercolor:borderw`
   - Image/gif/emoji → `[N:v]scale,format=rgba,colorchannelmixer=aa=opacity` (+ rotate si rotation_deg) `[sc{i}]; [current][sc{i}]overlay=x=X:y=Y:enable='between(t,A,B)'`
6. **Audio overlay (musique)** : `[N:a]atrim=start=trim_in,asetpts,volume,adelay=ms[ovl_a]; [main_a][ovl_a]amix=inputs=2:duration=first[mix_a]`
7. **Final output** : `-map [out_v] -map [audio_label] -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest`

**Échappements importants** :
- `enable='between(t\,X\,Y)'` — virgules échappées car séparateur de filter chain
- `_esc_drawtext(text)` échappe `\`, `:`, `,`, `'`, `%`
- `_esc_path(path)` pour fontfile

---

## 9. Frontend architecture

### Auth flow
1. `/login` form → `POST /api/auth/login` (passe par Next.js rewrite proxy)
2. Backend signe JWT avec `JWT_SECRET`, set cookie HttpOnly `auth_token`
3. Toutes les pages sauf `/login` passent par `middleware.ts` qui vérifie le JWT via `jose` avec le **même** `JWT_SECRET` (variable env identique sur les 2 services Railway)
4. Si invalide → redirect `/login`

### Routes Next.js
| Path | Description |
|---|---|
| `/login` | Form password (public) |
| `/` | Dashboard (stats + jobs récents) |
| `/templates` | Grille avec play overlay → preview video |
| `/jobs` | List avec polling 2s |
| `/jobs/[id]` | Détail + downloads |
| `/editor/[id]` | Éditeur full-screen (hors group `(app)`) |

### Store Zustand `useEditorStore`
**État** :
- `template`, `clips`, `layers`, `audioOverlay`
- `selectedClipId`, `selectedLayerId`, `audioSelected` (mutuellement exclusifs)
- `currentTime`, `isPlaying`
- `fonts: FontMeta[]`
- `saving`, `saveError`

**Actions** :
- `loadTemplate(t)`, `loadFonts(fonts)`
- `patchTemplate({name?, language?, description?})`, `setLanguage(lang)`
- Clips : `addFixedClip`, `addPlaceholderClip`, `patchClip`, `deleteClip`, `reorderClips`
- Layers : `addLayer`, `patchLayer`, `patchLayerData`, `deleteLayer`, `reorderLayers`
- Audio : `patchAudioOverlay`
- Selection : `setSelectedClipId`, `setSelectedLayerId`, `setAudioSelected`
- `setCurrentTime`, `setIsPlaying`
- `saveNow()` (force flush)

**Autosave** :
- `schedule()` debounced 500ms
- `persist()` : `Templates.update(id, {name, language, description, clips, layers, audio_overlay})`

### Composants éditeur (à connaître)
- **`editor-view.tsx`** : bootstrap (load template+fonts), RAF playback loop, **resize handle** vertical entre canvas et timeline (hauteur persisted en `localStorage` clé `bm-timeline-height`)
- **`editor-canvas.tsx`** : 9:16 (360×640 px), **container-type:size** pour units `cqh`/`cqw` (font-size en cqh). Un `<video>` qui change `src` au clip actif. Layers overlay par-dessus, drag (mousedown/move/up natif) + 8 resize handles (avec ratio-lock pour visual assets si `data.ratio_locked`).
- **`clip-track.tsx`** : clips 70px avec **thumbnail JPEG** en background-image (`backgroundSize: 'auto 100%'; backgroundRepeat: 'repeat-x'`). Drag-drop file desktop → upload + ajout. Trim handles aux 2 bords (8px). Drag pour reorder.
- **`timeline-action-bar.tsx`** : 7 boutons "+" (Vidéo, Placeholder, Texte, Image, GIF, Emoji, Audio). Gère 3 file inputs cachés + state pour pendingType lors d'un upload de calque visuel.
- **`emoji-picker.tsx`** : popover 3 catégories × 30 emojis curated. Insertion à la position du curseur dans la textarea.

---

## 10. Déploiement Railway (gotchas appris à la dure)

### Setup
- 1 Postgres managé + 1 Redis managé (plugins Railway)
- 1 service `app` = backend + worker Celery **combinés dans un seul container** (Railway ne permet pas de partager un volume entre 2 services)
  - Start command override : `sh -c "celery -A app.celery_app.celery_app worker --loglevel=info --concurrency=2 & uvicorn app.main:app --host 0.0.0.0 --port $PORT"`
  - Volume monté à `/data`, 5 GB
  - Variables : `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, `CELERY_BROKER_URL=${{Redis.REDIS_URL}}`, `CELERY_RESULT_BACKEND=${{Redis.REDIS_URL}}`, `BACKEND_PASSWORD`, `JWT_SECRET`, `JWT_EXPIRE_HOURS=168`, `CORS_ORIGINS=<frontend URL>`, `PORT=8000`
- 1 service `frontend` (root `/frontend`)
  - Variables : `BACKEND_URL=https://<backend-public>.up.railway.app`, `JWT_SECRET=<MÊME que backend>`, `NEXT_TELEMETRY_DISABLED=1`

### Pièges majeurs vécus (ne pas re-tomber dedans)
1. **Next.js standalone bake les `next.config.ts` rewrites au BUILD time** → `BACKEND_URL` doit être disponible pendant `npm run build` côté Docker. Solution : `ARG BACKEND_URL` + `ENV BACKEND_URL=$BACKEND_URL` dans le Dockerfile builder stage. Railway passe automatiquement les env vars matching les ARG.
2. **Lifespan migrations qui hangent** → quand DATABASE_URL est mal configuré, alembic essaie de joindre localhost:5432 et hang sur le TCP timeout. SOLUTION : on a sorti les migrations du lifespan, elles tournent uniquement via `POST /api/_admin/migrate?secret=<JWT_SECRET>`.
3. **Volume Railway mono-service** → on combine backend + worker dans un seul container avec `&` dans le start command.
4. **Port mismatch** → Railway force `$PORT=8080` parfois ; le domaine doit pointer vers le port que l'app écoute. On a mis `PORT=8000` en variable + domaine pointant 8000.
5. **CVE Next.js 15.1.3** → bumpé en 15.1.11+. Railway scan les vulns au build et bloque sinon.
6. **`frontend/public/` doit exister** dans le repo (sinon Dockerfile COPY échoue) → fichier `.gitkeep` dedans.
7. **zod `.default()` rend les types optionnels en TS** → ne pas en mettre sur les schémas de réponse API. Toujours valider et lever par défaut côté backend.

---

## 11. Historique des phases

| Phase | Date | Description |
|---|---|---|
| **Pré-pivot** | mai 2026 | Modèle initial : sources/templates/assets/wizard/batch. Bot complet bati, Postgres+Redis+Railway en place. |
| **Pivot Phase 1** | mai 2026 | Backend : drop tables `video_sources`, `text_pools`. Drop colonnes `templates.duration_sec`, `source_segments`, `audio_source`. Add `templates.clips`. Migration 0005. Routes templates avec upload clips/overlays. Pipeline rewrite clip-based avec target_duration pour placeholders (tpad+trim/apad+atrim). |
| **Pivot Phase 2** | mai 2026 | Frontend : drop pages `/sources`, `/assets`, `/render/new`. Réécriture éditeur clip-based. Sidebar simplifiée 3 entrées. Templates page sans duration. |
| **Pivot Phase 2.5** | mai 2026 | UX timeline : 55vh, action bar avec 7 boutons "+", thumbnails clips inline (`make_video_thumb` 90x160 à l'upload), audio track pliable, drag-drop file from desktop, sidebar gauche sans bouton add. |
| **Pivot Phase 2.6** | mai 2026 | Détails : emoji picker 80 emojis, timeline resizable (drag handle, persisted localStorage), template card play overlay → video preview, backend cache preview MP4 dans `/data/templates/{id}/preview.mp4`, `_placeholder_preview.mp4` 30s noir pour previews avec placeholders non remplis, fonts-noto-color-emoji ajouté au Dockerfile. |
| **Phase 3** | mai 2026 | Dialog "Lance un render" sur chaque card template (`run-render-dialog.tsx`). Une dropzone par placeholder, multi-files. Upload via `Render.uploadUserVideo` (token). Rule de pairing : N vidéos par placeholder, même N pour tous → N reels. Pour 0 placeholder = 1 reel. Spoofing toggle avec MODELS / COUNTRIES / LANGUAGES / dateWindow. POST `/api/render/batch` puis `router.push("/jobs/{id}")`. Bouton "Lance un render" violet primaire en bas de chaque card. State `runRenderTarget` dans templates/page.tsx. |

---

## 12. Phase 3 — implémenté ✅

### Implémentation
**Fichier principal** : `frontend/src/components/templates/run-render-dialog.tsx`

Le dialog s'ouvre au click sur le bouton "Lance un render" d'une card template (templates/page.tsx tient le state `runRenderTarget: Template | null`). Il :
1. Parse les placeholders depuis `template.clips` via `ClipSchema.safeParse`
2. Pour chaque placeholder, affiche une **dropzone multi-files** avec compteur "X/Y prêts" + liste des fichiers en cours d'upload (avec progress bar par fichier)
3. À chaque drop : upload immédiat via `Render.uploadUserVideo` → token retourné → stocké dans `uploads[placeholderId][i].token`
4. Section **spoofing pliable** : Select model + country + language (auto-déduite du country) + slider dateWindow
5. Validation au "Lancer" : tous les placeholders doivent avoir le même nombre N de fichiers, tous uploadés (token != null), max 50 reels
6. Au lancement : construit `assignments[]` avec une entrée par reel (i ∈ 0..N-1, fills mappe chaque placeholder.id → tokens[i]) → POST `/api/render/batch` → `router.push("/jobs/{id}")`

### Règle de pairing
N vidéos par placeholder, même N pour tous → N reels. Reel `i` = `{template_id, fills: {p1.id: tokens_p1[i], p2.id: tokens_p2[i], ...}}`.

### Cas particulier
Templates **sans placeholder** : un seul reel rendu, fills = `{}`.

### Pas de changement backend
Tout existait déjà : `Render.uploadUserVideo`, `Render.batch`, Celery `process_render_job`, spoofing.

### Limites connues
- Single template par dialog (multi-template à voir si demande)
- Pas de cleanup auto des `/data/temp/{token}.*` orphelins en cas d'annulation du dialog → s'accumulent jusqu'à un cleanup manuel ou un job qui les consomme

---

## 13. Conventions de code

- **Tailwind classes** : groupées par catégorie (layout / spacing / typo / colors), `cn()` pour merge conditionnel
- **shadcn components** : importés depuis `@/components/ui/*`, jamais redéfinis
- **Zod** : pas de `.default()` sur les schemas de réponse API (TS strict casse)
- **Clips/Layers IDs** : générés client-side via `crypto.randomUUID()`
- **Files** : `file_id` = UUID4 hex, jamais l'ID DB
- **Tokens upload** : UUID4 hex, fichier dans `/data/temp/{token}.{ext}`
- **Timestamps DB** : `DateTime(timezone=True)` côté SQLAlchemy, ISO strings côté API
- **Filter complex ffmpeg** : labels en `[name]`, séparés par `;` entre filtres, `,` dans une chaîne unique
- **Error handling** : try/except autour des étapes de lifespan (chacune indépendante), background task cleanup dans Celery tasks

---

## 14. Comment update ce fichier

Quand un changement notable a lieu :
1. Update la section pertinente (Data model, API surface, Pipeline, etc.)
2. Update le tableau "Historique des phases" avec une nouvelle ligne
3. Update "Last updated" en haut
4. Update "Next planned" en haut si différent
5. Si nouveau fichier important : update le file tree section 4
6. Si nouvelle leçon Railway/déploiement : update section 10

**Critère** : si je perds le contexte et que je relis ce doc, est-ce que je comprends l'état actuel + le prochain pas ?
