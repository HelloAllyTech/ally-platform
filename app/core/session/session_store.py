from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
import threading
from dataclasses import dataclass

from app.core.config import settings


@dataclass
class SessionData:
    created_at: datetime
    last_accessed: datetime


# Main session store
SESSION_STORE: Dict[str, SessionData] = {}
SESSION_TIMEOUT = timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)
_lock = threading.Lock()  # Thread safety for concurrent requests


def store_session(session_id: str) -> None:
    """Store a new session"""
    with _lock:
        SESSION_STORE[session_id] = SessionData(
            created_at=datetime.now(timezone.utc),
            last_accessed=datetime.now(timezone.utc)
        )


def get_session(session_id: str) -> Optional[SessionData]:
    """Get session if valid, None if expired/invalid"""
    with _lock:
        if session_id not in SESSION_STORE:
            return None

        session = SESSION_STORE[session_id]

        # Check expiration
        if datetime.now(timezone.utc) - session.last_accessed > SESSION_TIMEOUT:
            del SESSION_STORE[session_id]
            return None

        # Update last accessed
        session.last_accessed = datetime.now(timezone.utc)
        return session


def delete_session(session_id: str) -> bool:
    """Delete a specific session"""
    with _lock:
        return SESSION_STORE.pop(session_id, None) is not None


def cleanup_expired_sessions() -> int:
    """Remove expired sessions, return count removed"""
    with _lock:
        expired_sessions = []
        cutoff_time = datetime.now(timezone.utc) - SESSION_TIMEOUT

        for session_id, session in SESSION_STORE.items():
            if session.last_accessed < cutoff_time:
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            del SESSION_STORE[session_id]

        return len(expired_sessions)


def get_active_session_count() -> int:
    """Get count of active sessions"""
    cleanup_expired_sessions()  # Clean first
    return len(SESSION_STORE)


def get_all_active_sessions() -> Dict[str, dict]:
    """Get all active sessions (for admin/debugging)"""
    cleanup_expired_sessions()
    return {
        session_id: {
            "created_at": session.created_at,
            "last_accessed": session.last_accessed
        }
        for session_id, session in SESSION_STORE.items()
    }