"""Tests for the /command allowlist (stdlib unittest).

Run from the repository root:

    python -m unittest discover -s software/control/tests -t software

The cases below are the bypasses that the old prefix check (``shell=True`` plus
``cmd.split("\\n")[0].startswith(prefix)``) allowed.
"""

from __future__ import annotations

import json
import os
import pathlib
import threading
import unittest
import urllib.error
import urllib.request
import http.server

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
os.environ.setdefault("SIPHER_REPO_DIR", str(REPO_ROOT))
os.environ.setdefault("SIPHER_LOG_DIR", str(REPO_ROOT / "logs"))

from control import command_endpoint as ce  # noqa: E402


class Allowlist(unittest.TestCase):
    def test_allowed_commands(self):
        for cmd in [
            "git status",
            "git log --oneline -5",
            f"git -C {REPO_ROOT.as_posix()} rev-parse --short HEAD",
            "systemctl is-active sipher-bridge",
            "systemctl --no-pager status sipher-command-endpoint.service",
            "systemctl show -p ActiveState sipher-bridge",
            "systemctl list-timers",
            "tailscale status",
            "tailscale ip -4",
            "cat README.md",
        ]:
            with self.subTest(cmd=cmd):
                argv, why = ce.build_argv(cmd)
                self.assertIsNotNone(argv, f"{cmd!r} rejected: {why}")

    def test_rejected_commands(self):
        for cmd in [
            # the old allowlist's biggest hole
            "python3 -c 'print(1)'",
            "python3 -m http.server 9000",
            # newline trick: only the first line used to be checked
            "git status\nrm -rf /",
            "git status\r\nwhoami",
            # shell metacharacters
            "git status; rm -rf /",
            "git status && curl http://evil.example",
            "git status | tee /tmp/x",
            "git status $(id)",
            "git status `id`",
            # git flags that execute other programs / redirect config
            "git -c core.sshCommand=evil pull",
            "git --exec-path=/tmp pull",
            "git --upload-pack=evil fetch",
            # state-changing git
            "git push origin main",
            "git reset --hard",
            # systemctl outside the sipher-* units, or state changing
            "systemctl restart ssh",
            "systemctl stop sipher-bridge",
            "systemctl status ssh",
            "systemctl status",
            # path escapes
            "cat /etc/shadow",
            "cat ../../etc/passwd",
            f"cat {REPO_ROOT}/../../etc/passwd",
            "cat README.md /etc/hosts",
            # tailscale state changes
            "tailscale up",
            "tailscale down",
            # anything else
            "rm -rf /",
            "sh -c id",
            "bash -lc id",
            "",
            "   ",
            "git " + "a" * ce.MAX_COMMAND_CHARS,
        ]:
            with self.subTest(cmd=cmd):
                self.assertFalse(ce.is_safe_command(cmd), f"{cmd!r} should be rejected")

    def test_argv_is_literal(self):
        argv, _ = ce.build_argv("git log --oneline -3")
        self.assertEqual(argv, ["git", "log", "--oneline", "-3"])
        argv, _ = ce.build_argv("systemctl is-active sipher-bridge")
        self.assertEqual(argv, ["systemctl", "is-active", "sipher-bridge"])

    def test_cat_resolves_inside_repo(self):
        argv, _ = ce.build_argv("cat README.md")
        self.assertIsNotNone(argv)
        self.assertEqual(os.path.realpath(argv[1]), str(REPO_ROOT / "README.md"))

    def test_no_shell_execution(self):
        """`git` receives the metacharacters as data, and they are rejected."""
        self.assertFalse(ce.is_safe_command("git status && echo pwned"))
        out = ce.run_command("git status && echo pwned")
        self.assertEqual(out["rc"], -1)
        self.assertIn("not allowed", out["error"])

    def test_timeout_is_clamped(self):
        out = ce.run_command("git rev-parse --short HEAD", timeout=10**6)
        self.assertEqual(out["rc"], 0, out)
        self.assertLessEqual(ce.MAX_TIMEOUT_S, 60)


class Authorization(unittest.TestCase):
    def setUp(self):
        self._token = ce.COMMAND_TOKEN

    def tearDown(self):
        ce.COMMAND_TOKEN = self._token

    def test_no_token_limits_to_private_networks(self):
        ce.COMMAND_TOKEN = ""
        for addr in ["127.0.0.1", "::1", "192.168.1.38", "10.0.0.5",
                     "169.254.10.2", "::ffff:192.168.1.38"]:
            with self.subTest(addr=addr):
                self.assertTrue(ce.command_authorized(addr, "")[0], addr)
        for addr in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "not-an-ip"]:
            with self.subTest(addr=addr):
                self.assertFalse(ce.command_authorized(addr, "")[0], addr)

    def test_token_required_when_configured(self):
        ce.COMMAND_TOKEN = "s3cret-token"
        self.assertFalse(ce.command_authorized("192.168.1.38", "")[0])
        self.assertFalse(ce.command_authorized("192.168.1.38", "wrong")[0])
        self.assertTrue(ce.command_authorized("192.168.1.38", "s3cret-token")[0])
        self.assertTrue(ce.command_authorized("8.8.8.8", "s3cret-token")[0])


class QuietHandler(ce.SipherHandler):
    def log_message(self, *args):  # keep test output clean
        pass


class HttpDoor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = http.server.HTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def post(self, payload, raw=None):
        body = raw if raw is not None else json.dumps(payload).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/command",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    def test_rejects_old_bypass_over_http(self):
        status, body = self.post({"command": "python3 -c 'print(1)'"})
        self.assertEqual(body["rc"], -1)
        self.assertIn("not allowed", body["error"])
        self.assertEqual(status, 200)

    def test_runs_allowed_command(self):
        _, body = self.post({"command": "git rev-parse --short HEAD"})
        self.assertEqual(body["rc"], 0, body)
        self.assertTrue(body["stdout"].strip())

    def test_rejects_oversized_body(self):
        status, body = self.post(None, raw=b'{"command":"' + b"a" * 5000 + b'"}')
        self.assertEqual(status, 413)
        self.assertIn("too large", body["error"])

    def test_rejects_bad_json(self):
        status, body = self.post(None, raw=b"not json")
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
