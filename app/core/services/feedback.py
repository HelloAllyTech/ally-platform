"""
Feedback service for managing user feedback operations.
"""

import logging
from typing import Optional, Tuple, List
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.core.models import Feedback, User
from app.schemas.feedback import FeedbackCreate, FeedbackResponse
from app.core.exceptions import NotFoundException

logger = logging.getLogger(__name__)


class FeedbackService:
    """Service for managing feedback operations."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_feedback(self, user_id: int, feedback_data: FeedbackCreate) -> Feedback:
        """
        Create new feedback for a user.
        
        Args:
            user_id: ID of the user providing feedback
            feedback_data: Feedback creation data
            
        Returns:
            Created feedback instance
            
        Raises:
            NotFoundException: If user doesn't exist
            ValueError: If neither rating nor comment is provided
        """
        logger.info(f"Creating feedback for user {user_id}")
        
        # Validate that at least one field is provided
        if feedback_data.rating is None and (feedback_data.comment is None or feedback_data.comment.strip() == ""):
            raise ValueError("At least one of rating or comment must be provided")
        
        # Verify user exists
        user_query = select(User).where(User.id == user_id, User.deleted_at.is_(None))
        user_result = await self.session.execute(user_query)
        user = user_result.scalar_one_or_none()
        
        if not user:
            logger.warning(f"User {user_id} not found for feedback creation")
            raise NotFoundException(f"User with ID {user_id} not found")
        
        # Create feedback
        feedback = Feedback(
            user_id=user_id,
            rating=feedback_data.rating,
            comment=feedback_data.comment,
            created_at=datetime.now(timezone.utc)
        )
        
        self.session.add(feedback)
        await self.session.flush()
        await self.session.refresh(feedback)
        
        logger.info(f"Created feedback {feedback.id} for user {user_id}")
        return feedback
    
    async def get_feedback_by_id(self, feedback_id: int) -> Optional[Feedback]:
        """
        Get feedback by ID.
        
        Args:
            feedback_id: ID of the feedback
            
        Returns:
            Feedback instance or None if not found
        """
        query = select(Feedback).options(selectinload(Feedback.user)).where(Feedback.id == feedback_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()
    
    async def get_user_feedback(self, user_id: int, page: int = 1, per_page: int = 10) -> Tuple[List[Feedback], int]:
        """
        Get paginated feedback for a specific user.
        
        Args:
            user_id: ID of the user
            page: Page number (1-indexed)
            per_page: Number of items per page
            
        Returns:
            Tuple of (feedback_list, total_count)
        """
        offset = (page - 1) * per_page
        
        # Get feedback with user info
        query = (
            select(Feedback)
            .options(selectinload(Feedback.user))
            .where(Feedback.user_id == user_id)
            .order_by(desc(Feedback.created_at))
            .offset(offset)
            .limit(per_page)
        )
        
        result = await self.session.execute(query)
        feedback_list = result.scalars().all()
        
        # Get total count
        count_query = select(func.count(Feedback.id)).where(Feedback.user_id == user_id)
        count_result = await self.session.execute(count_query)
        total_count = count_result.scalar()
        
        return list(feedback_list), total_count
    
    async def get_all_feedback(self, page: int = 1, per_page: int = 10) -> Tuple[List[Feedback], int]:
        """
        Get paginated feedback from all users (admin function).
        
        Args:
            page: Page number (1-indexed)
            per_page: Number of items per page
            
        Returns:
            Tuple of (feedback_list, total_count)
        """
        offset = (page - 1) * per_page
        
        # Get feedback with user info
        query = (
            select(Feedback)
            .options(selectinload(Feedback.user))
            .order_by(desc(Feedback.created_at))
            .offset(offset)
            .limit(per_page)
        )
        
        result = await self.session.execute(query)
        feedback_list = result.scalars().all()
        
        # Get total count
        count_query = select(func.count(Feedback.id))
        count_result = await self.session.execute(count_query)
        total_count = count_result.scalar()
        
        return list(feedback_list), total_count
    
    async def get_all_feedback_simple(self) -> List[Feedback]:
        """
        Get all feedback from all users without pagination (admin function).
        
        Returns:
            List of all feedback
        """
        # Get all feedback with user info, ordered by creation date (newest first)
        query = (
            select(Feedback)
            .options(selectinload(Feedback.user))
            .order_by(desc(Feedback.created_at))
        )
        
        result = await self.session.execute(query)
        feedback_list = result.scalars().all()
        
        return list(feedback_list)
    
    async def get_feedback_stats(self) -> dict:
        """
        Get feedback statistics (admin function).
        
        Returns:
            Dictionary with feedback statistics
        """
        # Total feedback count
        total_query = select(func.count(Feedback.id))
        total_result = await self.session.execute(total_query)
        total_count = total_result.scalar()
        
        # Total feedback with ratings
        rated_query = select(func.count(Feedback.id)).where(Feedback.rating.is_not(None))
        rated_result = await self.session.execute(rated_query)
        rated_count = rated_result.scalar()
        
        # Average rating (only for feedback with ratings)
        avg_query = select(func.avg(Feedback.rating)).where(Feedback.rating.is_not(None))
        avg_result = await self.session.execute(avg_query)
        avg_rating = avg_result.scalar()
        
        # Rating distribution (only for feedback with ratings)
        rating_dist_query = (
            select(Feedback.rating, func.count(Feedback.id))
            .where(Feedback.rating.is_not(None))
            .group_by(Feedback.rating)
            .order_by(Feedback.rating)
        )
        rating_dist_result = await self.session.execute(rating_dist_query)
        rating_distribution = {str(rating): count for rating, count in rating_dist_result.all()}
        
        return {
            "total_feedback": total_count,
            "total_rated_feedback": rated_count,
            "average_rating": float(avg_rating) if avg_rating else 0.0,
            "rating_distribution": rating_distribution
        }
