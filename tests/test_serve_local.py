import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("serve_local", ROOT / "scripts" / "serve_local.py")
SERVE_LOCAL = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVE_LOCAL)


class RestrictedServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = SERVE_LOCAL.create_server("127.0.0.1", 0, ROOT)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_runtime_asset_has_security_headers(self):
        with self.opener.open(self.base + "/", timeout=3) as response:
            body = response.read().decode("utf-8")
            self.assertIn("Cultural Heritage Resilience", body)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertEqual(response.headers["Cross-Origin-Opener-Policy"], "same-origin")
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
            self.assertEqual(
                response.headers["Cache-Control"],
                "no-store, no-cache, max-age=0, must-revalidate",
            )
            self.assertEqual(response.headers["Pragma"], "no-cache")
            self.assertEqual(response.headers["Expires"], "0")
            self.assertIsNone(response.headers.get("Clear-Site-Data"))

    def test_version_manifest_is_served_without_caching(self):
        with self.opener.open(self.base + "/version.json", timeout=3) as response:
            body = response.read().decode("utf-8")
            expected = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))
            self.assertEqual(json.loads(body), expected)
            self.assertEqual(
                response.headers["Cache-Control"],
                "no-store, no-cache, max-age=0, must-revalidate",
            )
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_privacy_page_is_a_served_runtime_document(self):
        with self.opener.open(self.base + "/privacy.html", timeout=3) as response:
            body = response.read().decode("utf-8")
            self.assertIn("<h1>Privacy</h1>", body)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_repository_and_traversal_paths_are_not_served(self):
        for path in (
            "/SECURITY.md", "/README.md", "/scripts/serve_local.py", "/js/../SECURITY.md",
        ):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    self.opener.open(self.base + path, timeout=3)
                self.assertEqual(raised.exception.code, 404)
                raised.exception.close()

    def test_mutating_methods_are_rejected(self):
        # Test method rejection without an unread request body racing Windows socket teardown.
        request = urllib.request.Request(self.base + "/", data=b"", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.opener.open(request, timeout=3)
        self.assertEqual(raised.exception.code, 405)
        raised.exception.close()


if __name__ == "__main__":
    unittest.main()
