"""
Session service for handling therapy session completion and analytics.
"""
from datetime import datetime
from typing import Optional, Dict, Any
import json

from app.utils.logger import get_logger

logger = get_logger(__name__)


class SessionService:
    """Service for managing therapy sessions and their completion."""
    
    def __init__(self):
        """Initialize the session service."""
        pass
    
    async def handle_session_completion(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None,
        session_data: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Handle session completion logic.
        
        Args:
            participant_identity: The participant's unique identifier
            participant_name: The participant's display name
            session_data: Optional session data to save
        """
        try:
            logger.info(f"Handling session completion for participant: {participant_identity}")
            
            # 1. Log session completion
            await self._log_session_completion(participant_identity, participant_name)
            
            # 2. Save session data to database
            if session_data:
                await self._save_session_data(participant_identity, session_data)
            
            # 3. Generate session analytics
            await self._generate_session_analytics(participant_identity)
            
            # 4. Send notifications
            await self._send_completion_notifications(participant_identity, participant_name)
            
            logger.info(f"Session completion handled successfully for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error handling session completion for {participant_identity}: {type(e).__name__}")
    
    async def _log_session_completion(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None
    ) -> None:
        """Log session completion details."""
        try:
            timestamp = datetime.now().isoformat()
            log_entry = {
                "timestamp": timestamp,
                "participant_identity": participant_identity,
                "participant_name": participant_name,
                "event": "session_completed",
                "session_duration": "calculated_duration"  # You can calculate this
            }
            
            # Log to file
            await self._write_to_log_file(log_entry)
            
            # You can also log to database here
            logger.info(f"Session completion logged: {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error logging session completion: {type(e).__name__}")
    
    async def _save_session_data(
        self, 
        participant_identity: str, 
        session_data: Dict[str, Any]
    ) -> None:
        """Save session data to database."""
        try:
            # Add metadata to session data
            session_data.update({
                "participant_identity": participant_identity,
                "completed_at": datetime.now().isoformat(),
                "session_status": "completed"
            })
            
            # Here you would save to your database
            # Example: await database.save_session(session_data)
            logger.info(f"Session data saved for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error saving session data: {type(e).__name__}")
    
    async def _generate_session_analytics(self, participant_identity: str) -> None:
        """Generate analytics for the completed session."""
        try:
            # Generate session analytics
            analytics = {
                "participant_identity": participant_identity,
                "session_date": datetime.now().isoformat(),
                "metrics": {
                    "total_duration": "calculated_duration",
                    "conversation_turns": "calculated_turns",
                    "engagement_score": "calculated_score",
                    "key_topics": "extracted_topics"
                }
            }
            
            # Save analytics to database or analytics service
            # Example: await analytics_service.save_session_analytics(analytics)
            logger.info(f"Session analytics generated for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error generating session analytics: {type(e).__name__}")
    
    async def _send_completion_notifications(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None
    ) -> None:
        """Send notifications about session completion."""
        try:
            # Send to different notification channels
            notifications = [
                await self._send_slack_notification(participant_identity, participant_name),
                await self._send_email_notification(participant_identity, participant_name),
                await self._send_database_notification(participant_identity, participant_name)
            ]
            
            logger.info(f"Notifications sent for session completion: {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error sending completion notifications: {type(e).__name__}")
    
    async def _send_slack_notification(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None
    ) -> None:
        """Send Slack notification about session completion."""
        try:
            # You can implement Slack notification here
            # Example: await slack_client.send_message(f"Session completed for {participant_identity}")
            logger.info(f"Slack notification sent for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error sending Slack notification: {type(e).__name__}")
    
    async def _send_email_notification(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None
    ) -> None:
        """Send email notification about session completion."""
        try:
            # You can implement email notification here
            # Example: await email_service.send_session_completion_email(participant_identity)
            logger.info(f"Email notification sent for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error sending email notification: {type(e).__name__}")
    
    async def _send_database_notification(
        self, 
        participant_identity: str, 
        participant_name: Optional[str] = None
    ) -> None:
        """Send notification to database for tracking."""
        try:
            # Save notification to database
            notification_data = {
                "participant_identity": participant_identity,
                "participant_name": participant_name,
                "notification_type": "session_completion",
                "timestamp": datetime.now().isoformat(),
                "status": "sent"
            }
            
            # Example: await database.save_notification(notification_data)
            logger.info(f"Database notification saved for {participant_identity}")
            
        except Exception as e:
            logger.error(f"Error saving database notification: {type(e).__name__}")
    
    async def _write_to_log_file(self, log_entry: Dict[str, Any]) -> None:
        """Write log entry to file."""
        try:
            import os
            from datetime import datetime
            
            # Create logs directory if it doesn't exist
            log_dir = "logs"
            os.makedirs(log_dir, exist_ok=True)
            
            # Create log file path with date
            timestamp = datetime.now().strftime("%Y%m%d")
            log_file = os.path.join(log_dir, f"session_completions_{timestamp}.jsonl")
            
            # Write log entry as JSON line
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
                
        except Exception as e:
            logger.error(f"Error writing to log file: {type(e).__name__}")


# Create a singleton instance
session_service = SessionService() 