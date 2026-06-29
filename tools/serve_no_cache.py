#!/usr/bin/env python3
"""Servidor local sem cache para Terra Nova / SIMURB.
Evita Chrome servir JS/CSS antigo entre versões NewCore.
"""
from __future__ import annotations

import argparse
import functools
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        print("[TerraNova servidor] " + (format % args), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Servidor local sem cache do Terra Nova")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--root", default=os.getcwd())
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not (root / "index.html").exists():
        raise SystemExit(f"index.html não encontrado em {root}")

    handler = functools.partial(NoCacheHandler, directory=str(root))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Terra Nova servidor sem cache: http://{args.host}:{args.port}/")
    print(f"Raiz: {root}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
