import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _python_module_targets():
    """Every `python -m app.<module>` invocation in the Makefile."""
    content = (REPO_ROOT / "Makefile").read_text()
    return re.findall(r"-m (app\.[\w.]+)", content)


def test_makefile_targets_reference_existing_modules():
    for module in _python_module_targets():
        rel_path = Path(*module.split("."))
        module_file = REPO_ROOT / rel_path.with_suffix(".py")
        package_init = REPO_ROOT / rel_path / "__init__.py"
        assert module_file.exists() or package_init.exists(), (
            f"Makefile invokes `python -m {module}`, but neither "
            f"{module_file} nor {package_init} exists."
        )
