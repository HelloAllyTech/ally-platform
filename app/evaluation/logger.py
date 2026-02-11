"""
Simple evaluation logger for tracking LLM inputs/outputs.
Logs entire conversations to JSON files for later analysis.
Tracks conversations by session/room ID.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class ConversationLogger:
    """
    Logger that tracks entire conversations by session ID.
    Stores one conversation per file.
    """

    def __init__(self, log_dir: Optional[str] = None):
        self.log_dir = Path(
            log_dir
            or getattr(settings, "EVALUATION_LOG_DIR", None)
            or "evaluation_logs"
        )
        self.log_dir.mkdir(parents=True, exist_ok=True)
        # Track active conversations by session_id
        self._active_conversations: Dict[str, Dict[str, Any]] = {}
        logger.info(f"Evaluation logs will be saved to: {self.log_dir}")

    def start_conversation(
        self,
        session_id: str,
        language_code: str,
        method: str = "default",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Start tracking a new conversation.

        Args:
            session_id: Unique session/room identifier
            language_code: Language code
            method: Method identifier (default: "default")
            metadata: Additional metadata
        """
        self._active_conversations[session_id] = {
            "session_id": session_id,
            "language_code": language_code,
            "method": method,
            "start_time": datetime.now().isoformat(),
            "interactions": [],
            "metadata": metadata or {},
        }
        logger.debug(f"Started tracking conversation: {session_id}")

    def log_interaction(
        self,
        session_id: str,
        input_text: str,
        output_text: str,
    ) -> None:
        """
        Log an interaction within a conversation.

        Args:
            session_id: Session/room identifier
            input_text: User input
            output_text: LLM output
        """
        if session_id not in self._active_conversations:
            # Auto-start conversation if not already started
            logger.warning(
                f"Conversation {session_id} not started, auto-starting with defaults"
            )
            self.start_conversation(session_id, "en-IN", "default")

        interaction = {
            "timestamp": datetime.now().isoformat(),
            "input": input_text,
            "output": output_text,
        }

        self._active_conversations[session_id]["interactions"].append(interaction)
        logger.debug(f"Logged interaction for session: {session_id}")

    def end_conversation(self, session_id: str) -> Optional[str]:
        """
        End a conversation and save it to a file.

        Args:
            session_id: Session/room identifier

        Returns:
            Path to the saved log file, or None if conversation not found
        """
        if session_id not in self._active_conversations:
            logger.warning(f"Conversation {session_id} not found, cannot end")
            return None

        conversation = self._active_conversations[session_id]
        conversation["end_time"] = datetime.now().isoformat()
        conversation["total_interactions"] = len(conversation["interactions"])

        # Create filename with session_id and timestamp
        safe_session_id = session_id.replace("/", "_").replace("\\", "_")
        timestamp = conversation["start_time"].replace(":", "-").replace(".", "-")
        filename = (
            f"{conversation['method']}_{conversation['language_code']}_"
            f"{safe_session_id}_{timestamp}.json"
        )
        filepath = self.log_dir / filename

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(conversation, f, indent=2, ensure_ascii=False)

            logger.info(
                f"Saved conversation {session_id} with "
                f"{conversation['total_interactions']} interactions to {filepath}"
            )

            # Remove from active conversations
            del self._active_conversations[session_id]

            return str(filepath)
        except Exception as e:
            logger.error(f"Failed to save conversation {session_id}: {e}")
            return None


class EvaluationLogger:
    """
    Simple logger for evaluation data.
    Wraps ConversationLogger for backward compatibility.
    """

    def __init__(self, log_dir: Optional[str] = None):
        self.conversation_logger = ConversationLogger(log_dir)
        self.log_dir = self.conversation_logger.log_dir

    def log_interaction(
        self,
        input_text: str,
        output_text: str,
        language_code: str,
        method: str = "default",
        metadata: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> str:
        """
        Log an LLM interaction for evaluation.

        If session_id is provided, uses conversation tracking.
        Otherwise, creates individual log files (backward compatibility).

        Args:
            input_text: User input
            output_text: LLM output
            language_code: Language code
            method: Method identifier (default: "default")
            metadata: Additional metadata
            session_id: Optional session/room identifier for conversation tracking

        Returns:
            Path to the log file (or empty string if using conversation tracking)
        """
        if session_id:
            # Use conversation tracking
            if session_id not in self.conversation_logger._active_conversations:
                self.conversation_logger.start_conversation(
                    session_id, language_code, method, metadata
                )

            self.conversation_logger.log_interaction(
                session_id, input_text, output_text
            )
            return ""  # File will be saved when conversation ends
        else:
            # Backward compatibility: individual files
            timestamp = datetime.now().isoformat()
            log_entry = {
                "timestamp": timestamp,
                "language_code": language_code,
                "method": method,
                "input": input_text,
                "output": output_text,
                "metadata": metadata or {},
            }

            safe_timestamp = timestamp.replace(":", "-").replace(".", "-")
            filename = f"{method}_{language_code}_{safe_timestamp}.json"
            filepath = self.log_dir / filename

            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(log_entry, f, indent=2, ensure_ascii=False)

                logger.debug(f"Logged interaction to {filepath}")
                return str(filepath)
            except Exception as e:
                logger.error(f"Failed to log interaction: {e}")
                return ""

    def end_conversation(self, session_id: str) -> Optional[str]:
        """
        End a conversation and save it to a file.

        Args:
            session_id: Session/room identifier

        Returns:
            Path to the saved log file
        """
        return self.conversation_logger.end_conversation(session_id)


# Global instance
evaluation_logger = EvaluationLogger()
