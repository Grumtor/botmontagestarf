"""Photo metadata spoofing API.

Mode unique : **Flat** — chaque photo uploade est dupliquée et son EXIF
re-écrit avec un profil iPhone aléatoire. Sortie en ZIP plat (ou
sous-dossiers `Generation N/` si `generations > 1`).

`models[]` est un multi-value form field (une entrée par modèle iPhone).
Chaque photo pioche un modèle au hasard dans la liste.

Phase 32 — la feature "Virtual Assistants" (sous-dossiers
`{VA}/Compte N/`) a été retirée intégralement. Le mode flat reste le
seul exposé.
"""

from __future__ import annotations

import logging
import random
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse

from app.db.models import User
from app.render.photo_metadata import apply_photo_metadata
from app.users import require_user

router = APIRouter(prefix="/api/photos", tags=["photos"])

ALLOWED_EXTS = {
    ".jpg", ".jpeg", ".jpe",
    ".png",
    ".heic", ".heif",
    ".tif", ".tiff",
    ".webp",
}
MAX_FILES = 200
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB per file
MAX_OUTPUTS = 5000

log = logging.getLogger(__name__)


@router.post("/spoof")
async def spoof_photos(
    files: list[UploadFile] = File(...),
    # Multi-value: at least one model. Chaque photo pioche au hasard.
    models: list[str] = Form(...),
    country: str = Form("USA"),
    language: Optional[str] = Form(None),
    date_window_days: int = Form(7),
    # Phase 29 — multiplicateur "Générations" : duplique la sortie N fois
    # avec un tirage de métadonnées indépendant à chaque pass. Use case :
    # 2× les mêmes photos mais avec des EXIF différents pour 2 comptes.
    generations: int = Form(1, ge=1, le=10),
    # Phase 29 — naming style. "iphone" → IMG_xxxx.{EXT} avec compteur
    # continu en démarrage random (1500-9000), "default" → garde les
    # noms originaux.
    naming: str = Form("iphone"),
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
    # Phase 39 sécurité — endpoint ouvert au monde sans auth jusqu'ici
    # (data leak + spoof anonyme illimité). Désormais require_user :
    # cookie session valide obligatoire, sinon 401. NB : pas de débit
    # crédits ici pour l'instant (à ajouter dans une 2e passe).
    user: User = Depends(require_user),
):
    if not files:
        raise HTTPException(400, "No files provided")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Max {MAX_FILES} photos par batch")
    models = [m.strip() for m in models if m and m.strip()]
    if not models:
        raise HTTPException(400, "Au moins un modèle iPhone requis")

    # Sanity-check the total output count up-front.
    expected_outputs = len(files) * generations
    if expected_outputs > MAX_OUTPUTS:
        raise HTTPException(
            400,
            f"Trop d'outputs : {expected_outputs} photos. Max {MAX_OUTPUTS}.",
        )

    work_dir = Path(tempfile.mkdtemp(prefix="photo_spoof_"))
    sources_dir = work_dir / "_sources"
    sources_dir.mkdir(parents=True)
    spoofed_count = 0
    errors: list[dict] = []

    try:
        # 1. Save every uploaded file once into _sources/. We then COPY from
        # there into each destination — much faster than re-reading the
        # upload stream multiple times.
        sources: list[tuple[Path, str]] = []  # (path, ext)
        for upload in files:
            ext = Path(upload.filename or "").suffix.lower()
            if ext not in ALLOWED_EXTS:
                errors.append({"file": upload.filename, "error": f"unsupported ext {ext}"})
                continue
            target = sources_dir / _safe_name(upload.filename or f"photo{ext}")
            size = 0
            with target.open("wb") as out:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_FILE_BYTES:
                        out.close()
                        target.unlink(missing_ok=True)
                        errors.append({
                            "file": upload.filename,
                            "error": f"too big (>{MAX_FILE_BYTES // (1024 * 1024)} MB)",
                        })
                        break
                    out.write(chunk)
            if target.is_file():
                sources.append((target, ext))

        if not sources:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(
                400, f"No photos could be processed. Errors: {errors[:10]}"
            )

        # 2. Build outputs (flat mode only).
        out_root = work_dir / "_out"
        out_root.mkdir()

        for gen in range(generations):
            # `gen_subdir` = préfixe pour cette génération.
            # Vide quand generations=1 (tout à la racine).
            gen_subdir = f"Generation {gen + 1}" if generations > 1 else ""
            target_dir = out_root / gen_subdir if gen_subdir else out_root
            target_dir.mkdir(parents=True, exist_ok=True)

            for src, ext in sources:
                model = random.choice(models)
                profile = {
                    "model": model,
                    "country": country,
                    "language": language,
                    "date_window_days": date_window_days,
                }
                stem = Path(_safe_name(src.name)).stem
                dst = target_dir / f"{stem}{ext}"
                try:
                    shutil.copy(src, dst)
                except Exception as e:
                    log.warning("copy %s -> %s failed: %s", src, dst, e)
                    errors.append({"file": src.name, "error": f"copy: {e}"[:200]})
                    continue
                try:
                    apply_photo_metadata(dst, profile)
                    spoofed_count += 1
                except Exception as e:
                    log.exception("spoof failed for %s: %s", dst, e)
                    errors.append({"file": src.name, "error": str(e)[:200]})
                    dst.unlink(missing_ok=True)

        if spoofed_count == 0:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(
                400, f"No photos could be processed. Errors: {errors[:10]}"
            )

        # 3. ZIP the output dir on disk (NOT in memory — for large jobs the
        # in-memory ZIP can easily reach multiple GB and OOM the worker).
        zip_name = "photos_spoofed.zip"
        zip_path = work_dir / "_export.zip"

        # Phase 29 — naming Apple-style si demandé. Compteur continu sur
        # tout le ZIP avec démarrage random pour bluffer Insta.
        if naming == "iphone":
            counter = random.randint(1500, 9000)
            files_to_zip = sorted(
                (p for p in out_root.rglob("*") if p.is_file()),
                key=lambda p: p.relative_to(out_root).as_posix(),
            )
            with zipfile.ZipFile(
                zip_path, "w", zipfile.ZIP_STORED, allowZip64=True
            ) as zf:
                for p in files_to_zip:
                    rel = p.relative_to(out_root)
                    parent = rel.parent.as_posix()
                    ext = p.suffix.upper()
                    new_name = f"IMG_{counter:04d}{ext}"
                    counter += 1
                    arc = (
                        f"{parent}/{new_name}" if parent != "." else new_name
                    )
                    zf.write(p, arcname=arc)
        else:
            with zipfile.ZipFile(
                zip_path, "w", zipfile.ZIP_STORED, allowZip64=True
            ) as zf:
                for p in out_root.rglob("*"):
                    if p.is_file():
                        zf.write(p, arcname=p.relative_to(out_root).as_posix())

        # Cleanup must run AFTER the response body has been sent.
        if background_tasks is not None:
            background_tasks.add_task(shutil.rmtree, work_dir, ignore_errors=True)

        headers = {
            "Content-Disposition": f'attachment; filename="{zip_name}"',
            "X-Spoofed-Count": str(spoofed_count),
            "X-Skipped-Count": str(len(errors)),
        }
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=zip_name,
            headers=headers,
        )

    except HTTPException:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    except Exception as e:
        log.exception("photo spoof crashed: %s", e)
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(
            500,
            f"Erreur pendant le spoofing : {e.__class__.__name__}: {str(e)[:300]}",
        ) from e


def _safe_name(name: str) -> str:
    name = Path(name).name
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe or "photo.jpg"
