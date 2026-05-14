# CLAUDE_CONTEXT.md

> Document interne pour Claude. À lire en cas de perte de contexte. À mettre à jour à chaque prompt/changement majeur.
>
> **Last updated**: après Phase 27 (cut au playhead + filmstrip thumbnails sur tracks)
> **Next planned**: tester multi-track end-to-end avec un vrai render ; templates page UX polish ; intégration GIF Giphy si demandée plus tard ; régénérer les filmstrips pour les clips vidéo existants au démarrage (pour l'instant ils sont créés uniquement à l'upload des nouveaux clips).

---

## 1. Le projet en 30 secondes

**bot-montage** = outil web perso d'Enzo pour générer des reels Instagram en série à partir de templates de montage personnels avec des "trous" (placeholders) qu'on remplit avec des vidéos qu'on importe.

**Workflow type** :
1. Enzo construit un **template** dans l'éditeur (style Instagram Edits) : intro fixe + placeholder + outro fixe + textes/images en overlay + musique
2. Plus tard, il lance un batch render : il drop N vidéos pour chaque placeholder, le bot produit N reels (chacun = template avec une vidéo dans le trou)
3. Optionnel : spoofing métadonnées iPhone (QuickTime branding + GPS USA + date random + iPhone 17 Pro etc.) pour que les vidéos passent pour des captures iPhone

**Local-only** depuis Phase 7 — un fichier SQLite, ffmpeg sur la machine, deux terminaux (`uvicorn` + `next dev`). Plus de Railway, Postgres, Redis, Celery, Docker, auth.

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
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind v3 + shadcn/ui + Zustand + zod + emoji-mart |
| Backend | Python 3.11 + FastAPI + SQLAlchemy 2 + Pydantic v2 + Pillow |
| DB | SQLite (un fichier `data/botmontage.db`, schema créé via `create_all` au boot) |
| Worker | `ThreadPoolExecutor` in-process — submit le job_id au pool, le rendu tourne dans un thread du même process que uvicorn |
| Media | ffmpeg + ffprobe + exiftool + AtomicParsley + mutagen + Inter/Montserrat (system ou repo `backend/fonts/`) |
| Auth | aucune (local-only, single-user) |
| Hébergement | localhost — pas de cloud, pas de Docker, deux terminaux (`uvicorn` + `next dev`) |

---

## 4. Layout du projet

```
.
├── README.md                          ← user-facing, install local
├── CLAUDE_CONTEXT.md                  ← CE FICHIER (handover)
├── data/                              ← runtime files (gitignored). SQLite + uploads + renders + emoji cache.
│
├── backend/
│   ├── requirements.txt               ← FastAPI + SQLAlchemy + Pillow + regex + mutagen (Pillow + regex = Phase 6)
│   ├── fonts/                         ← TTF/OTF drops pour 13 slots groupés (Phase 9). README + script `scripts/download_instagram_fonts.py` pour auto-fetch.
│   └── app/
│       ├── main.py                    ← FastAPI app, lifespan (create_all + worker start/stop), /api/health
│       ├── config.py                  ← Pydantic Settings : data_dir, cors_origins, render_workers
│       ├── worker.py                  ← ThreadPoolExecutor singleton, queue_render_job(job_id) (Phase 7)
│       ├── storage.py                 ← chemins data/*, ensure_dirs, install_builtin_fonts, ensure_placeholder_preview
│       ├── media.py                   ← ffprobe + make_video_thumb helpers
│       ├── db/
│       │   ├── __init__.py            ← SQLite engine + WAL pragma, SessionLocal, Base, get_db
│       │   └── models.py              ← Template, Asset, RenderJob (User dropped Phase 7, JSONB → JSON)
│       ├── api/
│       │   ├── templates.py           ← CRUD templates + upload clips/overlays
│       │   ├── assets.py              ← upload/list/delete FONTS uniquement
│       │   ├── fonts.py               ← list + serve (built-in + uploaded)
│       │   ├── files.py               ← serve_asset, template_clip, template_clip_thumb, template_overlay, template_thumb, template_preview, render, render_item
│       │   ├── render.py              ← POST /api/render/upload (token), POST /preview
│       │   ├── photos.py              ← POST /api/photos/spoof (Phase 8 — sync multipart → StreamingResponse ZIP)
│       │   └── jobs.py                ← POST /api/render/batch (queue_render_job), GET /jobs, /jobs/{id}, /dashboard/stats
│       ├── render/
│       │   ├── pipeline.py            ← build_render_command (clip-based, drawtext, overlays, audio mix). text_png_inputs détourne drawtext vers overlay (Phase 6)
│       │   ├── batch_runner.py        ← gather_render_inputs + run_render. _render_text_pngs pré-génère les PNGs Apple-emoji (Phase 6) + _randomize_text_layer pour placement_zone + text_pool (Phase 9)
│       │   ├── text_renderer.py       ← Pillow compositor texte + Apple emojis (Phase 6)
│       │   ├── snap_renderer.py       ← Pillow compositor barre Snapchat-style (Phase 12)
│       │   ├── emoji_pack.py          ← lazy fetch + cache PNGs Apple emoji depuis jsdelivr (Phase 6 backend, même CDN que la picker custom Phase 9)
│       │   ├── metadata.py            ← apply_quicktime_metadata (ftyp patch + mutagen + exiftool) — pour les vidéos
│       │   ├── photo_metadata.py      ← apply_photo_metadata (75 tags exiftool par photo, tirage random indépendant) (Phase 8)
│       │   ├── iphone_lenses.json     ← specs lens + ISO/shutter ranges par modèle iPhone (Phase 8)
│       │   └── countries.json         ← 12 pays avec villes/GPS/timezone (partagé vidéo + photo)
│       └── tasks/
│           ├── __init__.py            ← (vidé Phase 7 — plus d'enregistrement Celery)
│           └── render.py              ← process_render_job(job_id) — fonction pure, appelée par worker
│
└── frontend/
    ├── package.json                   ← next 15.1.11+, react 19, zod, zustand, date-fns, lucide, @emoji-mart/data (juste le JSON, plus la lib React — Phase 9)
    ├── .npmrc                         ← legacy-peer-deps=true (emoji-mart peer-deps lag)
    ├── next.config.ts                 ← rewrites /api/* → http://localhost:8000 (default)
    ├── tailwind.config.ts             ← thème dark par défaut, vars HSL CSS
    └── src/
        ├── app/
        │   ├── layout.tsx             ← root, html dark, Toaster, TooltipProvider
        │   ├── globals.css            ← vars HSL, body bg
        │   ├── (app)/                 ← group avec sidebar+header (plus de protection auth, Phase 7)
        │   │   ├── layout.tsx         ← Sidebar + Header + main
        │   │   ├── page.tsx           ← Dashboard (stats + 8 derniers jobs)
        │   │   ├── render/new/page.tsx ← Wizard 3 étapes Upload→Templates→Confirm (Phase 5)
        │   │   ├── templates/page.tsx ← grille templates avec preview videos
        │   │   ├── photos/page.tsx    ← bulk EXIF spoofing (Phase 8)
        │   │   ├── jobs/page.tsx      ← liste jobs avec polling 2s
        │   │   └── jobs/[id]/page.tsx ← détail job avec previews et downloads
        │   └── editor/[id]/           ← HORS du group (app), full-screen
        │       ├── page.tsx           ← server entry, params → numId
        │       └── editor-view.tsx    ← topbar+sidebar+canvas+inspector+timeline avec resize
        ├── components/
        │   ├── app/
        │   │   ├── sidebar.tsx        ← Dashboard / Nouveau render / Templates / Photos / Jobs
        │   │   └── header.tsx         ← juste un titre (logout retiré Phase 7)
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
        │       ├── snap-layer.tsx             ← canvas render du snap bar (Phase 12)
        │       ├── snap-inspector.tsx         ← inspector dédié snap layer (Phase 12)
        │       ├── emoji-picker.tsx           ← popover emoji-mart Apple set (Phase 5)
        │       └── use-audio-duration.ts      ← hook pour récupérer durée d'un audio par URL
        ├── components/templates/
        │       └── run-render-dialog.tsx      ← dialog single-template (par-card) — wizard `/render/new` couvre le multi-template
        ├── lib/
        │   ├── api.ts                 ← TOUS les schemas zod + fetch helpers + Templates/Render/Jobs/Dashboard/Fonts clients
        │   ├── apple-emoji.ts         ← parseTextWithEmojis (Intl.Segmenter + \p{Extended_Pictographic}) + URLs CDN emoji-datasource-apple (Phase 5)
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

## 6. Layout du stockage `data/` (relatif à la racine du repo en local)

```
data/
├── botmontage.db                 ← SQLite (templates, jobs, fonts metadata) — créé au boot
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
├── apple_emojis/                 ← lazy cache des PNGs emoji-datasource-apple (Phase 6)
│   └── {unified}.png             ← ex: 1f600.png, 1f44d-1f3fc.png, 1f468-200d-1f4bb.png
└── renders/
    ├── {job_id}/
    │   ├── *.mp4                 ← outputs du batch
    │   └── _text_pngs/           ← caches des layers texte avec emoji (Phase 6)
    │       └── {hash}.png        ← canvas-sized RGBA, dedupé par contenu de layer
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

