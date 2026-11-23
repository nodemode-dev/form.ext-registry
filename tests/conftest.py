import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return ROOT


@pytest.fixture
def load_module(monkeypatch):
    def load(relative: str, name: str | None = None):
        path = ROOT / relative
        monkeypatch.syspath_prepend(str(path.parent))
        module_name = name or "_under_test_" + path.stem
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, module_name, module)
        spec.loader.exec_module(module)
        return module

    return load


@pytest.fixture
def run_tool():
    def run(script, *args, cwd=None, env=None, stdin=None):
        script_path = Path(script)
        if not script_path.is_absolute():
            script_path = ROOT / script_path
        merged = dict(os.environ)
        merged.update(env or {})
        return subprocess.run(
            [sys.executable, str(script_path), *[str(a) for a in args]],
            cwd=str(cwd or ROOT),
            env=merged,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=120,
        )

    return run
