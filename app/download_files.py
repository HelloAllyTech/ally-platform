import logging

from livekit.plugins import silero

from app.core.constants import DEFAULT_VAD_ACTIVATION_THRESHOLD

logger = logging.getLogger(__name__)


def download_required_files() -> None:
    """Pre-download model assets needed at runtime without loading app settings."""
    logger.info("Downloading required model files...")
    silero.VAD.load(activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD)
    logger.info("Model files downloaded successfully")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    download_required_files()
