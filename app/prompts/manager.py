from pathlib import Path
from typing import Dict

import yaml

from app.core.logger import get_logger

logger = get_logger(__name__)


class PromptManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PromptManager, cls).__new__(cls)
            cls._instance.initialized = False
        return cls._instance

    def __init__(self):
        if self.initialized:
            return
        self.templates_dir = Path(__file__).parent / "templates"
        self._prompts: Dict[str, Dict[str, str]] = {}
        self.load_prompts()
        self.initialized = True

    def load_prompts(self):
        """Loads all YAML files from the templates directory."""
        self._prompts = {}
        if not self.templates_dir.exists():
            logger.warning(f"Templates directory not found: {self.templates_dir}")
            return

        for yaml_file in self.templates_dir.glob("*.yaml"):
            try:
                # Use safe_load to avoid arbitrary code execution
                with open(yaml_file, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                    if isinstance(data, dict):
                        # Store by filename (without extension) -> dict of prompts
                        file_key = yaml_file.stem
                        self._prompts[file_key] = data
                        logger.info(f"Loaded prompts from {yaml_file.name}")
            except Exception as e:
                logger.error(f"Failed to load prompts from {yaml_file}: {e}")

    def get_template(self, file_key: str, prompt_key: str) -> str:
        """Retrieves a prompt template by file key and prompt key."""
        file_prompts = self._prompts.get(file_key)
        if not file_prompts:
            logger.error(f"No prompts found for file key: {file_key}")
            # Fallback re-load just in case it was added recently?
            # No, keep it simple for now.
            return ""

        template = file_prompts.get(prompt_key)
        if not template:
            logger.error(f"Prompt key '{prompt_key}' not found in {file_key}")
            return ""

        return template

    def reload(self):
        """Reloads all prompts from disk."""
        logger.info("Reloading prompts...")
        self.load_prompts()


# Global instance
prompt_manager = PromptManager()
