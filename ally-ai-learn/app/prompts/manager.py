from pathlib import Path
from typing import Dict

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
        self.templates_dir = Path(__file__).parent
        self._prompts: Dict[str, Dict[str, str]] = {}
        self.load_prompts()
        self.initialized = True

    def load_prompts(self):
        """Loads all .txt prompt files from the prompts directory.

        Expects structure: <file_key>/<prompt_key>.txt
        e.g. system/main_agent_prompt.txt under app/prompts/
        """
        self._prompts = {}
        if not self.templates_dir.exists():
            logger.warning(f"Templates directory not found: {self.templates_dir}")
            return

        for subdir in self.templates_dir.iterdir():
            if not subdir.is_dir():
                continue
            file_key = subdir.name
            self._prompts[file_key] = {}

            # Load .txt templates
            for txt_file in subdir.glob("*.txt"):
                prompt_key = txt_file.stem
                try:
                    content = txt_file.read_text(encoding="utf-8")
                    self._prompts[file_key][prompt_key] = content
                    logger.info(f"Loaded prompt {file_key}/{prompt_key}.txt")
                except Exception as e:
                    logger.error(f"Failed to load {txt_file}: {e}")

    def get_template(self, file_key: str, prompt_key: str) -> str:
        """Retrieves a prompt template by file key and prompt key."""
        file_prompts = self._prompts.get(file_key)
        if not file_prompts:
            logger.error(f"No prompts found for file key: {file_key}")
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
