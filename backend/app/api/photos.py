"""Photo metadata spoofing API.

Two output modes from a single endpoint:

  1. **Flat** (default — no `va_id` provided)
     Each input photo gets its EXIF rewritten with a random tirage and the
     ZIP contains the photos in a single flat layout.

  2. **VA / Comptes** (provide `va_id` + optional `filename_base`)
     Duplicates every input photo into N folders, one per account of the
     chosen Virtual Assistant. Per-account a single iPhone model is
     picked uniformly from `models[]` (so all photos of one account look
     like the same phone). Each photo still gets its own random
     date/GPS/lens/ISO. Output ZIP layout:
         {va.name}/Compte 1/{filename_base}_1.jpg
         {va.name}/Compte 1/{filename_base}_2.jpg
         …
         {va.name}/Compte 15/{filename_base}_5.jpg

`models[]` is a multi-value form field (one entry per iPhone model). For
the flat mode each photo independently picks a random model from the
list. For the VA mode the model is locked at the account level (1
account = 1 phone, more credible).
"""

from __future__ import annotations

import logging
import random
import re
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
from sqlalchemy.orm import Session

from app.db import get_db
from app.db.models import VirtualAssistant
from app.render.exiftool_batch import BatchExifTool
from app.render.photo_metadata import apply_photo_metadata

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
MAX_OUTPUTS = 5000  # safety cap on N_photos × N_accounts

log = logging.getLogger(__name__)


