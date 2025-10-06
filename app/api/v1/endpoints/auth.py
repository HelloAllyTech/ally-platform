"""
Authentication endpoints.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import settings
from app.core.dependencies import get_authentication_service, get_current_user, get_user_management_service
from app.core.services import AuthenticationService, UserManagementService
from app.core.exceptions import NotFoundException
from app.core.models import User
from app.schemas.auth import (
    SendOTPRequest, SendOTPResponse,  VerifyOTPRequest, VerifyOTPResponse, RefreshTokenRequest,
    RefreshTokenResponse, LogoutRequest, LogoutResponse
)
from app.utils import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Email-OTP Authentication Endpoints

@router.post("/send-otp", response_model=SendOTPResponse)
async def send_otp(
    request: SendOTPRequest,
    auth_service: AuthenticationService = Depends(get_authentication_service),
    user_service: UserManagementService = Depends(get_user_management_service)
) -> SendOTPResponse:
    """
    Send OTP to email address for existing users only.
    
    Args:
        request: Email address to send OTP to
        auth_service: Authentication service dependency
        user_service: User management service dependency
        
    Returns:
        SendOTPResponse: Confirmation message with expiry info
        
    Raises:
        HTTPException: If user doesn't exist or OTP generation fails
    """
    # Validate that user exists in database
    user = await user_service.get_user_by_email(str(request.email))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User with this email address does not exist"
        )

    try:
        success = await auth_service.generate_and_send_otp(str(request.email))
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send OTP. Please try again."
            )
        
        return SendOTPResponse(
            message="OTP sent successfully",
            email=str(request.email),
            expires_in_minutes=10
        )
    except Exception as e:
        logger.exception(f"Unexpected error sending OTP to {request.email}: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while sending OTP"
        )


@router.post("/verify-otp", response_model=VerifyOTPResponse)
async def verify_otp(
    request: VerifyOTPRequest,
    auth_service: AuthenticationService = Depends(get_authentication_service)
) -> VerifyOTPResponse:
    """
    Verify OTP and complete login for existing users only.
    
    Args:
        request: Email and OTP code
        auth_service: Authentication service dependency
        
    Returns:
        VerifyOTPResponse: User info and authentication tokens
        
    Raises:
        HTTPException: If OTP verification fails or user doesn't exist
    """
    try:
        user, tokens = await auth_service.verify_otp_and_login(
            str(request.email),
            request.code
        )
        
        if not user or not tokens:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired OTP"
            )
        
        return VerifyOTPResponse(
            message="Login successful",
            user_id=user.id,
            email=user.email,
            name=user.name,
            tokens=tokens
        )
        
    except NotFoundException as e:
        # User doesn't exist
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=type(e).__name__
        )


@router.post("/refresh", response_model=RefreshTokenResponse)
async def refresh_token(
    request: RefreshTokenRequest,
    auth_service: AuthenticationService = Depends(get_authentication_service)
) -> RefreshTokenResponse:
    """
    Refresh access token using refresh token.
    
    Args:
        request: Refresh token
        auth_service: Authentication service dependency
        
    Returns:
        RefreshTokenResponse: New access and refresh tokens
        
    Raises:
        HTTPException: If refresh token is invalid
    """
    tokens = await auth_service.refresh_access_token(request.refresh_token)
    
    if not tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )
    
    return RefreshTokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # Convert to seconds
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    current_user: User = Depends(get_current_user),
    auth_service: AuthenticationService = Depends(get_authentication_service)
) -> LogoutResponse:
    """
    Logout user by invalidating refresh token.
    
    Args:
        current_user: Current authenticated user from JWT token
        auth_service: Authentication service dependency
        
    Returns:
        LogoutResponse: Logout confirmation
        
    Raises:
        HTTPException: If logout fails
    """
    try:
        success = await auth_service.logout_user(current_user.id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to logout user"
            )
        
        return LogoutResponse(
            message="Logged out successfully"
        )
        
    except Exception as e:
        logger.exception(f"Unexpected error during logout: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Logout failed: {type(e).__name__}"
        )
