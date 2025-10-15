"""
User API endpoints with UserManagementService and dependency injection.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query

from app.core.dependencies import get_user_management_service, get_pagination_params, verify_admin_api_key
from app.core.services import UserManagementService
from app.core.exceptions import NotFoundException, UserAlreadyExistsException
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.utils import get_logger

logger = get_logger(__name__)

router = APIRouter()


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> UserResponse:
    """Create a new user with ACID transaction support. Requires admin API key."""
    try:
        user = await user_service.create_user(
            email=str(user_data.email),
            name=user_data.name,
            refresh_token=None
        )
        return UserResponse.model_validate(user)
    except UserAlreadyExistsException as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=type(e).__name__
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=type(e).__name__
        )
    except Exception as e:
        # Log the unexpected error for debugging
        logger.exception(f"Unexpected error creating user {user_data.email}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while creating the user"
        )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> UserResponse:
    """Get user by ID. Requires admin API key."""
    user = await user_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return UserResponse.model_validate(user)


@router.get("/", response_model=List[UserResponse])
async def get_users(
    pagination: dict = Depends(get_pagination_params),
    include_deleted: bool = Query(False, description="Include soft-deleted users"),
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> List[UserResponse]:
    """Get all users with pagination. Requires admin API key."""
    users = await user_service.get_all_users(
        include_deleted=include_deleted,
        limit=pagination["limit"],
        offset=pagination["offset"]
    )
    return [UserResponse.model_validate(user) for user in users]


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> UserResponse:
    """Update user information with ACID transaction support. Requires admin API key."""
    try:
        user = await user_service.update_user(
            user_id=user_id,
            name=user_data.name,
            email=str(user_data.email) if user_data.email else None
        )
        return UserResponse.model_validate(user)
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=type(e).__name__
        )
    except UserAlreadyExistsException as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=type(e).__name__
        )
    except Exception as e:
        # Log the unexpected error for debugging
        logger.exception(f"Unexpected error updating user {user_data.email}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while updating the user"
        )


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> dict:
    """Soft delete a user. Requires admin API key."""
    try:
        success = await user_service.soft_delete_user(user_id)
        return {"message": "User deleted successfully"}
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=type(e).__name__
        )
    except Exception as e:
        # Log the unexpected error for debugging
        logger.exception(f"Unexpected error deleting user {user_id}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while deleting the user"
        )


@router.patch("/{user_id}/refresh-token")
async def update_refresh_token(
    user_id: int,
    refresh_token: Optional[str] = None,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> dict:
    """Update user's refresh token. Requires admin API key."""
    user = await user_service.update_refresh_token(user_id, refresh_token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return {"message": "Refresh token updated successfully"}


@router.post("/{user_id}/restore")
async def restore_user(
    user_id: int,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> dict:
    """Restore a soft-deleted user. Requires admin API key."""
    try:
        success = await user_service.restore_user(user_id)
        return {"message": "User restored successfully"}
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=type(e).__name__
        )
    except Exception as e:
        # Log the unexpected error for debugging
        logger.exception(f"Unexpected error restoring user {user_id}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while restoring the user"
        )


@router.delete("/{user_id}/permanent")
async def hard_delete_user(
    user_id: int,
    user_service: UserManagementService = Depends(get_user_management_service),
    _: bool = Depends(verify_admin_api_key)
) -> dict:
    """Permanently delete a user from the database. Requires admin API key."""
    try:
        success = await user_service.hard_delete_user(user_id)
        return {"message": "User permanently deleted"}
    except NotFoundException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=type(e).__name__
        )
    except Exception as e:
        # Log the unexpected error for debugging
        logger.exception(f"Unexpected error hard deleting user {user_id}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while hard deleting the user"
        )
