import importlib.util
import socket
import sys
import threading
import unittest
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
WRAPPER = ROOT / "Launch-Cultural-Heritage-Resilience.ps1"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("launch_local", SCRIPTS / "launch_local.py")
LAUNCH = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(LAUNCH)


class OwnedLauncherTests(unittest.TestCase):
    def test_powershell_wrapper_probes_py_before_committing_to_it(self):
        source = WRAPPER.read_text(encoding="utf-8")
        py_block, fallback = source.split('$python = Get-Command "python.exe"', 1)
        self.assertIn('-3 -c "import sys; raise SystemExit', py_block)
        self.assertIn('if ($LASTEXITCODE -eq 0)', py_block)
        self.assertIn('& $python.Source -3 $launcher', py_block)
        self.assertIn('& $python.Source $launcher', fallback)

    def test_browser_opens_only_the_port_owned_by_the_server_object(self):
        server = LAUNCH.create_owned_server(ROOT, [0])
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        opened = []
        try:
            url = LAUNCH.open_owned_server(server, opened.append)
            self.assertEqual(opened, [url])
            self.assertEqual(url, f"http://127.0.0.1:{server.server_port}/")
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(url, timeout=3) as response:
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_an_occupied_or_counterfeit_listener_is_never_reused(self):
        occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        occupied_port = occupied.getsockname()[1]
        server = None
        try:
            server = LAUNCH.create_owned_server(ROOT, [occupied_port, 0])
            self.assertNotEqual(server.server_port, occupied_port)
        finally:
            if server is not None:
                server.server_close()
            occupied.close()

    def test_all_occupied_candidates_fail_closed(self):
        occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        try:
            with self.assertRaisesRegex(RuntimeError, "already in use"):
                LAUNCH.create_owned_server(ROOT, [occupied.getsockname()[1]])
        finally:
            occupied.close()

    def test_non_loopback_server_is_never_opened(self):
        class FakeServer:
            server_address = ("0.0.0.0", 8765)

        opened = []
        with self.assertRaisesRegex(ValueError, "127.0.0.1"):
            LAUNCH.open_owned_server(FakeServer(), opened.append)
        self.assertEqual(opened, [])


if __name__ == "__main__":
    unittest.main()
