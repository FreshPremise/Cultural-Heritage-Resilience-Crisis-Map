"""Start one owned loopback server and open Cultural Heritage Resilience."""

from __future__ import annotations

import argparse
import errno
import webbrowser
from collections.abc import Iterable
from pathlib import Path

from serve_local import create_server


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_PORTS = tuple(range(8765, 8771))


def create_owned_server(
    directory: str | Path = ROOT,
    ports: Iterable[int] = CANDIDATE_PORTS,
):
    """Bind a new server directly; never probe or reuse an existing listener."""

    failures: list[OSError] = []
    for port in ports:
        try:
            return create_server("127.0.0.1", int(port), directory)
        except OSError as exc:
            if exc.errno not in {errno.EADDRINUSE, 10048, errno.EACCES, 10013}:
                raise
            failures.append(exc)
    raise RuntimeError(
        "Could not start Cultural Heritage Resilience because its local ports are already in use."
    ) from (failures[-1] if failures else None)


def open_owned_server(server, browser_open=webbrowser.open) -> str:
    """Open only the loopback port held by the supplied server object."""

    host, port = server.server_address[:2]
    if host != "127.0.0.1":
        raise ValueError("The local launcher only opens a server bound to 127.0.0.1")
    url = f"http://127.0.0.1:{port}/"
    browser_open(url)
    return url


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Bind and print the owned URL without opening a browser (for diagnostics).",
    )
    args = parser.parse_args()
    with create_owned_server() as server:
        url = (
            f"http://127.0.0.1:{server.server_port}/"
            if args.no_browser
            else open_owned_server(server)
        )
        print(f"Serving Cultural Heritage Resilience on {url}", flush=True)
        print("Keep this window open while using the map. Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