## 10. Lancer le bot en local (single machine)

### Pré-requis
- Python 3.11+, Node 20+ dans le PATH
- ffmpeg + ffprobe + exiftool + AtomicParsley dans le PATH
- (optionnel) Inter-Regular.ttf + Montserrat-Regular.ttf dans `backend/fonts/` (sinon les builtin font picks s'afficheront mal — workaround : upload tes propres TTF via `/api/assets/upload` ou via le picker dans l'éditeur)

### Boot
**Terminal 1 — backend :**
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend :**
```bash
cd frontend
npm install
npm run dev
```

Ouvre `http://localhost:3000`. Pas de login.

### Reset complet
`rm -rf data/` puis relance le backend → SQLite recréé via `Base.metadata.create_all()` au lifespan.

### Pièges historiques (résolus, gardés pour référence)
1. **zod `.default()` rend les types optionnels en TS** → ne pas en mettre sur les schémas de réponse API. Toujours valider et lever par défaut côté backend.
2. **emoji-mart peer-deps lag** → React 19 mais peer dep dit ^16/17/18. `frontend/.npmrc` avec `legacy-peer-deps=true` règle. Marche fine en pratique.

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
| **Phase 4** | mai 2026 | (a) Cleanup : drop `store/index.ts`, `dropzone.tsx`, `upload-list.tsx` (orphelins). (b) `/data/temp` cleanup auto au boot (fichiers > 24h). (c) **Image clips on main track** : nouveau ClipType `image`, schéma zod `ImageClipSchema`, store `addImageClip`, helper `makeImageClip`, action bar bouton "+ Image" (icône `ImagePlus`), upload accepte PNG/JPG, pipeline `is_image: True` → ffmpeg input `-loop 1 -framerate FPS -t duration -i path`, audio toujours silent pour image. Color `bg-emerald-700/80` dans clip-track. Drop overlay "+ Image" button (les images vont sur la track principale ; GIF/Emoji restent en overlay). (d) **Magnetic snap** : layer blocks snappent aux clip boundaries (start/end de chaque clip + 0 + total + playhead) avec threshold ~10px. Helper `snapTo()` dans `editor-timeline.tsx`. (e) Dashboard : bouton "Lancer un render" qui ouvre un Dialog picker (3 col) → choix template → ouvre `RunRenderDialog`. (f) Rapport UX agent reçu (gardé pour application séparée). |
| **Phase 27** | mai 2026 | **Cut au playhead + filmstrip thumbnails.** Pour la cut : nouvelles actions store `splitMainClip(clipId, atTime)` et `splitExtraClip(trackId, clipId, atTime)`. Calcule la position absolue du clip sur la timeline, le `localCut = atTime - clipAbsStart`, refuse les coupures < 0.05s du début ou de la fin (sinon le clip de droite n'a pas de matière). Pour les vidéos `fixed` : le 1er morceau hérite de `trim_in` et `trim_out=trim_in+localCut` ; le 2ème a `trim_in=trim_in+localCut` (et `start_time` ajusté pour les extra). Pour les images/placeholders : split sur `duration_sec`. Le 2ème morceau reçoit un nouveau `id`. Inspector du clip : nouveau bouton "✂ Couper ici (X.XXs)" avec `Scissors` icon, désactivé si playhead pas dans le clip avec hint explicite. **Filmstrip** : à l'upload d'une vidéo `fixed`, en plus du single thumbnail, le backend génère un `{file_id}_strip.jpg` via ffmpeg `fps=N/duration,scale=80:60,pad,tile=Nx1` qui produit une image large avec N=min(60, max(2, int(duration))) frames tilées horizontalement. Best-effort, échec → on garde juste le single thumb. Nouveau endpoint `GET /api/files/template_clip_strip/{tid}/{fid}`. Frontend `clip-track.tsx` et `extra-track-lane.tsx` : le clip block utilise désormais le filmstrip en `background-image` avec `background-size: 100% 100%` (étiré pour matcher la largeur du clip → chaque frame s'aligne sur sa position temporelle). Images gardent le single thumb avec `cover`. Couplé au cut button, l'user peut maintenant voir où couper en un coup d'œil + cliquer pour couper, plus besoin de drag aveugle. |
| **Phase 26c** | mai 2026 | **Hotfix UX multi-track** : (a) Drag-resize handles sur les clips d'extra tracks (avant : seulement drag-to-move, le user devait passer par l'inspector pour rogner). 2 helpers `startTrimLeft`/`startTrimRight` sur `extra-track-lane.tsx`. Le bord gauche décale `start_time` ET ajuste `trim_in` (pour fixed) pour synchroniser le contenu, ou décale `start_time` + raccourcit `duration_sec` (pour image/placeholder). Bord droit étend `trim_out` (clamp à `source_duration_sec`) ou `duration_sec`. Snap aux clip boundaries comme le drag de body. (b) Code couleur cohérent. Nouvelle constante `CLIP_COLORS` dans `editor-types.ts` (fixed=violet, image=emerald, placeholder=yellow dashed). LAYER_COLORS gif/emoji passés à rose/orange pour distinguer du Snapchat-yellow. ClipTrack mis à jour (sky → violet pour fixed). ExtraTrackLane n'utilise plus zinc/grey générique mais la même palette que la main track. |
| **Phase 26b** | mai 2026 | **Multi-track vidéo** (max 5 tracks plein écran, Option A choisie par le user). **Backend** : nouvelle col `extra_tracks: JSON list (default [])` sur Template, migration ALTER TABLE idempotente dans `main.py` lifespan. Schéma : `[{id, name, clips: [{id, type, file_id, start_time (ABSOLUTE), duration_sec, trim_in, trim_out, audio_enabled, audio_volume, source_*}]}]`. Pydantic `TemplateRead.extra_tracks: list = Field(default_factory=list)` + `TemplateUpdate.extra_tracks: Optional[list]`. `create_template` et `duplicate_template` mis à jour pour init/copier `extra_tracks` + leurs fichiers clips. **Pipeline** : nouvelle dataclass `ExtraClipInput(path, start_time, duration_sec, trim_in, trim_out, audio_enabled, audio_volume, is_image)` dans `pipeline.py`. `build_render_command` prend un nouveau param `extra_clips: Optional[list[ExtraClipInput]]`. Pour chaque extra clip : input ffmpeg séparé (`-loop 1 -t dur` si image), filter graph qui trim source → scale+crop canvas → tpad+trim pour forcer durée exacte → `setpts=PTS+start_time/TB` pour décaler à la position absolue → overlay sur `current_v` avec `enable=between(t,start,start+dur)`. Audio per extra clip : atrim → volume → atrim duration → adelay correspond au start_time → label `ea{i}`. Section 6 audio refactor : `audio_inputs` est maintenant une list (main_a + ovl_a si présent + tous les ea*) et amix s'adapte au nombre. **batch_runner** : `RenderContext` étend avec `extra_clips: list[ExtraClipInput]`. `gather_render_inputs` itère `template.extra_tracks` à la fin, résout les fichiers clips (réutilise `template_clips_dir` car tous les clip files vivent là), gère type fixed/image/placeholder (placeholders extra → fallback sample video). **Frontend lib/api.ts** : nouveaux schemas Zod `ExtraClipBaseSchema`, `ExtraFixedClipSchema`, `ExtraImageClipSchema`, `ExtraPlaceholderClipSchema`, `ExtraClipSchema = discriminatedUnion`, `ExtraTrackSchema = {id, name, clips: array}`. `TemplateSchema.extra_tracks: z.array(z.unknown())` (tolerant, parsing strict dans le store via `ExtraClipSchema.safeParse`). **Store editor.ts** : `extraTracks: ExtraTrack[]` + `selectedExtraTrackId: string | null` + helper `parseExtraTracks(raw)` qui safeParse chaque clip. Constante `MAX_EXTRA_TRACKS = 4` (5 total avec main). Actions : `addExtraTrack` (capped à MAX), `deleteExtraTrack`, `renameExtraTrack`, `addExtraFixedClip/ImageClip/PlaceholderClip(trackId, ...)` qui retournent `null` si trackId introuvable, `patchExtraClip(trackId, clipId, patch)`, `deleteExtraClip(trackId, clipId)`. `setSelectedExtraClip(trackId, clipId)` pour la sélection. `persist` envoie `extra_tracks: s.extraTracks` au backend. **UI timeline** : nouveau composant `extra-track-lane.tsx` qui rend chaque track comme une lane avec clips placés en absolute (left = `start_time * pxPerSec`, width = duration * pxPerSec). Drag pour repositionner avec snap aux clip boundaries. Header overlay avec input rename + bouton trash + boutons "+ Vidéo/+ Placeholder" + badge "T2/T3/...". Drop-zone for desktop file upload. `editor-timeline.tsx` insère ces lanes après ClipTrack et avant audio. Bouton **"+ Track"** dans `timeline-action-bar.tsx` (variant indigo, disabled à 4 extra tracks). **Editor canvas** : nouveau sous-composant `ExtraClipCanvas` rendu en absolute par-dessus le main canvas, sorted par trackIdx ascending (last on top). Pour fixed videos : `<video>` muté + seek useEffect basé sur `localTime + trim_in`. Pour images : `<img>` static. Pour placeholders extra : sample video fallback. **Inspector** : `clip-inspector.tsx` accepte un nouveau prop `extraTrackId?: string`. Quand set, polymorphe sur `patchExtraClip`/`deleteExtraClip` au lieu de `patchClip`/`deleteClip`. Nouvelle Section "Position (s)" qui édite `start_time` (extra clips uniquement). Le bouton "Utiliser comme audio overlay" est masqué pour extra clips (pour l'instant — backend cherche dans template.clips). `editor-inspector.tsx` résout le clip depuis le store — si `selectedExtraTrackId` set, lookup dans extra_tracks ; sinon main clips. **Limites connues v1** : pas de drag-trim handles sur les clips extra (faut éditer trim_in/trim_out via inspector) ; le bouton "Utiliser comme audio overlay" ne marche que pour main track ; pas de réordonner les extra tracks (faut delete + recreate) ; les extra placeholders sont basiques (utilisent juste le sample video global, pas de fill workflow comme la main track). Tout ça extensible plus tard. |
| **Phase 26a** | mai 2026 | **Snap inter-layer** (timeline). Avant : les blocs layers (texte/snap/image/gif) ne snappaient qu'aux bords des clips, au playhead, à 0 et à la durée totale (Phase 4). Maintenant : ils snappent aussi aux **bords des AUTRES layers** (start_time + end_time). Implémenté côté `editor-timeline.tsx` : pour chaque `LayerLane` rendu, on calcule un `otherLayerEdges` qui itère `layers` en excluant `layer.id` (sinon un layer s'aimanterait à lui-même = bloqué), puis on passe `snapPoints={[...snapPoints, ...otherLayerEdges]}` au composant. Marche sur les 3 modes existants : drag-to-move, resize-left, resize-right. Seuil inchangé (~10px en distance écran, converti en seconds via `pxPerSec`). Use case : aligner facilement la fin d'un texte au début d'un autre pour faire un effet "relais" sans à coup. |
| **Phase 25** | mai 2026 | **Audio routing flexible + text defaults + sample placeholder pause.** (a) **Audio overlay accepte la vidéo** (mp4/mov). `ALLOWED_OVERLAY_EXTS` étendu, frontend `accept=` dans `audio-inspectors.tsx` étendu (`video/mp4,video/quicktime,.mp4,.mov`). À l'upload, si l'extension est vidéo, backend ffmpeg `-vn -c:a aac -b:a 192k` extrait l'audio en `.m4a` puis supprime le fichier source vidéo. Le `file_id` reste le même, le pipeline voit un m4a normal — aucun changement côté render. (b) **Bouton "Utiliser comme audio overlay" sur les clips fixed** dans `clip-inspector.tsx`. Click → `POST /api/templates/{id}/clips/{clip_id}/use-as-overlay` qui retrouve la vidéo du clip via `find_template_file`, ffmpeg-extract son audio complet (pas juste la trim_in→trim_out portion — l'audio doit pouvoir jouer dès t=0 du template) → save dans overlays dir comme nouveau `file_id.m4a`, set `template.audio_overlay = {file_id, volume:1, start_offset:0, trim_in:0}`, set `clip.audio_enabled = false` (évite doublon pendant la portion où le clip vidéo est visible). Retourne le template modifié, frontend mirror via `patchAudioOverlay` + `patchClip` (pas `loadTemplate` pour ne pas perdre les autres edits non flushés). Use case du user : placeholder visuel 0-3s mais avec l'audio de la vraie vidéo qui joue déjà, puis 3-fin = vidéo + son. (c) **Text layer defaults** changés dans `lib/editor-types.ts` `defaultLayerData("text")` : `font_id: "montserrat_bold"` (au lieu de "inter"), `style: "stroke"` (au lieu de "plain"), `stroke_width: 3` (au lieu de 4), `line_height: 0.95` (au lieu de 1.2 — saut de ligne serré style Insta). Tous les autres champs gardés. Chaque nouveau text layer apparaît directement avec le look Instagram bold + outline noir 3px. Le user peut toujours changer ensuite. (d) **Sample placeholder video pause toggle** (out-of-band, branche EditorCanvas) : bouton ⏸/▶ rond noir en haut-droite du canvas quand un placeholder est actif et le sample existe. Cliquer fige sur la frame courante, persisté en `localStorage["editor.samplePaused"]` pour ne plus avoir à re-pause à chaque session. (e) **Pause aperçu globale sur `/templates`** : bouton "⏸ Pause aperçu" qui apparaît seulement quand `currentlyPlayingId !== null`. (f) **Cover de la card via picker frame** : nouveau modèle, `cover_time_sec` + extraction ffmpeg (cf. Phase 24c originelle remplacée). |
| **Phase 24** | mai 2026 | **Trio UX**: (a) **Preview qualité prod**. `POST /api/render/preview` rendait avec `crf=28 preset=ultrafast` (~5-10s) → output qui ne reflétait pas le rendu final. Bumpé à `crf=18 preset=slow timeout=600` pour matcher exactement les renders batch. La preview est plus longue (~30s+) mais ce qu'on voit dans la card = ce qui sortira au render. (b) **Multi-templates en mode "Per-video"** dans le wizard `/render/new`. Avant : `perVideoTpl: Record<string, number>` → 1 template par vidéo via `<Select>` single. Maintenant : `Record<string, number[]>` → chaque vidéo peut cocher N templates via chips multi-select. Chaque paire (vidéo, template) = 1 reel. Buttons "Tout"/"Aucun" par vidéo pour aller vite. `buildAssignments()` boucle sur les paires, `reelCount` = somme des longueurs, `canGoNext` = chaque vidéo a ≥1 template. Modes "all" et "random" préservés inchangés. (c) **Cover de la card = frame piochée dans l'aperçu**. Pas un upload externe : l'user choisit un timestamp dans le preview MP4 et le backend ffmpeg-extrait la frame correspondante en JPEG. Nouvelles cols `cover_ext: Optional[str]` (= "jpg" quand présent) + `cover_time_sec: Optional[float]` sur Template, avec migration légère ALTER TABLE idempotente dans `main.py` lifespan (pas d'Alembic — `inspect(engine).get_columns("templates")` puis ALTER si absent). Helpers `template_cover_path(id, ext)` + `find_template_cover(id)` dans `storage.py`. Endpoint `POST /api/templates/{id}/cover/from-time` body `{time_sec: float}` qui exige un preview existant (sinon 400 «&nbsp;Génère d'abord un aperçu rendu&nbsp;»), wipe l'ancien cover, ffmpeg `-ss T -i preview.mp4 -frames:v 1 -q:v 3 cover.jpg` (seek pre-input pour vitesse), set `cover_ext="jpg"` + `cover_time_sec`. `DELETE /api/templates/{id}/cover` clear les deux cols + supprime le fichier. `GET /api/files/template_cover/{id}` sert l'image avec le bon Content-Type. Le `duplicate_template` copie aussi le fichier + les deux cols. **Frontend** : `Templates.setCoverFromTime(id, time)` + `Templates.deleteCover(id)` dans `lib/api.ts`. `TemplateSchema.cover_ext` + `cover_time_sec` ajoutés. `TemplateCard` essaie d'abord `template_cover/{id}?t={updated_at}` quand `cover_ext != null`, sinon le `template_thumb/{id}` legacy (avec fallback `onError`). Click play sur la cover lance toujours le preview MP4 (la cover = juste image statique). UI : bouton `🖼 Cover` dans le topbar de l'éditeur ouvre `<CoverPickerDialog>` qui charge le preview dans un `<video>` muet (read `duration` au `onLoadedMetadata`), un `<input type=range>` qui contrôle `videoRef.currentTime` → l'user voit la frame en temps réel pendant qu'il scrub. Boutons «&nbsp;Définir comme cover&nbsp;» (POST) + «&nbsp;Supprimer la cover&nbsp;» si présente. Le dialog re-seed `time` depuis `template.cover_time_sec` à chaque ouverture pour pré-positionner. Si pas de preview → message bloquant "génère d'abord un aperçu". `patchTemplate` accepte maintenant `cover_ext` + `cover_time_sec` dans son `Pick`. Le serveur fait UPDATE → `onupdate=func.now()` bump `updated_at` → cache-bust auto. |
| **Phase 23** | mai 2026 | **Full-span overlays auto-extend en mode auto-durée.** Suite de Phase 18 : quand un template est 100% placeholder, sa durée nominale (somme des `clip.duration_sec`) peut différer de la durée réelle de l'output (somme des `ffprobe(source).duration`). Avant : les overlays texte/snap/img/gif gardaient leurs `start_time/end_time` absolus → un overlay qui couvrait tout le template (ex 0→5s) restait à 0→5s même si l'output finissait par durer 7s, laissant 2s de vidéo à poil à la fin. Maintenant : nouveau helper `_extend_fullspan_overlays(layers, template_total, actual_total)` dans `batch_runner.py` qui détecte les overlays "full-span" (`start_time <= 0.001` AND `end_time >= template_total - 0.1`, tolérance 100 ms pour absorber les imprécisions slider) et bumpe leur `end_time` à `actual_total`. Les overlays "slice" (qui couvrent juste un moment précis) gardent leurs timings absolus — le user a placé son texte sur un beat, on respecte. **Détection rule choisie option A** : full-span = couvre la durée totale du template, sinon laisse tel quel. Wired dans `gather_render_inputs` après le bloc auto-durée et après `_randomize_layers` (donc patche la liste finale qui part au pipeline). No-op si template_total == actual_total ou si template_total <= 0. Helper `_clip_actual_duration(c)` calcule la durée effective d'un `ClipInput` (priorité target_duration → trim_out-trim_in) — utilisé pour sommer `actual_total`. Mode mixed (au moins 1 fixed/image dans la timeline) : non concerné, comportement legacy intact. |
| **Phase 22.1** | mai 2026 | Hotfix UX cards `/templates` : Phase 21 cachait le bouton play, le slider volume et les icônes Edit/Regen/Dup/Delete derrière `opacity-0 group-hover:opacity-100`. Sans hover la card paraissait morte (juste un carré noir). Refonte : (a) **Play overlay always-visible** quand paused (`opacity-100` direct, plus de gate hover) — le bouton blue circle Play est centré dès l'affichage, le user comprend tout de suite que c'est cliquable. Quand `playing=true`, l'overlay reste hover-only pour pas couvrir la vidéo. (b) **Action icons top-right** passent de `opacity-0` à `opacity-70`, full opacity au hover. Toujours visibles, juste atténués. (c) **Volume slider bottom-left** pareil : `opacity-70` par défaut, full au hover. Le user voit tout de suite ce qu'il peut faire avec la card sans avoir à deviner par hover discovery. |
| **Phase 22** | mai 2026 | **Aperçu stale fix sur les cards `/templates`**. Bug : si le user édite un template (ajoute du texte, change un overlay) le preview MP4 cached **n'est pas auto-régénéré** — il reflète l'ancien état. Le bouton "Générer un aperçu" de Phase 21 ne s'affichait QUE quand le fichier était 404 (manquant), donc les previews stale (file existe mais obsolète) étaient invisibles à régénérer. Fix : (a) **Bouton `RefreshCw` always-visible au hover** dans la rangée Edit/Duplicate/Delete top-right de la card → click = re-render le preview (icon spin pendant la génération). (b) **Cache-bust auto** : `previewVersion` initialisé à `template.updated_at.getTime()` au lieu de `0`. Donc dès qu'un template est édité, son `updated_at` change → l'URL preview change → le browser refetch → le user voit la version la plus récente du fichier sans cache stale. Plus tard, après une régen explicite, on bump `previewVersion = Date.now()` pour forcer le refetch immédiat. (c) `IconBtn` accepte `disabled` prop pour le state "génération en cours". |
| **Phase 21** | mai 2026 | **Refonte UX des cards `/templates`**. (a) Click sur le body de la card ne re-route plus vers l'éditeur — il toggle play/pause de la preview. L'icône Edit (pencil) en top-right est le seul moyen d'ouvrir l'éditeur. Désambiguïse l'intention click. (b) **One-at-a-time** : `TemplatesPage` lift `currentlyPlayingId: number | null` + `setCurrentlyPlayingId`, passé à chaque `<TemplateCard>` via props. Quand une card démarre, elle set son id ; les autres useEffect pause leur `<video>` quand `currentlyPlayingId !== template.id`. Pas de chaos sonore avec 20 templates. (c) **Volume** : slider global dans le header (`Volume2`/`VolumeX` icon + range 0-1) + slider per-card qui apparaît au hover (bottom-left de la preview). Override : `effectiveVolume = cardVolume ?? globalVolume`. Le `<video>` ref écoute les changements et applique `videoRef.current.volume = effectiveVolume` en useEffect. (d) **Generate preview inline** : si `<video onError>` détecte que `template_preview/{id}` n'existe pas, on swap le bouton play par "Générer un aperçu" (icône `Wand2`). Click → `Render.preview(template.id, [])` (empty fills, le backend utilise le sample video / black fallback de Phase 17 comme placeholder fill). Spinner overlay pendant la génération (~5-10s pour CRF 28 ultrafast preset). À la fin, `setPreviewVersion(v+1)` cache-bust l'URL `/api/files/template_preview/{id}?t={n}` pour forcer le refetch. (e) Plus de remontage du `<video>` à chaque play/pause — l'élément reste mounté tout le temps (juste opacity 0/100), play/pause pilotés via `videoRef.current.play()/pause()`. Cleaner, instantané, pas de flash noir au démarrage. |
| **Phase 20** | mai 2026 | UI tweaks pour le spoofing : (a) **Pill ON/OFF coloré** : remplace le texte muted "ON"/"OFF" sur les toggles "Spoofer les métadonnées" → vert quand ON (`bg-emerald-500/20 text-emerald-300 ring-emerald-500/40`), rouge quand OFF (`bg-red-500/20 text-red-300 ring-red-500/40`). Composant `<OnOffBadge enabled={...}>` dupliqué dans `run-render-dialog.tsx` et `app/(app)/render/new/page.tsx` (Step3Confirm). Photos page n'a pas de toggle (le spoofing y est implicite — c'est le but de la page). (b) **iPhone 17 par défaut + "Changer"** : avant, le user devait choisir un modèle dans une dropdown / multi-select chips. Maintenant `DEFAULT_MODEL = "iPhone 17"` est sélectionné automatiquement, affiché en pill `📱 iPhone 17` avec un petit lien underline "Changer" qui révèle/replie le picker (chips multi-select pour photos, chips single-select pour vidéos). Quand on clique sur un autre modèle dans le picker, le picker se referme automatiquement (pour vidéos). (c) **iPhone 16 Plus retiré** des 3 listes MODELS (photos / wizard / run-render-dialog) — le user ne s'en sert pas. La liste finale = 16, 16 Pro, 16 Pro Max, 17, 17 Pro, 17 Pro Max. |
| **Phase 19** | mai 2026 | (a) **Bug rendu vidéo vs canvas** : l'espacement entre lignes du Pillow renderer (backend) ne matchait pas le canvas (frontend CSS). Cause : Pillow utilisait `line_spacing = (ascent + descent) × line_height` alors que CSS fait `font-size × line-height`. Pour la plupart des fonts, ascent+descent ≈ 1.1-1.3 × font_size, donc le rendu vidéo était systématiquement **plus aéré** que l'éditeur. Fix : `line_spacing = font_size × line_height` dans `text_renderer.py` → comportement identique à CSS, aperçu = rendu pixel pour pixel. `base_line_h` (ascent+descent) reste utilisé pour la hauteur visuelle du glyph (highlight box) et le centre vertical des emojis — ce sont les bons usages. (b) **Toggle "Saut de ligne serré (style Insta)"** ajouté à la section STYLE de `text-inspector.tsx`. Coche → `line_height = 0.95` (les ascenders/descendants se touchent presque, comme les captions Insta multi-lignes type "1. I'm / 2. just / 3. a 2008 / ..."). Décoche → `1.2` default. Détection de l'état : `data.line_height < 1.1`. |
| **Phase 18** | mai 2026 | **Auto-durée pour les templates 100% placeholder** ("habillage léger"). Avant : chaque placeholder avait une `duration_sec` fixe (ex: 5s) qui forçait trim/freeze-pad de la vidéo source. Pratique pour les templates rigides (intro fixe + 5s + outro fixe), galère quand le template est juste un placeholder + des overlays texte/snap qui flottent dessus — l'output était trim à la durée nominale au lieu de prendre la vraie durée du clip user. **Nouveau** : si **tous** les clips de la timeline sont des `type=placeholder` (zéro `fixed`/`image`), `gather_render_inputs` ffprobe chaque source uploadée et set `target_duration=None` + `trim_out=trim_in+duration_source`. Le video chain ne fait plus de tpad+trim, l'audio chain (silent fallback OU vraie audio) utilise `trim_out - trim_in` = durée naturelle source → concat parfait, output = somme des durées sources. Mode mixed (au moins 1 fixed/image dans la timeline) : comportement legacy gardé (tout est trim/pad à la `duration_sec`). Image placeholders (théoriquement impossibles, mais defensive) : exclus du loop pour pas casser leur loop logic. ffprobe failure = log warning + keep target_duration → le render continue avec la durée nominale. Pour le preview : si le sample video uploadé est plus court que la `duration_sec` configurée, l'aperçu sera plus court (et inversement) — c'est cohérent avec ce que verra le user au render réel. **Overlays** (texte/snap/img/gif) : leurs `start_time/end_time` restent absolus comme défini par l'user (réponse Q3=A) — ils peuvent dépasser la durée du clip si l'output est plus court que prévu, FFmpeg les coupe juste à la fin. |
| **Phase 17** | mai 2026 | **Vidéo exemple globale + drawtext crash fix.** (a) Nouveau slot global `data/sample_placeholder.mp4` uploadé une fois via dialog "Vidéo exemple" sur `/templates`, utilisé partout où un placeholder vide aurait montré du noir : preview render (`fill_missing_placeholders_with=placeholder_fallback_path()`), éditeur canvas (`<video>` joué inline au lieu du tile jaune "📷 Placeholder"), grille `/templates` (automatique via le cached `template_preview_path`). Backend : `app/api/sample_video.py` (GET/POST/DELETE + GET `/info` qui retourne `{exists, size, duration, w, h}` via `video_metadata`). Helper `placeholder_fallback_path()` dans storage qui renvoie le sample si présent, sinon le `_placeholder_preview.mp4` 30s noir. Helper `invalidate_template_previews()` qui supprime tous les `templates/{id}/preview.mp4` cachés à chaque upload/delete (pour pas servir un preview stale). Frontend : `SampleVideo` client dans `lib/api.ts`, `<SampleVideoDialog>` dans `components/templates/`, hook `EditorCanvas` qui probe `SampleVideo.info()` au mount + remplace le tile jaune par un `<video autoPlay loop muted>` si `exists=true`. (b) Fix **`drawtext` crash sur ffmpeg gyan-dev Windows** : reproductible avec rc=`0xC0000005` (access violation) au moment où libavfilter init drawtext, parce que libfontconfig n'a pas de config par défaut sur Windows. Tentative initiale = stub `backend/fontconfig/fonts.conf` + env var `FONTCONFIG_FILE` (via `app/bin_finder.ffmpeg_env()`) → ne supprime que le warning, le crash reste. Vraie solution : route **TOUS les text layers** (pas juste ceux avec emoji) via le compositor Pillow déjà en place pour les emojis Apple. `_render_text_pngs()` sait gérer le texte plain — on a juste enlevé le check `text_contains_emoji`. Plus de drawtext = plus de crash. Léger surcoût (~50ms par PNG transparent canvas-sized) acceptable vu que le render entier prend ~30s. Avantage collatéral : Apple emojis maintenant dans tous les rendus vidéo, pas seulement les textes qui en ont à la création. (c) Meilleure capture d'erreur ffmpeg : `_run_render` log full stderr+stdout+cmd, et l'exception remonte les lignes contenant `error|invalid|failed|...` (skip les lignes de banner `lib*`/`built with`/etc.) au lieu du dernier 1500 chars qui était juste le banner version. (d) Helper `bin_finder.ffmpeg_env()` qu'on passe en `env=` à tous les subprocess ffmpeg/ffprobe (plus de surprise PATH ou fontconfig). (e) Mutagen 1.47 fix : keys freeform passées de `----:com.apple.quicktime.make` (`.`) à `----:com.apple.quicktime:make` (`:`) sinon `not enough values to unpack (expected 3, got 2)` au save MP4. (f) BatchExifTool de Phase 16 désactivé (hangait sur Windows à cause de buffer stdout) — on revient au subprocess.run par photo, plus lent (~1s/photo) mais fiable. |
| **Phase 16** | mai 2026 | **Fix gros batches photo + speedup ~30×.** Le user a essayé 1300 outputs (10 photos × 130 comptes broadcast) → "Internal Server Error". Cause : `io.BytesIO()` accumulait ~4 GB en RAM (1300 × ~3 MB) → OOM Python. Trois fixes : (1) **ZIP sur disque** : `zipfile.ZipFile(zip_path, ...)` dans `work_dir/_export.zip` puis `FileResponse(...)` au lieu de `StreamingResponse(BytesIO)`. Cleanup du work_dir via `BackgroundTasks` (sinon le ZIP est supprimé avant streaming). `allowZip64=True` pour les ZIPs >4 GB. (2) **`shutil.copy` wrappé en try/except** : avant, une copie qui échoue (disque plein, permission denied) crashait toute la requête. Maintenant juste loggé dans `errors[]`, on continue. (3) **Top-level exception handler** : `except HTTPException: raise` puis `except Exception as e:` qui retourne `500` avec `f"Erreur pendant le spoofing : {e.__class__.__name__}: {str(e)[:300]}"`. Plus de "Internal Server Error" muet. **Plus le speedup** : nouveau module `app/render/exiftool_batch.py` avec `BatchExifTool` context manager qui maintient **un seul process exiftool alive** (`-stay_open True -@ -`) pour tout le batch. `apply_photo_metadata()` accepte `batch_tool: Optional[BatchExifTool]` ; quand fourni, écrit les args sur stdin + `-execute`, lit stdout jusqu'à `{ready}\n`. Saute le startup Windows ~250 ms/photo + AV scan + Python subprocess overhead. **Mesure** : 250 outputs en 4 min sans batch → ~13 s avec batch (~30×). 1300 outputs ≈ 1 min au lieu de 20 min. `-q -q -overwrite_original` passés via `-common_args` au launch pour pas les répéter à chaque photo. Fallback per-call subprocess gardé pour les callers standalone (preview path éventuel). Fix uvicorn `--reload` détectera le nouveau module au save. |
| **Phase 15** | mai 2026 | **Multi-VA select pour le photo export** (option A "indépendant" choisie par le user). Backend : `va_id: Optional[int]` → `va_ids: list[int]` (multi-value form field, dédupliqué côté serveur). Le serveur loope sur chaque VA et applique la même logique de distribution (broadcast ou one_per_account) indépendamment — chaque VA produit son propre subtree `{va.name}/Compte N/...` dans le ZIP final. Validation `one_per_account` étendue : si **au moins un** VA sélectionné a plus de comptes que le nombre de photos uploadées, le serveur exige `allow_loop=true`. `MAX_OUTPUTS` cap recalculé en sommant les `account_count` des VAs. Nom du ZIP : `photos_spoofed_…` si pas de VA, `{vaname}_{base}_…` si 1 VA, `export_{N}_VAs_{base}_…` si plusieurs. **Frontend** : la dropdown VA single-select devient des **chips multi-select** (toggle on/off), recap dynamique avec une liste à puces par VA (`VA-Alpha → 3 comptes = 6 fichiers · VA-Bravo → 2 comptes = 4 fichiers`) + grand total. Disponible pour broadcast ET one_per_account. Le mode toggle reste partagé entre tous les VAs sélectionnés (si tu veux des modes différents par VA, faudra splitter en 2 batches). |
| **Phase 14** | mai 2026 | **Modes de distribution photo→comptes** ajoutés au mode VA. (1) **`broadcast`** (default — Phase 13 behavior) : toutes les N photos dans chaque compte → N×M outputs. Use case : poster le même feed sur tous les comptes. (2) **`one_per_account`** (nouveau, Phase 14) : 1 photo unique par compte → M outputs, filename constant `{filename_base}.{ext}`. Use case : photos de profil. **Backend** : params form `distribution: str` + `allow_loop: bool` ajoutés à `/api/photos/spoof`. Logique pour `one_per_account` : si N≥M random.sample sans replacement, si N<M et `allow_loop=true` → cycling (`pool[i % N]`) ; si N<M et pas de loop → 400 explicite. `MAX_OUTPUTS` cap recalculé en fonction du mode. **Frontend** : `PhotoDistribution` type + champs sur `PhotoSpoofProfile`. Page `/photos` étendue avec deux radio cards `<DistributionCard>` côte-à-côte (Broadcast / 1 par compte) chacune avec titre, subtitle, et un **example dynamique** qui se met à jour en fonction du nombre de photos uploadées. Quand `one_per_account` + N<M, checkbox "OK même si moins de photos que de comptes" apparaît avec un texte explicite ; sans cocher, le bouton "Générer" est désactivé et un texte rouge indique "upload X photos de plus". Recap dynamique en bas avec le pattern de filename selon le mode (`/Compte N/photo_de_profil.ext` vs `/Compte N/photo_M.ext`). |
| **Phase 13** | mai 2026 | **Virtual Assistants (VA) + export photo hiérarchisé**. Le user voulait pouvoir générer N×M photos avec une structure de dossiers `VA/Compte 1/, VA/Compte 2/, ...` plutôt qu'un ZIP plat — un VA = "Virtual Assistant" qui possède N comptes, et au moment de l'export chaque compte reçoit une copie spoofée des photos source avec un modèle iPhone aléatoire choisi parmi une multi-sélection. **Backend** : nouveau modèle SQLAlchemy `VirtualAssistant` (id, name unique, account_count, timestamps) — schema auto-créé via `Base.metadata.create_all()` au boot. Nouveau router `app/api/vas.py` avec CRUD complet (list/create/update/delete). `/api/photos/spoof` enhanced : `model: str` devient `models: list[str]` (multi-value form field), nouveaux params optionnels `va_id` et `filename_base`. Quand `va_id` est set, le ZIP est structuré `{va.name}/Compte N/{filename_base}_M.{ext}` ; sinon flat (ancien comportement). **Multi-models tirage** : flat mode = 1 modèle random par photo ; VA mode = 1 modèle random **par compte** (toutes les photos d'un compte ont le même téléphone — plus crédible, 1 compte = 1 device). Safety cap `MAX_OUTPUTS=5000` (N_photos × N_accounts) côté serveur. **Frontend** : nouvelle page `/vas` (CRUD list+create+edit+delete avec dialog), sidebar entry "VAs" (icône Users). `/photos` page refondue : multi-select buttons pour les modèles iPhone (au moins 1 sélectionné, toggle on/off), nouveau bloc "Structure d'export" avec dropdown VA + input filename_base + récap "Va générer X photos dans Y dossiers". Toujours sync (exiftool ~30 ms × outputs, ok jusqu'à ~500 photos = ~15s). Le VA modèle est volontairement minimal (juste name + count) pour pouvoir le réutiliser tel quel pour les exports reels Phase 14+. |
| **Phase 12** | mai 2026 | (a) **Slider Taille du texte (px)** ajouté à la section STYLE du text-inspector. Range 12-200 px. Conversion px↔font_size_pct sur la base canvas height = 1920 (`px = pct/100 * 1920`). Le user m'avait demandé de virer la taille en Phase 10 ("comme Instagram pas de variation entre textes") mais en réalité voulait garder le contrôle, juste pas un panneau bordélique. (b) **Nouveau type de layer `snap`** : barre Snapchat-style. `LayerTypeSchema` étendu, nouveau `SnapLayerDataSchema` minimal (`filter_type: "snap"`, `text`, `text_pool`, `font_size_px`, `y_pct_min`, `y_pct_max`). Bar rendu pleine largeur canvas, fond noir 45% alpha, texte blanc bold centré. Position verticale random per render entre `y_pct_min`/`y_pct_max`. Pool de variations comme les text layers. **Frontend** : `snap-layer.tsx` (canvas), `snap-inspector.tsx` (inspector dédié — Type de filtre dropdown / In/Out / Taille px / Y min-max / Pool de textes), bouton **+ Snap** dans la timeline action bar (variant jaune Snapchat), router dans `editor-inspector.tsx` qui dispatch `text` vs `snap` vs visual. Store : `addLayer("snap")` ajuste les défauts (x=0, w=100 — pleine largeur). **Backend** : `snap_renderer.py` réutilise `_segments` et `_wrap_tokens` du text-renderer pour le tokenizing + Apple emoji compositing. Bar dessinée via `draw.rectangle()`. `_randomize_snap_layer` dans batch_runner pioche text_pool + Y entre min/max à chaque render. `_render_text_pngs` (renommée mentalement "_render_overlay_pngs") gère maintenant les snap layers en plus des text-with-emoji ; cache key inclut le Y rolled (différent par output dans un batch). `pipeline.build_render_command` ajoute un case `layer_type == "snap"` qui overlay le PNG comme pour les text-with-emoji. Settings hardcodés (couleur barre, opacité, padding, font system) — le screenshot du user montre seulement 4 contrôles utiles donc on garde ça minimal. Si extensions demandées plus tard, on rajoute des champs au schema. |
| **Phase 11** | mai 2026 | Round de bug fixes + features sur le text editor : (1) **Font Content-Type fix** : `/api/fonts/{id}` renvoyait `text/plain` (FastAPI default) → tous les browsers refusaient le `@font-face` → la police choisie ne s'appliquait jamais (silent fallback sur system-ui). Nouveau helper `_font_response()` dans `app/api/fonts.py` force `font/ttf` / `font/otf` / `font/woff` selon l'extension + `Cache-Control: immutable`. (2) **Emoji picker overflow fix** : la popover était `absolute right-0` (340px de large) → débordait à gauche dans l'inspector étroit, coupant les premières catégories. Réécrite en `position: fixed` avec calcul `getBoundingClientRect()` du bouton + clamp aux bords de l'écran + flip vertical si pas assez de place. Référence button + popover + close-on-outside via 2 refs. (3) **Multi-zones aléatoires** : nouveau champ `placement_zones: Zone[]` (le legacy `placement_zone` singular est gardé en read-fallback pour les vieux templates). Backend `_collect_zones()` lit les deux ; `_randomize_text_layer` pioche `random.choice(zones)` puis re-roll x_pct/y_pct dedans. Frontend : section "Zone de placement" liste les zones avec n° et taille, bouton "+ ajouter une zone", bouton trash par zone. Drop des inputs X/Y/W/H — l'édition se fait au drag/resize sur le canvas. Dernière zone supprimée → `placement_mode` repasse en "fixed". (4) **Drag du texte clampé aux zones** : nouveaux helpers `pickZone()` et `constrainToZones()` dans `editor-canvas.tsx`. Quand le layer est `text` + `random` + zones non-vide, drag/resize utilise `constrainToZones` au lieu du clamp(0, 100). Le texte ne peut donc pas sortir des zones — il snap à la zone dont le centre est le plus proche du centre proposé. Auto-snap aussi quand on toggle random ON et que le texte est dehors. (5) **TextPool section** : bouton "+ variation" retiré (créait de la confusion avec la zone aléatoire). Le séparateur `---` sur sa propre ligne reste la façon de créer une variation — explicite dans le placeholder de la textarea. **Schema** : `PlacementZoneSchema` + `placement_zones: array` ajoutés. Pas de migration — `JSON` SQLite avale n'importe quel shape. |
| **Phase 10** | mai 2026 | **Text inspector simplifié style Instagram**. Le user trouvait le panneau STYLE trop chargé. Réduit à **6 contrôles seulement** : Police (avec groupes Instagram Reels/PWA/Système comme avant) / Couleur texte (color+hex) / Opacité (slider 0-100%) / Contour (toggle on/off + width + color) / Alignement (3 boutons L/C/R) / Gras+Italique (toggles avec radio dot). **Virés de l'UI** (mais préservés dans le schema avec leur défaut) : Taille (font_size_pct fixe à 5), Letter-spacing, Line-height, Max width, Variante plain/highlight/stroke (le toggle "Contour" remplace stroke ↔ plain ; highlight n'est plus accessible mais legacy templates avec style=highlight rendent toujours). **Nouveau champ schema** : `opacity: number (0-1, default 1)` sur `TextLayerDataSchema`. Appliqué côté canvas (`opacity` CSS sur le container du text-layer) et côté backend : (a) **drawtext** ajoute `@{opacity:.3f}` après chaque `0xRRGGBB` (fontcolor / boxcolor / bordercolor) ; (b) **Pillow renderer** : nouveau helper `_apply_opacity(rgba, opacity)` multiplie l'alpha — appliqué à color/stroke_color/highlight_color, et pour les emojis inline le PNG glyph voit son canal alpha multiplié via `Image.point(lambda a: int(a*opacity))` avant `alpha_composite`. Sections collapsibles via `<details open>` (style + textes pool + zone). `ToggleBtn` helper retiré (plus utilisé). Import `TextStyle` retiré (plus de UI variant picker). **Note design** : le user voulait "comme Instagram" donc plus de control granulaire — la taille du texte est désormais déterminée par défaut (5% canvas height, ~95px sur 1920) et identique pour tous les text layers d'un template (cohérence visuelle). Si un user veut du texte plus gros, il peut éditer `font_size_pct` directement dans le JSON ou on rajoutera un drag-resize-to-fontsize plus tard. |
| **Phase 9** | mai 2026 | **Inspirations Instagram-template app**. Quatre features ajoutées : (1) **Custom Apple emoji picker** : `@emoji-mart/react` + `emoji-mart` virés du package.json (le sprite-renderer affichait des `#` en boucle — glyphe keycap (0,0) que la lib retombe dessus quand son spritesheet jsdelivr foire). Nouveau `emoji-picker.tsx` from scratch : utilise `@emoji-mart/data` (juste le JSON catalogue) + nos URLs PNG individuelles `cdn.jsdelivr.net/.../emoji-datasource-apple/.../{unified}.png` (le même CDN que `lib/apple-emoji.ts` utilise pour le canvas et le rendu backend) → **single source of truth** pour les glyphes. Catégories tab + search + recents en localStorage. (2) **Zone de placement aléatoire** : nouveaux champs `placement_mode: "fixed" | "random"` + `placement_zone: {x_pct, y_pct, width_pct, height_pct}` sur les text layers. Backend `batch_runner._randomize_text_layer` re-roll x_pct/y_pct uniformément dans la zone à chaque appel `gather_render_inputs()` (donc à chaque output reel d'un batch). Frontend section "ZONE DE PLACEMENT" dans le text-inspector avec toggle "Zones aléatoires" + champs numériques de la zone. Nouveau `PlacementZoneOverlay` sur le canvas : rectangle pointillé jaune draggable/resizable (8 handles) qui édite directement `data.placement_zone`. (3) **Pool de variations de texte** : nouveau champ `text_pool: string[]` sur les text layers. Backend pioche random à chaque render. Frontend : section "TEXTES — POOL DE VARIATIONS" remplace la simple textarea — séparateur `---` sur sa propre ligne entre variations, badge "N variations" dans le header. Pas besoin d'autre UI : 0/1 entrée = comportement legacy, ≥2 entrées = pioche random. (4) **Polices Instagram / Meta** : `BUILTIN_FONTS_META` enrichi avec 13 slots groupés en 3 catégories (`system` = Inter/Montserrat, `instagram_pwa` = Optimistic Display/Medium/Variable + IG UI SemiBold/Bold + FB Narrow, `instagram_reels` = Classic/Modern/Typewriter/Strong/Neon). Schéma `FontMeta` étendu avec `group`/`group_label`/`installed`. Picker frontend regroupé via `<SelectGroup>`/`<SelectLabel>`, slots non installés affichés grisés avec mention "non installée". Script `scripts/download_instagram_fonts.py` qui essaie plusieurs mirrors GitHub par slot — fallback gracieux (le picker grise et continue). Doc dans `backend/fonts/README.md`. Note pédagogique : les 5 fonts Reels (Classic/Modern/etc) ne sont pas releasées par Meta, on installe des équivalents Google Fonts free (Bowlby One SC, Plus Jakarta Sans, Special Elite, Bebas Neue, Pacifico) qui matchent le look à ~85% au caption-scale. **Règle TS strict re-violée temporairement** : j'avais mis `.default()` sur `FontMetaSchema` (group/group_label/installed) → cast la field en optional dans `z.infer` → cassait le typing du store. Corrigé en repassant tout en required côté schema. Confirmé une fois de plus : pas de `.default()` sur les schémas API response. |
| **Phase 8** | mai 2026 | **Bulk photo EXIF spoofing.** Nouvelle page `/photos` (sidebar entry "Photos", icône Camera) qui fonctionne sur le même principe que le wizard vidéo : drop N images (JPG/PNG/HEIC/TIFF/WebP, max 200) + choix model iPhone / pays / langue / fenêtre date, click "Spoofer N photos" → ZIP téléchargé direct. **Sync** côté backend (exiftool prend ~30 ms par fichier, donc 50 photos = ~2s). Aucune persistance DB — uploads en `tempfile.mkdtemp()`, ZIP construit en `BytesIO`, temp dir nettoyé après. **Tirage indépendant par photo** : DateTimeOriginal random dans la fenêtre, GPS jiggle ±0.005° autour de la ville random, lens random pick parmi celles du modèle (24/13/120 mm pour Pro, 26/13 pour non-Pro), ISO/ExposureTime/FNumber dans des plages réalistes par modèle (ProRAW ISO 24-3200, sub-shutter 1/30s à 1/1000s), tous les autres tags iPhone-like (WhiteBalance Auto, MeteringMode MultiSegment, ExposureMode Auto, Flash Off, ColorSpace sRGB, GPSImgDirection random, etc.). 75 tags exiftool écrits par photo. Filesystem mtime aligné avec DateTimeOriginal. Modules : `backend/app/render/photo_metadata.py` (75 tags par photo), `backend/app/render/iphone_lenses.json` (specs lenses + ISO/shutter ranges par modèle iPhone 16/16+/16 Pro/16 Pro Max/17/17 Pro/17 Pro Max), `backend/app/api/photos.py` (POST `/api/photos/spoof` multipart → StreamingResponse ZIP avec headers `X-Spoofed-Count` / `X-Skipped-Count`). Frontend `Photos.spoof(files, profile, onProgress)` dans `lib/api.ts` (XHR pour avoir le upload progress et un `responseType: blob`), page `frontend/src/app/(app)/photos/page.tsx` avec drop zone, grille de previews (URL.createObjectURL), select profile (réutilise les mêmes constantes `MODELS`/`COUNTRIES`/`LANGUAGES` que le wizard vidéo), progress bar pendant upload, bloc résultat avec re-download du ZIP. HEIC preview ne marche pas en Chrome (placeholder icon affiché si `<img>` foire), mais le fichier est bien uploadé/spoofé quand même. |
| **Phase 7** | mai 2026 | **Pivot local-only — drop Railway, Postgres, Redis, Celery, Docker, auth, Alembic.** Le bot tourne sur la machine perso, pas dans le cloud. Changements : (a) **DB → SQLite** : `data/botmontage.db`, WAL mode, schema créé via `Base.metadata.create_all()` au lifespan, plus d'Alembic. Models : `User` retiré, `JSONB` → `JSON` (cross-DB), `server_default` SQL retiré (Python defaults). (b) **Worker → ThreadPoolExecutor** in-process : `app/worker.py` avec `start_worker/stop_worker/queue_render_job`. `app/tasks/render.py` redevient une fonction pure appelée par le pool. `app/celery_app.py` supprimé. Concurrency par défaut = 1 (configurable via `RENDER_WORKERS=N`). (c) **Auth virée** : suppression de `app/auth/`, `app/middleware.py`, `frontend/src/middleware.ts`, `frontend/src/app/login/`, logout button du header, dep `jose`. Tout `/api/*` est ouvert. (d) **Storage** : `DATA_DIR` lu depuis `settings.data_dir` (default = `<repo>/data/`), plus de `/data` hardcodé. `storage.BUILTIN_FONT_SOURCES` cherche en priorité dans `backend/fonts/` (gitignored) puis dans les fonts système (Linux/macOS/Windows). (e) **Fichiers retirés** : `railway.toml`, `docker-compose.yml`, `.env.example`, `backend/Dockerfile`, `frontend/Dockerfile`, `backend/alembic/`, `backend/alembic.ini`, `backend/app/auth/`, `backend/app/middleware.py`, `backend/app/celery_app.py`, `frontend/src/middleware.ts`, `frontend/src/app/login/`. (f) **Deps cleanup** : `requirements.txt` ne contient plus `psycopg2-binary`, `redis`, `celery`, `bcrypt`, `PyJWT`, `alembic`. `package.json` ne contient plus `jose`. (g) **Config simplifiée** : `Settings` n'a plus que `data_dir`, `cors_origins`, `render_workers`. Plus de `JWT_SECRET`, `BACKEND_PASSWORD`, `DATABASE_URL`, `CELERY_*`. (h) **README réécrit** pour install local Windows/macOS/Linux. |
| **Phase 6** | mai 2026 | **Apple emojis dans le rendu ffmpeg final** (parité avec le canvas preview). Avant : `drawtext` n'a qu'une font, retombait sur tofu "NO GLYPH" pour tout codepoint emoji absent d'Inter/Montserrat. Maintenant : quand un layer texte contient un caractère `\p{Extended_Pictographic}`, on le pré-rend via **Pillow** dans un PNG transparent canvas-sized (1080×1920) puis on `overlay` ce PNG au lieu de drawtext. Les glyphes emoji viennent du pack **emoji-datasource-apple@15.1.2** (PNG 64×64) téléchargé **lazy au premier usage** depuis le CDN jsdelivr et caché dans `/data/apple_emojis/{unified}.png` — seulement les emojis effectivement utilisés sont fetchés. Texte plain (sans emoji) reste sur drawtext (rapide). Nouveaux modules : `backend/app/render/emoji_pack.py` (lazy CDN fetch + cache + fallback FE0F-stripping pour matcher le naming finicky du dataset), `backend/app/render/text_renderer.py` (tokenizer mots/spaces/emojis via `regex \X` graphème, line-fill avec wrap, layout center vertical dans la layer bbox, alignement gauche/centre/droite, support styles plain/highlight/stroke, letter-spacing rendu glyph-by-glyph). `pipeline.build_render_command` accepte `text_png_inputs: dict[layer_id → Path]` qui shortcut le drawtext en faveur d'un overlay@(0,0). `batch_runner.run_render` génère les PNGs avant le ffmpeg via `_render_text_pngs` avec dedupe par hash de contenu (`cache_key_for_layer`) — mêmes captions à travers un batch ne rendent qu'une fois. Deps ajoutées : `Pillow==11.0.0`, `regex==2024.11.6`. Pillow ships des wheels manylinux donc pas de package apt à ajouter au Dockerfile. Limitations connues : (1) bold/italic toggles toujours ignorés au render — le user doit picker une font déjà bold (pareil que drawtext, comportement préservé) ; (2) emoji 64px upscalé en LANCZOS si le user met un font_size_pct énorme — caption usuelles OK. |
| **Phase 5** | mai 2026 | (a) **Wizard 3 étapes `/render/new`** : Step 1 Upload (drop multi-fichiers MP4/MOV avec progress bars), Step 2 Templates (3 modes — `all` = N×M reels, `random` = N reels distribués, `per_video` = 1 template manuel par vidéo) + filtre langue FR/US/All, Step 3 Confirm (job name, spoofing toggle, récap reels). Stepper visuel en haut. Construit `assignments[]` selon le mode et POST `/api/render/batch`. Pour les modes `all` et `random`, le même token vidéo remplit TOUS les placeholders du template (les templates avec ≥1 placeholder seulement sont éligibles). Lien dashboard "Lancer un render" → `/render/new` (l'ancien picker dialog est retiré). Sidebar : nouvelle entrée "Nouveau render" (icône `Rocket`). RunRenderDialog par-card sur `/templates` reste, c'est le flow single-template. (b) **Apple emojis** : `@emoji-mart/data` + `@emoji-mart/react` + `emoji-mart` ajoutés. `frontend/.npmrc` avec `legacy-peer-deps=true` (peer-dep emoji-mart liste seulement React 16/17/18 — fonctionne fine sur 19). `lib/apple-emoji.ts` : map natif → unified codepoints construite depuis le dataset emoji-mart au load + fallback codepoint manuel ; `parseTextWithEmojis(text)` segmente via `Intl.Segmenter` (granularity grapheme) + détection `\p{Extended_Pictographic}`. URLs CDN : `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/{unified}.png`. `emoji-picker.tsx` réécrit comme wrapper dynamic-imported autour du Picker emoji-mart (`set="apple"`, `theme="dark"`, `locale="fr"`). `text-layer.tsx` : composant interne `<RenderedText>` injecte des `<img>` 1em pour chaque grapheme emoji, applique sur les 3 styles (plain/highlight/stroke) — limite : émojis dans style `stroke` n'ont pas d'outline parce que `text-shadow` n'affecte pas les images. Note importante : seul le **canvas preview** affiche Apple ; le rendu ffmpeg backend continue d'utiliser NotoColorEmoji. |

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

## 13. Rapport UX agent (post-Phase 4)

L'agent UX a produit un rapport complet (à appliquer dans une phase future). Résumé des points clés :

**Top 5 problèmes prioritaires** :
1. **Timeline trop colorée** : clips bleus + placeholders jaunes + scrubber bleu + lanes colorées → tout crie. Fix : passer les clips fixes en neutre (`bg-zinc-800` avec thumbnail dominante), bleu UNIQUEMENT pour la sélection. Scrubber rouge (`#FF3B30` style FCP). Palette LAYER_COLORS désaturée.
2. **RunRenderDialog trop jaune** : box jaune sur 60% du dialog = warning anxiogène. Fix : carte neutre `border-l-4 border-yellow-500` + badge `📷 #1`.
3. **Inspector éditeur = long formulaire** : 14 contrôles à la suite sans groupement. Fix : sections collapsibles `<details>` (Contenu / Style / Position+Timing) avec localStorage pour l'état.
4. **Bouton Save topbar redondant** (autosave existe). + Sidebar gauche éditeur peu utile. Fix : virer Save, indicateur ✓/spinner discret. Sidebar : virer ou la transformer en panel d'assets.
5. **Grille templates uniforme** : 4 col, "Lance un render" violet répété N fois = bruit. Fix : déplacer le bouton dans un kebab menu hover, ajouter micro-badges info (`📷 ×3 placeholders`, `⏱ 12s`), passer à 3 col plus aérées.

**Polish (15 items)** :
- Sidebar app 200px → 64px collapsed icon-only OR 180px
- Stat cards dashboard en vraies tuiles type Linear
- Empty states avec illustration SVG
- Extract `<StatusBadge>` avec pulse animation
- Réduire échelle typo à 4 tailles strictes
- Hover shadow sur clips
- Icône grip sur trim handles
- Color picker en swatch grid
- Switch shadcn pour spoofing toggle
- Action bar grouped avec `bg-background/50` par groupe
- Microcopy : "Aperçu rendu" → "Prévisualiser"
- Toast feedback sur upload success/error
- etc.

**Pistes ambitieuses** :
- Dashboard "Studio" (hero CTA central → picker template, feed reels done)
- Inspector contextual flottant ancré (style Figma)
- Raccourcis clavier (Space play, Suppr, Cmd+S, F fullscreen)

**Direction artistique** :
- Palette dark "studio" plus chaude
  - `--background: #0E0E12`
  - `--card: #18181C`
  - `--primary: #FA7A2C` (orange Reels identitaire)
  - `--scrubber: #F03434` (rouge FCP)
  - `--placeholder: #F5C037` (jaune chaud)
  - `--accent-info: #2F7AF5` (bleu sélection)
- Typo : Inter via `next/font/google`, JetBrains Mono ou `tnum` pour timecodes
- Densité : pages aérées (`gap-8`), éditeur dense (`text-[11px]`, `h-7`)
- Inspirations : CapCut Web, Descript, Linear, Figma Properties Panel, Instagram Edits

**Plan d'application** : rapport gardé pour une **Phase 5 (Polish UX)** dédiée. Fichier le rapport complet dans la mémoire conversationnelle ou copier dans un `UX_REPORT.md` si nécessaire.

---

## 14. Conventions de code

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

## 15. Comment update ce fichier

Quand un changement notable a lieu :
1. Update la section pertinente (Data model, API surface, Pipeline, etc.)
2. Update le tableau "Historique des phases" avec une nouvelle ligne
3. Update "Last updated" en haut
4. Update "Next planned" en haut si différent
5. Si nouveau fichier important : update le file tree section 4
6. Si nouvelle leçon Railway/déploiement : update section 10

**Critère** : si je perds le contexte et que je relis ce doc, est-ce que je comprends l'état actuel + le prochain pas ?
