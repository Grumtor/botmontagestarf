"""Persistent exiftool process for batch metadata writes.

exiftool's `-stay_open True -@ -` mode keeps a single process alive that
reads commands from stdin. We write the same arguments we'd pass to a
one-shot subprocess, terminated by `-execute\\n`, and read stdout until
we see the `{ready}\\n` sentinel. Each call thus costs ~30 ms (tag write
to disk) instead of ~300 ms (Windows process startup + Python subprocess
overhead + AV scan).

For a 1300-output batch on Windows that's ~40 s vs ~20 min — same code,
~30x speedup.

Usage:
    with BatchExifTool() as bt:
        for path, profile in jobs:
            args = build_exiftool_args(path, profile)
            ok, stderr = bt.run(args[1:])  # skip the exe itself
"""

from __future__ import annotations

import logging
import subprocess
import threading
from typing import Optional

from app.bin_finder import exiftool_exe

log = logging.getLogger(__name__)


class BatchExifTool:
    """Single long-lived exiftool subprocess. Thread-safe (lock-protected)
    so multiple workers in the same render can share one tool process —
    not strictly needed today (we process serially) but cheap insurance."""

    def __init__(self, exe: Optional[str] = None) -> None:
        self.exe = exe or exiftool_exe()
        self.proc: Optional[subprocess.Popen[str]] = None
        self.lock = threading.Lock()

    def __enter__(self) -> "BatchExifTool":
        try:
            self.proc = subprocess.Popen(
                [
                    self.exe,
                    "-stay_open", "True",
                    "-@", "-",
                    "-common_args",
                    "-overwrite_original",
                    "-q",
                    "-q",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # line-buffered
                encoding="utf-8",
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "exiftool n'est pas installé ou pas dans le PATH. "
                "Installe-le : Windows `scoop install exiftool` · "
                "macOS `brew install exiftool` · "
                "Linux `apt install libimage-exiftool-perl`"
            ) from exc
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        # Cleanup is BEST-EFFORT. Anything raised here would otherwise
        # propagate out of the `with` block and crash the request even
        # though the actual work (spoofing photos) is already done. So
        # we eat every possible error.
        proc = self.proc
        self.proc = None
        if proc is None:
            return

        # 1. Tell exiftool to exit cleanly via its protocol.
        try:
            if proc.stdin is not None and not proc.stdin.closed:
                try:
                    proc.stdin.write("-stay_open\nFalse\n")
                    proc.stdin.flush()
                except (BrokenPipeError, OSError, ValueError):
                    pass
                try:
                    proc.stdin.close()
                except (BrokenPipeError, OSError, ValueError):
                    pass
        except Exception as e:
            log.debug("exiftool stdin close: %s", e)

        # 2. Wait for it to exit; force-kill on timeout. Either failure
        # mode is fine — the worst case is an orphan exiftool that the OS
        # will reap shortly.
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=2)
            except Exception as e:
                log.debug("exiftool kill: %s", e)
        except Exception as e:
            log.debug("exiftool wait: %s", e)

        # 3. Close stdout/stderr handles to free the OS resources. On
        # Windows these can raise EINVAL (errno 22) if the underlying
        # handle is already invalid — silenced.
        for stream in (proc.stdout, proc.stderr):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass

    def run(self, args: list[str]) -> tuple[bool, str]:
        """Send `args` (one per line) + `-execute`, wait for `{ready}`.
        Returns (success, stderr_text). Stderr is captured by exiftool
        but in `-q -q` mode it stays mostly empty unless something
        actually broke."""
        if self.proc is None or self.proc.stdin is None or self.proc.stdout is None:
            return False, "exiftool process not running"
        if self.proc.poll() is not None:
            return False, f"exiftool died (rc={self.proc.returncode})"

        with self.lock:
            try:
                for arg in args:
                    self.proc.stdin.write(arg + "\n")
                self.proc.stdin.write("-execute\n")
                self.proc.stdin.flush()
            except (BrokenPipeError, OSError) as e:
                return False, f"write to exiftool failed: {e}"

            # Read stdout line-by-line until we see the ready sentinel.
            # exiftool writes "{ready}\n" after each `-execute`.
            try:
                while True:
                    line = self.proc.stdout.readline()
                    if not line:
                        return False, "exiftool stdout closed unexpectedly"
                    if line.strip() == "{ready}":
                        return True, ""
            except Exception as e:
                return False, f"read from exiftool failed: {e}"
