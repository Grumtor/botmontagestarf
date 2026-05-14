# bot-montage

Outil perso pour générer des reels Instagram en batch à partir de templates de montage avec des "trous" (placeholders) qu'on remplit avec ses propres vidéos au moment du rendu.

**Local-only.** Pas de cloud, pas de Docker, pas de DB serveur. Un fichier SQLite, ffmpeg sur ta machine, deux terminaux.

## Concept

1. Construis un **template** dans l'éditeur style Instagram Edits / CapCut : timeline de clips (vidéos fixes ou images uploadées avec le template), placeholders (trous pour les vidéos qu'on insèrera plus tard), texte / GIFs / emojis Apple en overlay, musique optionnelle.
2. Lance un **batch render** depuis le wizard `/render/new` : drop N vidéos, choisis tes templates → le bot génère N reels (chacun = template avec une vidéo dans chaque trou).
3. Optionnel : **spoofing métadonnées iPhone** (QuickTime branding + GPS USA + date random + iPhone 17 Pro etc.) pour que les vidéos passent pour des captures iPhone.

## Stack

- **Frontend** : Next.js 15 (App Router) + TypeScript + Tailwind v3 + shadcn/ui + Zustand + zod + emoji-mart (set Apple)
- **Backend** : Python 3.11 + FastAPI + SQLAlchemy 2 + Pydantic v2 + Pillow (rendu texte+emoji)
- **DB** : SQLite (un fichier sous `data/botmontage.db`, créé au boot)
- **Worker** : `ThreadPoolExecutor` in-process (pas de Celery / Redis)
- **Media** : ffmpeg + ffprobe + exiftool + AtomicParsley + mutagen
- **Apple emojis** : pack `emoji-datasource-apple` téléchargé lazy depuis jsdelivr, caché localement

## Pré-requis machine

Tu dois avoir installé sur ta machine :

- **Python 3.11+** (`python --version`)
- **Node 20+** (`node --version`)
- **ffmpeg** + **ffprobe** dans le PATH (`ffmpeg -version`)
- **exiftool** (`exiftool -ver`) — pour le spoofing métadonnées
- **AtomicParsley** (`AtomicParsley --help`) — pour le ftyp QuickTime patch

### Install des outils média

**Windows (Scoop)**

```powershell
scoop install ffmpeg exiftool atomicparsley
```

**macOS (Homebrew)**

```bash
brew install ffmpeg exiftool atomicparsley
```

**Linux (Debian/Ubuntu)**

```bash
sudo apt install ffmpeg libimage-exiftool-perl atomicparsley
```

### Polices (optionnel)

Inter et Montserrat sont les deux polices "built-in" de l'app. Si elles ne sont pas dans tes fonts système, drop les fichiers TTF/OTF dans `backend/fonts/` :

```
backend/fonts/Inter-Regular.ttf
backend/fonts/Montserrat-Regular.ttf
```

(Téléchargeables depuis Google Fonts.) Sans, l'app marche quand même, mais les deux choix par défaut du picker de polices dans l'éditeur ne s'afficheront pas correctement — tu peux toujours upload tes propres TTF via l'UI.

## Lancer le bot

Premier coup :

```bash
# Terminal 1 — backend
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows PowerShell : .\.venv\Scripts\Activate.ps1
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Puis ouvre [http://localhost:3000](http://localhost:3000).

Pas de mot de passe, pas de login — c'est local-only.

## Données

Tout est dans `<repo>/data/` (gitignored) :

```
data/
├── botmontage.db                ← SQLite (templates, jobs, fonts metadata)
├── _placeholder_preview.mp4     ← 30s noir 1080x1920 généré au boot
├── assets/fonts/                ← polices built-in + uploads
├── templates/{id}/clips|overlays|preview.mp4|thumb.jpg
├── temp/{token}.{ext}           ← uploads vidéo en attente d'un render
├── apple_emojis/{unified}.png   ← cache des PNG Apple téléchargés à la volée
└── renders/{job_id}/...mp4      ← outputs des batches
```

Pour reset complet : `rm -rf data/` et relance le backend.

## Pages

- `/` — Dashboard (stats + 8 derniers jobs + bouton "Lancer un render")
- `/render/new` — Wizard 3 étapes (Upload → Templates → Confirm)
- `/templates` — grille des templates avec play overlay → preview vidéo, bouton "Lance un render" par card
- `/editor/{id}` — éditeur clip-based plein écran (timeline + canvas + inspector)
- `/jobs` — liste des render jobs avec polling 2s
- `/jobs/{id}` — détail + downloads par fichier + ZIP global

## Modèle de données

Voir `CLAUDE_CONTEXT.md` section 5 pour le détail. En résumé :

- **Template** : `clips: Clip[]` + `layers: Layer[]` + `audio_overlay`
  - **Clip** ∈ `fixed` (vidéo uploadée), `image` (image fixe uploadée, durée custom), `placeholder` (trou rempli au render)
  - **Layer** ∈ `text` / `image` overlay / `gif` / `emoji` (overlays au-dessus de la vidéo)
- **Asset** : table conservée mais utilisée uniquement pour les fonts persistantes
- **RenderJob** : `assignments: [{template_id, fills: {clip_id: token}}, ...]` + `metadata_profile`

## Contexte technique complet

Voir `CLAUDE_CONTEXT.md` — document interne pour reprendre le projet sans contexte préalable.
