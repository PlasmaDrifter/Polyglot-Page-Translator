#!/usr/bin/env python3
"""
Polyglot Page Translator - Test Web Server
Serves the multilingual test suite on http://localhost:8486
"""
import http.server
import socketserver
import os
import sys
from pathlib import Path

PORT = 8486
DIRECTORY = Path(__file__).resolve().parent

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def end_headers(self):
        # Enable CORS so testing is flexible
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"============================================================")
        print(f"Polyglot Test Server running at:")
        print(f"  http://localhost:{PORT}/test-multilingual-page.html")
        print(f"Press Ctrl+C to stop.")
        print(f"============================================================")
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

if __name__ == '__main__':
    main()
