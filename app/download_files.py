import logging

from livekit.plugins import silero

from app.core.constants import DEFAULT_VAD_ACTIVATION_THRESHOLD

logger = logging.getLogger(__name__)


def download_required_files() -> None:
    """Pre-download model assets needed at runtime without loading app settings."""
    logger.info("Downloading required model files...")
    silero.VAD.load(activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD)

    # Semantic turn detection (multilingual EOU). At runtime the worker loads the
    # ONNX model, tokenizer and languages.json with local_files_only=True and
    # will NOT fetch them on demand, so they must be baked into the image here.
    # Importing the multilingual module registers its EOUPlugin; calling
    # Plugin.download_files() pulls the HuggingFace assets (cached under
    # HF_HUB_CACHE). This mirrors the official `python <agent>.py download-files`
    # step without importing app settings.
    from livekit.agents import Plugin
    from livekit.plugins.turn_detector import multilingual  # noqa: F401

    for plugin in Plugin.registered_plugins:
        plugin.download_files()

    logger.info("Model files downloaded successfully")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    download_required_files()
