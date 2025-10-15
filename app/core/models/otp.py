"""
OTP model for email-based authentication.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.core.models.base import Base


class OTP(Base):
    """OTP model for storing one-time passwords for email authentication."""
    
    __tablename__ = "otps"
    
    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # OTP details
    email = Column(String(255), nullable=False, index=True)
    code = Column(String(6), nullable=False)  # 6-digit OTP
    
    # Security and validation
    attempts = Column(Integer, default=0, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_expired = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at = Column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.timezone('UTC', func.now())
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    
    def __repr__(self) -> str:
        return f"<OTP(id={self.id}, email='{self.email}', verified={self.is_verified})>"
    
    def __str__(self) -> str:
        return f"OTP for {self.email} ({'verified' if self.is_verified else 'pending'})"
