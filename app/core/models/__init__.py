"""
Database models for the application.
"""

from app.core.models.base import Base
from app.core.models.user import User
from app.core.models.otp import OTP

__all__ = ["Base", "User", "OTP"]
