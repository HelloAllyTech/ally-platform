"""
User model for the application.
"""

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func

from app.core.models.base import Base


class User(Base):
    """User model for storing user information and authentication data."""
    
    __tablename__ = "users"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # User information
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    
    # Authentication
    refresh_token = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.timezone('UTC', func.now())
    )
    updated_at = Column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.timezone('UTC', func.now()),
        onupdate=func.timezone('UTC', func.now())
    )
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}', name='{self.name}')>"
    
    def __str__(self) -> str:
        return f"User {self.name} ({self.email})"
