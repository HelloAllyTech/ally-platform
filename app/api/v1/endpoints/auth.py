"""
Authentication endpoints.
"""
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.core.auth.auth_service import auth_service, ACCESS_TOKEN_EXPIRE_MINUTES
from app.schemas.auth import Token, LoginRequest

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(login_request: LoginRequest) -> Any:
    """
    Login endpoint to get an access token.
    
    Args:
        login_request: The login request containing the secret key.
        
    Returns:
        Token: The access token.
        
    Raises:
        HTTPException: If the secret key is invalid.
    """
    # Verify the secret key
    if not auth_service.verify_secret_key(login_request.secret_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid secret key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Generate a session ID
    session_id = auth_service.generate_session_id()

    # Create access token with the session ID
    access_token_expires = ACCESS_TOKEN_EXPIRE_MINUTES
    access_token = auth_service.create_access_token(
        session_id=session_id,
        data={"sub": "admin"},  # Since we don't have a user database, we use a fixed username
        expires_delta=access_token_expires
    )
    
    return Token(access_token=access_token, token_type="bearer")
