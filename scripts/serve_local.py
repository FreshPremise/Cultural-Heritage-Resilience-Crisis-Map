"""Restricted loopback server for the Cultural Heritage Resilience static app."""

from __future__ import annotations

import argparse
import functools
import posixpath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://tiles.openfreemap.org "
    "https://tilecache.rainviewer.com https://*.tilecache.rainviewer.com; "
    "font-src 'self' data:; "
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; "
    "worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)

EXACT_PATHS = {"/", "/index.html", "/privacy.html", "/styles.css"}
ALLOWED_PREFIXES = ("/data/", "/js/", "/vendor/maplibre-gl/")


class RestrictedStaticHandler(SimpleHTTPRequestHandler):
    """Serve only browser runtime files and attach defense-in-depth headers."""

    server_version = "HeritageLocal/1.0"

    def _normalized_path(self) -> str | None:
        try:
            decoded = unquote(urlsplit(self.path).path, errors="strict")
        except (UnicodeDecodeError, ValueError):
            return None
        if "\x00" in decoded:
            return None
        normalized = posixpath.normpath(decoded)
        return normalized if normalized.startswith("/") else "/" + normalized

    def _is_allowed(self) -> bool:
        path = self._normalized_path()
        if path is None or not (path in EXACT_PATHS or path.startswith(ALLOWED_PREFIXES)):
            return False
        root = Path(self.directory).resolve()
        target = Path(super().translate_path(self.path)).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return False
        return True

    def send_head(self):
        if not self._is_allowed():
            self.send_error(404, "Runtime asset not found")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing disabled")
        return None

    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        )
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        if self._normalized_path() in {"/", "/index.html"}:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self) -> None:
        self.send_error(405, "Method not allowed")


def create_server(bind: str, port: int, directory: str | Path) -> ThreadingHTTPServer:
    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise NotADirectoryError(root)
    handler = functools.partial(RestrictedStaticHandler, directory=str(root))
    server = ThreadingHTTPServer((bind, port), handler)
    server.daemon_threads = True
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--directory", default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    with create_server(args.bind, args.port, args.directory) as server:
        print(f"Serving Cultural Heritage Resilience on http://{args.bind}:{server.server_port}/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
