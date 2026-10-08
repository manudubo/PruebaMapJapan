"""TEST ONLY (stack-e2e.sh phase "invite"): follow the email that scripts/add-user.sh
makes Keycloak send, the way the invited person would: open the link, choose a
password, and expect Keycloak's "account updated" page.

  python3 -I invite-flow.py <mailpit api url> <email> <public https base> <password>

Uses TEST_CA_FILE (env) to trust the test TLS front. Exit 0 on success."""
import html
import http.cookiejar
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

sink, email, public, password = sys.argv[1:5]
ctx = ssl.create_default_context(cafile=os.environ.get("TEST_CA_FILE") or None)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


local = urllib.request.build_opener(urllib.request.ProxyHandler({}))
web = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx),
                                  urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect())


def fetch(url, form=None):
    data = urllib.parse.urlencode(form).encode() if form else None
    try:
        r = web.open(urllib.request.Request(url, data=data), timeout=20)
        return r.status, r.headers, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode()


found = json.load(local.open(f"{sink}/search?query=to:{urllib.parse.quote(email)}"))["messages"]
if not found:
    sys.exit(f"no invite email for {email}")
message = json.load(local.open(f"{sink}/message/{found[0]['ID']}"))
link = re.search(r"https://\S+/login-actions/action-token\S+", message["Text"])
if not link or not link.group(0).startswith(public):
    sys.exit("invite email has no action link on the public URL")

url, submitted = link.group(0).rstrip(").,"), False
for _ in range(12):
    status, headers, body = fetch(url)
    if status in (301, 302, 303):
        url = urllib.parse.urljoin(url, headers["Location"])
        continue
    if 'name="password-new"' in body and not submitted:
        action = html.unescape(re.search(r'<form[^>]*action="([^"]+)"', body).group(1))
        status, headers, body = fetch(action, {"password-new": password, "password-confirm": password})
        submitted = True
        if status in (301, 302, 303):
            url = urllib.parse.urljoin(action, headers["Location"])
            continue
    if submitted and "Your account has been updated" in body:
        print("invite: password set, account updated")
        sys.exit(0)
    proceed = re.search(r'href="([^"]*/login-actions/[^"]*)"', body)
    if proceed and not submitted:
        url = html.unescape(proceed.group(1))
        continue
    feedback = re.search(r'kc-feedback-text">([^<]*)', body)
    sys.exit(f"invite flow stopped (HTTP {status}): {feedback.group(1) if feedback else url[:120]}")
sys.exit("invite flow: too many steps")
