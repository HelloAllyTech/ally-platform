"""
Feedback model for the application.
"""

from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.models.base import Base


class Feedback(Base):
    """Feedback model for storing user feedback and ratings."""
    
    __tablename__ = "feedback"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    
    # Foreign key to user
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Feedback data
    rating = Column(Integer, nullable=True)
    comment = Column(Text, nullable=True)
    
    # Timestamp
    created_at = Column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.timezone('UTC', func.now())
    )
    
    # Constraints
    __table_args__ = (
        CheckConstraint('rating IS NULL OR (rating >= 1 AND rating <= 5)', name='rating_range_check'),
    )
    
    # Relationships
    user = relationship("User", back_populates="feedback")
    
    def __repr__(self) -> str:
        return f"<Feedback(id={self.id}, user_id={self.user_id}, rating={self.rating})>"
    
    def __str__(self) -> str:
        return f"Feedback {self.id} - Rating: {self.rating}/5"
