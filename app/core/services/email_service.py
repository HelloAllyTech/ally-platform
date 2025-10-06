"""
Email service for sending OTP emails via AWS SES.
"""

import asyncio
import logging
from typing import Optional
import boto3
from botocore.exceptions import ClientError

from app.core.config import settings
from app.templates import load_email_template

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via AWS SES."""
    
    def __init__(self):
        """Initialize SES client."""
        self._ses_client = None
    
    @property
    def ses_client(self):
        """Lazy initialization of SES client."""
        if self._ses_client is None:
            # TODO: Role based is recommended
            #       Added this since we need to send unverified emails and
            #       currently learn is only in DEV environment
            client_config = {
                'aws_access_key_id': settings.AWS_ACCESS_KEY_ID,
                'aws_secret_access_key': settings.AWS_SECRET_ACCESS_KEY,
                'region_name': settings.AWS_REGION
            }
            if settings.AWS_ENDPOINT_URL:
                # Configure SES client for LocalStack
                client_config['endpoint_url'] = settings.AWS_ENDPOINT_URL
            self._ses_client = boto3.client('ses', **client_config)
        return self._ses_client
    
    async def send_otp_email(self, email: str, otp_code: str) -> bool:
        """
        Send OTP email asynchronously.
        
        Args:
            email: Recipient email address
            otp_code: 4-digit OTP code
            
        Returns:
            True if email sent successfully, False otherwise
        """
        try:
            # Run the synchronous SES call in a thread pool
            await asyncio.to_thread(
                self._send_otp_email_sync,
                email,
                otp_code
            )
            logger.info(f"OTP email sent successfully to {email}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send OTP email to {email}: {type(e).__name__}")
            return False
    
    def _send_otp_email_sync(self, email: str, otp_code: str) -> None:
        """
        Synchronous SES email sending (runs in thread pool).
        
        Args:
            email: Recipient email address
            otp_code: 4-digit OTP code
            
        Raises:
            ClientError: If SES API call fails
        """
        subject = "Your Ally Learn Login Code"
        
        # Load email templates
        templates = load_email_template("otp_email", otp_code=otp_code)
        html_body = templates['html']
        text_body = templates['text']
        
        # Send email via SES
        response = self.ses_client.send_email(
            Source=f"{settings.SES_FROM_NAME} <{settings.SES_FROM_EMAIL}>",
            Destination={
                'ToAddresses': [email]
            },
            Message={
                'Subject': {
                    'Data': subject,
                    'Charset': 'UTF-8'
                },
                'Body': {
                    'Html': {
                        'Data': html_body,
                        'Charset': 'UTF-8'
                    },
                    'Text': {
                        'Data': text_body,
                        'Charset': 'UTF-8'
                    }
                }
            }
        )
        
        logger.debug(f"SES response: {response['MessageId']}")


# Singleton instance
email_service = EmailService()
