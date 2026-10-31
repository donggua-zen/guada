#!/usr/bin/env python3
"""接收烘焙页面 POST 上来的图片数据并落盘（仅本地回环使用）。"""
import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bake_out")
os.makedirs(OUT, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except Exception:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        for name, data in payload.items():
            if not data:
                continue
            raw = base64.b64decode(data.split(",", 1)[-1])
            path = os.path.join(OUT, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(raw)
            print(f"wrote {name}  {len(raw):,} bytes", flush=True)
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"receiving into {OUT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 8900), Handler).serve_forever()
