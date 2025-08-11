"""
FastAPI dependency injection functions for the application.
"""

from typing import AsyncGenerator

from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database.manager import get_db_session
from app.core.models.user import User
from app.core.services.user_management import UserManagementService
from app.core.services.authentication import AuthenticationService

# Security scheme for JWT tokens
security = HTTPBearer()

# Database Dependencies
# Use get_db_session directly - it's already a proper FastAPI dependency
get_database_session = get_db_session

# Service Dependencies
def get_user_management_service(
    session: AsyncSession = Depends(get_database_session)
) -> UserManagementService:
    """
    FastAPI dependency for getting UserManagementService instance.
    
    Args:
        session: Database session from dependency injection
        
    Returns:
        UserManagementService instance with injected database session
    """
    return UserManagementService(session)


def get_authentication_service(
    session: AsyncSession = Depends(get_database_session)
) -> AuthenticationService:
    """
    FastAPI dependency for getting AuthenticationService instance.
    
    Args:
        session: Database session from dependency injection
        
    Returns:
        AuthenticationService instance with injected database session
    """
    return AuthenticationService(session)


# Authentication Dependencies 
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthenticationService = Depends(get_authentication_service)
) -> User:
    """
    FastAPI dependency for getting current authenticated user from JWT token.
    
    Args:
        credentials: HTTP Bearer token credentials
        auth_service: AuthenticationService instance
        
    Returns:
        Current user object
        
    Raises:
        HTTPException: If token is invalid or user not found
    """
    token = credentials.credentials
    user = await auth_service.get_current_user_from_token(token)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    FastAPI dependency for getting current active (non-deleted) user.
    
    Args:
        current_user: Current user from authentication
        
    Returns:
        Current active user object
        
    Raises:
        HTTPException: If user is deleted/inactive
    """
    if current_user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated",
        )
    
    return current_user


# Admin Dependencies
async def verify_admin_api_key(
    x_api_key: str = Header(..., description="Admin API key")
) -> bool:
    """
    FastAPI dependency for verifying admin API key.
    
    Args:
        x_api_key: API key from X-API-Key header
        
    Returns:
        True if API key is valid
        
    Raises:
        HTTPException: If API key is invalid
    """
    if x_api_key != settings.ADMIN_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return True


# Pagination Dependencies
def get_pagination_params(
    limit: int = 20,
    offset: int = 0
) -> dict:
    """
    FastAPI dependency for pagination parameters.
    
    Args:
        limit: Maximum number of items to return (default: 20, max: 100)
        offset: Number of items to skip (default: 0)
        
    Returns:
        Dictionary with pagination parameters
    """
    # Ensure reasonable limits
    limit = min(max(1, limit), 100)
    offset = max(0, offset)
    
    return {
        "limit": limit,
        "offset": offset
    }
