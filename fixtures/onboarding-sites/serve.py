"""Serve the onboarding fixture sites (chunk 20a), one port each.

    python3 fixtures/onboarding-sites/serve.py

Ports 8701–8710 are the businesses in sites.py, 8711 a site whose robots.txt disallows
everything, and nothing listens on 8712 (the unreachable case). From ally-be in Docker
they're http://host.docker.internal:87xx/, which ally-be reads only when
BOT_DRAFT_CRAWL_ALLOW_HOSTS allows that host (development and test only).

Every site also answers /__expected.json, what the eval checks for it.
Standard library only.
"""

from __future__ import annotations

import html
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sites import BLOCKED, LIVE_CASES, SITES, UNREACHABLE_PORT  # noqa: E402

LOGO = """<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<rect width="96" height="96" rx="20" fill="{colour}"/>
<text x="48" y="60" font-family="Georgia,serif" font-size="40" fill="#fff"
 text-anchor="middle">{initial}</text></svg>"""


def page_html(site: dict, path: str) -> str:
    title, body = site["pages"][path]
    nav = " · ".join(
        f'<a href="{p}">{html.escape(site["pages"][p][0].split(" — ")[0])}</a>'
        for p in site["pages"]
    )
    hidden = (
        f'<a href="{site["robots_disallow"]}">Staff</a>'
        if site.get("robots_disallow")
        else ""
    )
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<meta name="theme-color" content="{site["colour"]}">
<meta property="og:image" content="/logo.svg">
<link rel="icon" href="/logo.svg">
<style>body{{font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem}}
header a{{color:{site["colour"]}}}</style></head>
<body><header><img class="logo" src="/logo.svg" alt="{html.escape(site["name"])} logo"
 width="48"><nav>{nav} {hidden}</nav></header>
<main>{body}</main>
<footer><p>© 2026 {html.escape(site["name"])}. All rights reserved.</p></footer>
</body></html>"""


def handler_for(site: dict):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # quiet
            pass

        def send(self, status: int, body: str, kind: str = "text/html; charset=utf-8"):
            data = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?")[0].rstrip("/") or "/"
            base = f"http://{self.headers.get('Host')}"
            if site.get("blocked"):
                if path == "/robots.txt":
                    return self.send(200, "User-agent: *\nDisallow: /\n", "text/plain")
                return self.send(
                    200,
                    "<html><head><title>Private Practice</title></head>"
                    "<body><main><h1>Private Practice</h1><p>"
                    + "We see clients by referral only. " * 20
                    + "</p></main></body></html>",
                )
            if path == "/robots.txt":
                lines = ["User-agent: *"]
                lines.append(f"Disallow: {site['robots_disallow']}" if site.get("robots_disallow") else "Disallow:")
                if site.get("sitemap"):
                    lines.append(f"Sitemap: {base}/sitemap.xml")
                return self.send(200, "\n".join(lines) + "\n", "text/plain")
            if path == "/sitemap.xml" and site.get("sitemap"):
                urls = "".join(f"<url><loc>{base}{p}</loc></url>" for p in site["pages"])
                return self.send(
                    200,
                    f'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>',
                    "application/xml",
                )
            if path == "/logo.svg":
                return self.send(
                    200,
                    LOGO.format(colour=site["colour"], initial=site["name"][0]),
                    "image/svg+xml",
                )
            if path == "/__expected.json":
                return self.send(
                    200,
                    json.dumps(
                        {k: site.get(k) for k in ("key", "name", "expected", "gaps")}
                    ),
                    "application/json",
                )
            if path in site["pages"]:
                return self.send(200, page_html(site, path))
            if site.get("robots_disallow") and path == site["robots_disallow"]:
                return self.send(200, "<html><body><h1>Staff rota</h1><p>Private.</p></body></html>")
            return self.send(404, "<html><body><h1>Not found</h1></body></html>")

    return Handler


def main() -> None:
    servers = []
    for site in [*SITES, {**BLOCKED, "blocked": True}]:
        server = ThreadingHTTPServer(("0.0.0.0", site["port"]), handler_for(site))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        print(f"{site['port']}  {site['key']:<16} {site['name']}")
    print(f"{UNREACHABLE_PORT}  unreachable      (nothing listens)")
    for case in LIVE_CASES:
        print(f"live  {case['key']:<16} {case['url']}")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        for server in servers:
            server.shutdown()


if __name__ == "__main__":
    main()