@router.post("/spoof")
async def spoof_photos(
    files: list[UploadFile] = File(...),
    # Multi-value: at least one model. Flat mode → random pick per photo.
    # VA mode → random pick per account.
    models: list[str] = Form(...),
    country: str = Form("USA"),
    language: Optional[str] = Form(None),
    date_window_days: int = Form(7),
    # When set, structures the ZIP into {va.name}/Compte N/ folders. One or
    # more VAs supported — each VA is treated independently (option A from
    # the spec): the source photos are duplicated/distributed for *each*
    # selected VA. So selecting [VA1, VA2] doubles the work but yields
    # `VA1/Compte N/…` AND `VA2/Compte N/…` in the same ZIP.
    va_ids: list[int] = Form([]),
    # Custom filename base for VA exports — files become
    # `{filename_base}_{idx}.{ext}`. Defaults to "photo".
    filename_base: Optional[str] = Form(None),
    # ---- VA distribution mode (Phase 14) ----
    # "broadcast" (default): every photo lands in every account folder.
    #     N photos × M accounts = N×M outputs.
    # "one_per_account": exactly 1 unique photo per account folder.
    #     N == M: random shuffle; N > M: random pick M; N < M: error
    #     unless `allow_loop=True` in which case we cycle.
    distribution: str = Form("broadcast"),
    allow_loop: bool = Form(False),
    # Phase 29 — multiplicateur "Générations" : duplique la sortie N fois
    # avec à chaque fois un tirage de métadonnées indépendant. Use case :
    # tu veux 2× les mêmes reels mais avec des EXIF différents pour
    # poster sur 2 comptes sans que Insta voie 2 fichiers identiques.
    generations: int = Form(1, ge=1, le=10),
    # Phase 29 — naming style. "iphone" → IMG_xxxx.{EXT} avec compteur
    # continu en démarrage random (1500-9000), "default" → garde les
    # noms originaux / generated par la logique VA.
    naming: str = Form("iphone"),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
):
    if not files:
        raise HTTPException(400, "No files provided")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Max {MAX_FILES} photos par batch")
    models = [m.strip() for m in models if m and m.strip()]
    if not models:
        raise HTTPException(400, "Au moins un modèle iPhone requis")

    # Resolve the VA list (deduped, preserving the user-provided order).
    vas: list[VirtualAssistant] = []
    seen_ids: set[int] = set()
    for vid in va_ids:
        if vid in seen_ids:
            continue
        seen_ids.add(vid)
        va = db.get(VirtualAssistant, vid)
        if va is None:
            raise HTTPException(404, f"VA #{vid} non trouvé")
        vas.append(va)

    # Sanity-check the total output count up-front so we don't waste time.
    # Phase 29 : multiplie par `generations` (chaque génération produit
    # un set complet d'outputs avec metadata indépendante).
    if not vas:
        expected_outputs = len(files) * generations
    elif distribution == "one_per_account":
        expected_outputs = sum(va.account_count for va in vas) * generations
    else:
        expected_outputs = (
            len(files) * sum(va.account_count for va in vas) * generations
        )
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
        # there into each (account, photo_idx) destination — much faster
        # than re-reading the upload stream multiple times.
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

        # 2. Build outputs.
        base_name = _slug(filename_base or "photo")
        out_root = work_dir / "_out"
        out_root.mkdir()

        # NOTE Phase 16: BatchExifTool was added to speed things up via
        # `-stay_open True`, but it was hanging on Windows (stdout
        # buffering quirks make readline() block forever). Reverted to
        # one-shot subprocess.run per photo. Slower (~250 ms/photo
        # startup) but reliable. To re-enable later: wrap the loop body
        # in `with BatchExifTool() as bt:` and pass `batch_tool=bt` to
        # apply_photo_metadata.
        # Phase 29 — wrap dans une boucle générations. À chaque tour on
        # produit un set complet (broadcast/one_per_account/flat) avec
        # un tirage de métadonnées indépendant. Quand generations > 1,
        # chaque génération va dans un sous-dossier `Generation N/` —
        # ça permet à l'user de poster jour 1 avec Gen 1, jour 2 avec
        # Gen 2 etc, métadonnées différentes par jour pour un même
        # contenu visuel.
        for gen in range(generations):
          # `gen_subdir` est le préfixe de chemin pour cette génération.
          # Vide quand generations=1 (legacy : tout à la racine).
          gen_subdir = f"Generation {gen + 1}" if generations > 1 else ""
          if not vas:
            # Flat mode — every photo gets a random model from `models[]`.
            for i, (src, ext) in enumerate(sources):
                model = random.choice(models)
                profile = {
                    "model": model,
                    "country": country,
                    "language": language,
                    "date_window_days": date_window_days,
                }
                stem = Path(_safe_name(src.name)).stem
                dst_name = f"{stem}{ext}"
                target_dir = out_root / gen_subdir if gen_subdir else out_root
                target_dir.mkdir(parents=True, exist_ok=True)
                dst = target_dir / dst_name
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
          else:
            # Multi-VA mode (option A — each VA is independent).
            # Per VA: one model per account, hierarchical layout.
            n_photos = len(sources)

            # First validation pass: in one_per_account mode, every VA
            # whose account_count > N requires allow_loop. We fail fast
            # before touching disk.
            if distribution == "one_per_account":
                offenders = [
                    va for va in vas if va.account_count > n_photos and not allow_loop
                ]
                if offenders:
                    names = ", ".join(f"{va.name} ({va.account_count})" for va in offenders)
                    raise HTTPException(
                        400,
                        f"Mode '1 par compte' : tu as {n_photos} photo(s) mais "
                        f"ces VA(s) ont plus de comptes — {names}. Coche "
                        f"« OK même si moins de photos que de comptes » "
                        f"pour boucler le pool, ou upload plus de photos.",
                    )

            for va in vas:
                # When generations > 1, insert a `Generation N` level
                # between VA and Compte so the user can pick the right
                # batch when posting on different days.
                va_dir = out_root / _slug(va.name)
                gen_dir = va_dir / gen_subdir if gen_subdir else va_dir
                n_accounts = va.account_count

                # Resolve photo→account plan for THIS VA. Re-rolled per
                # generation pour que chaque pass produise une distrib
                # différente (random sample / shuffle).
                if distribution == "one_per_account":
                    if n_photos >= n_accounts:
                        # Random sample without replacement.
                        pool = random.sample(sources, n_accounts)
                        plan = [[pool[i]] for i in range(n_accounts)]
                    else:
                        # n_photos < n_accounts and allow_loop=True → cycle.
                        shuffled = random.sample(sources, n_photos)
                        plan = [[shuffled[i % n_photos]] for i in range(n_accounts)]
                else:
                    # Broadcast: every account gets every photo (same
                    # bytes, but exiftool will write independent metadata
                    # to each copy below).
                    plan = [list(sources) for _ in range(n_accounts)]

                for compte_idx, photo_list in enumerate(plan):
                    model = random.choice(models)
                    compte_dir = gen_dir / f"Compte {compte_idx + 1}"
                    compte_dir.mkdir(parents=True, exist_ok=True)
                    for photo_idx, (src, ext) in enumerate(photo_list):
                        profile = {
                            "model": model,
                            "country": country,
                            "language": language,
                            "date_window_days": date_window_days,
                        }
                        if distribution == "one_per_account":
                            dst_name = f"{base_name}{ext}"
                        else:
                            dst_name = f"{base_name}_{photo_idx + 1}{ext}"
                        dst = compte_dir / dst_name
                        try:
                            shutil.copy(src, dst)
                        except Exception as e:
                            log.warning("copy %s -> %s failed: %s", src, dst, e)
                            errors.append({"file": dst.name, "error": f"copy: {e}"[:200]})
                            continue
                        try:
                            apply_photo_metadata(dst, profile)
                            spoofed_count += 1
                        except Exception as e:
                            log.exception("spoof failed for %s: %s", dst, e)
                            errors.append({"file": dst.name, "error": str(e)[:200]})
                            dst.unlink(missing_ok=True)

        if spoofed_count == 0:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(
                400, f"No photos could be processed. Errors: {errors[:10]}"
            )

        # 3. ZIP the output dir on disk (NOT in memory — for large jobs the
        # in-memory ZIP can easily reach multiple GB and OOM the worker).
        # We then return a FileResponse and clean up via BackgroundTasks
        # AFTER the response has been streamed.
        if not vas:
            zip_name = "photos_spoofed.zip"
        elif len(vas) == 1:
            zip_name = f"{_slug(vas[0].name)}_{base_name}.zip"
        else:
            zip_name = f"export_{len(vas)}_VAs_{base_name}.zip"

        zip_path = work_dir / "_export.zip"
        # Phase 29 — naming Apple-style si demandé. Compteur continu sur
        # tout le ZIP avec démarrage random (1500-9000) pour bluffer
        # Insta : pas de IMG_0001.JPG qui crie "fake".
        # Photos → IMG_xxxx.{EXT_UPPER} (.JPG, .HEIC, .PNG, .WEBP)
        if naming == "iphone":
            counter = random.randint(1500, 9000)
            # Order files deterministically (rglob isn't sorted) so the
            # counter sequence is stable: VA dirs first, accounts in
            # numeric order, photos alphabetical.
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

        # Cleanup must run AFTER the response body has been sent; if we did
        # it in `finally` here the file would be removed before FastAPI
        # finished streaming. BackgroundTasks fires after send.
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
        # Already-formatted error — clean up and bubble up unchanged.
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    except Exception as e:
        # Unexpected failure (OOM, disk full, exiftool absent, ...).
        # Without this handler the user sees a bare "Internal Server
        # Error"; we surface a useful message instead.
        log.exception("photo spoof crashed: %s", e)
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(
            500,
            f"Erreur pendant le spoofing : {e.__class__.__name__}: {str(e)[:300]}",
        ) from e


def _safe_name(name: str) -> str:
    name = Path(name).name
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe[:120] or "photo.jpg"


def _slug(name: str) -> str:
    """Filesystem-safe slug for filename_base / VA name. Allows letters,
    digits, underscore, dash, space; collapses everything else."""
    s = re.sub(r"[^a-zA-Z0-9_\- ]+", "_", name).strip("_ ")
    return (s or "photo")[:80]
