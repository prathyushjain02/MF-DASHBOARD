"""The password in front of the whole site.

One shared password, checked once and remembered in a signed session cookie for
thirty days. Every page and every API call sits behind it; only /health stays
open, because the platform's health check has to reach it without logging in.

The password lives only in the host's environment, as SITE_PASSWORD, never in
the repository. If it is not set the site stays locked and says so, rather than
opening to everyone. A short PIN falls to a patient guesser, so wrong attempts
from one address are throttled.
"""

import hashlib
import hmac
import os
import time
from html import escape
from urllib.parse import urlparse

from flask import jsonify, redirect, request, session

MAX_TRIES = 8                 # wrong attempts allowed per address ...
WINDOW = 15 * 60              # ... in this many seconds, then it waits the window out
OPEN = {"/health", "/login", "/logout"}

_fails = {}                   # address -> recent failure times (per worker, in memory)


def _password():
    return os.environ.get("SITE_PASSWORD") or None


def _client():
    # Render sits behind a proxy: the first forwarded address is the visitor.
    fwd = request.headers.get("X-Forwarded-For", "")
    return fwd.split(",")[0].strip() or request.remote_addr or "?"


def _recent(addr):
    now = time.time()
    hits = [t for t in _fails.get(addr, []) if now - t < WINDOW]
    _fails[addr] = hits
    return hits


def _safe_next(target):
    # Only ever send people back to a path on this site.
    p = urlparse(target or "")
    ok = target and target.startswith("/") and not target.startswith("//") and not p.scheme and not p.netloc
    return target if ok else "/"


LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Filter · Avendus</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600&family=Ubuntu:wght@300;400;500&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 32 32'%3E%3Cpath d='M5 22 16 7l11 15' fill='none' stroke='%23fff' stroke-width='9' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 22 16 7l11 15' fill='none' stroke='%23cc1919' stroke-width='4.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 8 2, auto; }
  button { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 32 32'%3E%3Cpath d='M5 22 16 7l11 15' fill='none' stroke='%23fff' stroke-width='10' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 22 16 7l11 15' fill='none' stroke='%23a81212' stroke-width='5.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 8 2, pointer; }
  input { cursor: text; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    font-family: "Libre Franklin", system-ui, sans-serif; color: #2c3441;
    background: linear-gradient(117deg, #2d3440 3.31%, #2e3b51 46.36%, #3b4d6b 100%); }
  .card { width: 100%; max-width: 380px; background: #fff; border-radius: 14px; padding: 34px 32px 30px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, .35); }
  .brand { font-family: "Ubuntu", sans-serif; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; }
  .brand b { color: #cc1919; font-weight: 500; }
  .prod { font-family: "Ubuntu", sans-serif; font-weight: 300; font-size: 32px; margin: 18px 0 6px; }
  .prod b { color: #cc1919; font-weight: 300; }
  p { color: #5b6573; font-size: 14px; line-height: 1.5; margin-bottom: 22px; }
  label { display: block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6573; margin-bottom: 6px; }
  input { width: 100%; font: inherit; font-size: 20px; letter-spacing: 0.3em; padding: 11px 14px;
    border: 1px solid #c9d0da; border-radius: 8px; outline: none; }
  input:focus { border-color: #2e3b51; box-shadow: 0 0 0 3px rgba(46, 59, 81, .15); }
  button { width: 100%; margin-top: 16px; font: inherit; font-weight: 600; font-size: 15px; color: #fff;
    background: #cc1919; border: 0; border-radius: 8px; padding: 12px; }
  button:hover { background: #b01515; }
  .err { color: #c00000; font-size: 13px; margin-top: 12px; min-height: 1em; }
</style></head>
<body>
  <form class="card" method="post" action="/login">
    <div class="brand">Avendus<b>^</b></div>
    <div class="prod">The <b>Filter</b></div>
    <p>Enter the password to open the dashboard.</p>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
    <input type="hidden" name="next" value="{next}">
    <button type="submit">Enter</button>
    <div class="err" role="alert">{error}</div>
  </form>
</body></html>"""


def _page(error="", next_="/", status=200):
    body = LOGIN_PAGE.replace("{next}", escape(next_, quote=True)).replace("{error}", escape(error))
    return body, status, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


def install(app):
    """Put the gate in front of every route of the app."""
    pw = _password() or ""
    app.secret_key = os.environ.get("SECRET_KEY") or hashlib.sha256(
        ("the-filter-session|" + pw).encode()).hexdigest()
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER")),   # https in production
        PERMANENT_SESSION_LIFETIME=30 * 24 * 3600,
    )

    @app.before_request
    def _gate():
        if request.path in OPEN or session.get("ok"):
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "password required"}), 401
        return redirect("/login?next=" + request.full_path.rstrip("?"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        nxt = _safe_next(request.values.get("next"))
        expected = _password()
        if request.method == "GET":
            if session.get("ok"):
                return redirect(nxt)
            return _page("" if expected else "The site password has not been set up yet.", nxt)
        if not expected:
            return _page("The site password has not been set up yet.", nxt, 503)
        addr = _client()
        if len(_recent(addr)) >= MAX_TRIES:
            return _page("Too many attempts. Try again in a few minutes.", nxt, 429)
        given = request.form.get("password", "")
        if hmac.compare_digest(given.encode(), expected.encode()):
            _fails.pop(addr, None)
            session.clear()
            session.permanent = True
            session["ok"] = True
            return redirect(nxt)
        _fails.setdefault(addr, []).append(time.time())
        return _page("That password is not right.", nxt, 401)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect("/login")
