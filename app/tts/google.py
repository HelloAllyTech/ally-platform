"""Google Cloud TTS provider implementation."""
from typing import Optional, Literal
from livekit.plugins import google
from app.core.config import settings
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger
from app.utils.tts_validator import validate_google_voice

logger = get_logger(__name__)

# Type aliases for Google TTS parameters
Gender = Literal["male", "female", "neutral"]


class GoogleTTSClient(BaseTTSClient):
    """
    Google Cloud TTS client implementation.
    
    Based on LiveKit Google TTS plugin:
    https://docs.livekit.io/agents/models/tts/plugins/google/
    """
    
    def __init__(
        self,
        language_code: str,
        gender: Optional[Gender] = None,
        voice_name: Optional[str] = None,
        voice_cloning_key: Optional[str] = None,
        credentials_info: Optional[dict] = None,
        credentials_file: Optional[str] = None,
    ):
        """
        Initialize Google Cloud TTS client.
        
        Args:
            language_code: BCP 47 language code (e.g., "en-US", "hi-IN")
                Defaults to "en-US" if not provided
            gender: Voice gender - "male", "female", or "neutral" (default: "neutral")
            voice_name: Optional specific voice name (e.g., "en-US-Standard-H", "en-US-Neural2-A")
                See: https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
            voice_cloning_key: Optional voice cloning key for custom voices (Chirp 3)
            credentials_info: Optional dict of Google Cloud credentials
            credentials_file: Optional path to credentials JSON file
        """
        if not language_code:
            raise ValueError("Google TTS requires 'language_code'")
        
        # Validate configuration
        if not validate_google_voice(
            language_code=language_code,
            gender=gender,
            voice_name=voice_name
        ):
            raise ValueError(
                f"Invalid Google TTS configuration: "
                f"language_code={language_code}, voice_name={voice_name}"
            )
        
        self._language_code = language_code
        self._gender = gender or "neutral"
        self._voice_name = voice_name
        self._voice_cloning_key = voice_cloning_key
        self._credentials_info = credentials_info
        # Handle credentials_file - prioritize passed parameter, then settings
        # If no credentials_file is provided, Google TTS will use Application Default Credentials (ADC)
        # In Docker, ADC credentials are mounted at /root/.config/gcloud/application_default_credentials.json
        if credentials_file:
            self._credentials_file = credentials_file
        elif hasattr(settings, 'GOOGLE_APPLICATION_CREDENTIALS') and settings.GOOGLE_APPLICATION_CREDENTIALS:
            creds_path = settings.GOOGLE_APPLICATION_CREDENTIALS
            # If it's a file path (starts with / or ends with .json), use it
            # Convert host paths to container paths if needed
            if isinstance(creds_path, str):
                # If it's a host path, try to map it to container path
                if creds_path.startswith('/Users/') or creds_path.startswith('/home/'):
                    # Host path - try to find it in mounted volume
                    # For Docker, we expect it to be at /app/google-credentials.json
                    if '/google-credentials.json' in creds_path:
                        self._credentials_file = '/app/google-credentials.json'
                    else:
                        # Try to extract filename and use /app/ prefix
                        import os
                        filename = os.path.basename(creds_path)
                        self._credentials_file = f'/app/{filename}'
                elif creds_path.startswith('/') or creds_path.endswith('.json'):
                    # Already a container path
                    self._credentials_file = creds_path
                else:
                    # Not a file path, might be ADC indicator - don't set credentials_file
                    self._credentials_file = None
            else:
                self._credentials_file = None
        else:
            # No credentials_file specified - will use Application Default Credentials (ADC)
            self._credentials_file = None
        self._tts_instance = None
    
    @property
    def tts_instance(self) -> google.TTS:
        """Get the underlying Google Cloud TTS instance."""
        if self._tts_instance is None:
            # Build kwargs for Google TTS initialization
            tts_kwargs = {
                "language": self._language_code,
                "gender": self._gender,
            }
            
            # Add optional parameters
            if self._voice_name:
                tts_kwargs["voice_name"] = self._voice_name
            if self._voice_cloning_key:
                tts_kwargs["voice_cloning_key"] = self._voice_cloning_key
            if self._credentials_info:
                tts_kwargs["credentials_info"] = self._credentials_info
            if self._credentials_file:
                tts_kwargs["credentials_file"] = self._credentials_file
            
            self._tts_instance = google.TTS(**tts_kwargs)
        return self._tts_instance

