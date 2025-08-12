"""
Feedback API endpoints.
"""

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.dependencies import (
    get_current_active_user,
    get_feedback_service,
    verify_admin_api_key
)
from app.core.models.user import User
from app.core.services.feedback import FeedbackService
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackResponse,
    SimpleFeedbackListResponse
)
from app.core.exceptions import NotFoundException

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    feedback_data: FeedbackCreate,
    current_user: User = Depends(get_current_active_user),
    feedback_service: FeedbackService = Depends(get_feedback_service)
):
    """
    Create new feedback for the authenticated user.
    
    Args:
        feedback_data: Feedback creation data
        current_user: Current authenticated user
        feedback_service: Feedback service instance
        
    Returns:
        Created feedback information
        
    Raises:
        HTTPException: If feedback creation fails
    """
    try:
        logger.info(f"Creating feedback for user {current_user.id}")
        
        feedback = await feedback_service.create_feedback(
            user_id=current_user.id,
            feedback_data=feedback_data
        )
        
        # Create response with user info
        response = FeedbackResponse(
            id=feedback.id,
            user_id=feedback.user_id,
            rating=feedback.rating,
            comment=feedback.comment,
            created_at=feedback.created_at,
            user_name=current_user.name,
            user_email=current_user.email
        )
        
        logger.info(f"Successfully created feedback {feedback.id}")
        return response
        
    except ValueError as e:
        logger.error(f"Validation error during feedback creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except NotFoundException as e:
        logger.error(f"User not found during feedback creation: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error creating feedback: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create feedback"
        )


@router.get("/", response_model=SimpleFeedbackListResponse, dependencies=[Depends(verify_admin_api_key)])
async def list_all_feedback(
    feedback_service: FeedbackService = Depends(get_feedback_service)
):
    """
    List all feedback (admin only).
    
    Args:
        feedback_service: Feedback service instance
        
    Returns:
        List of all feedback
        
    Raises:
        HTTPException: If listing fails
    """
    try:
        logger.info("Admin listing all feedback")
        
        feedback_list = await feedback_service.get_all_feedback_simple()
        
        # Convert to response format with user info
        feedback_responses = []
        for feedback in feedback_list:
            response = FeedbackResponse(
                id=feedback.id,
                user_id=feedback.user_id,
                rating=feedback.rating,
                comment=feedback.comment,
                created_at=feedback.created_at,
                user_name=feedback.user.name if feedback.user else None,
                user_email=feedback.user.email if feedback.user else None
            )
            feedback_responses.append(response)
        
        response = SimpleFeedbackListResponse(
            feedback=feedback_responses
        )
        
        logger.info(f"Successfully listed {len(feedback_responses)} feedback items")
        return response
        
    except Exception as e:
        logger.error(f"Error listing feedback: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list feedback"
        )
