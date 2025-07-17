"""
Authentication service.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.core.config import settings
from app.core.session.session_store import store_session, get_session
from app.schemas.auth import TokenData

# Constants
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = timedelta(minutes=settings.TOKEN_EXPIRE_MINUTES)  # 30 minutes

# Security
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


class AuthService:
    """Authentication service."""
    
    @staticmethod
    def verify_secret_key(secret_key: str) -> bool:
        """
        Verify if the provided secret key matches the one in settings.
        
        Args:
            secret_key: The secret key to verify.
            
        Returns:
            bool: True if the secret key is valid, False otherwise.
        """
        return secret_key == settings.SECRET_KEY

    @staticmethod
    def generate_session_id() -> str:
        """
        Generate a new session ID.

        Returns:
            str: The generated session ID.
        """
        return str(uuid.uuid4())
    
    @staticmethod
    def create_access_token(
        session_id: str,
        data: Dict[str, Any], 
        expires_delta: timedelta = ACCESS_TOKEN_EXPIRE_MINUTES
    ) -> str:
        """
        Create a JWT access token.
        
        Args:
            data: The data to encode in the token.
            expires_delta: Optional expiration time delta.
            session_id: Optional session ID. If not provided, a new one will be generated.
            
        Returns:
            str: The encoded JWT token.
        """
        to_encode = data.copy()
        
        # Store the session
        store_session(session_id)

        expire = datetime.now(timezone.utc) + expires_delta

        to_encode.update({"session_id": session_id, "exp": expire})
        encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
        
        return encoded_jwt
    
    @staticmethod
    async def get_current_session_id(token: str = Depends(oauth2_scheme)) -> str:
        """
        Get the current session ID from the JWT token.
        
        Args:
            token: The JWT token.
            
        Returns:
            str: The session ID.
            
        Raises:
            HTTPException: If the token is invalid, expired, or the session doesn't exist.
        """
        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
            session_id: str = payload.get("session_id")
            
            if session_id is None:
                raise credentials_exception
                
            # Verify session exists
            session = get_session(session_id)
            if session is None:
                raise credentials_exception
                
            return session_id
            
        except JWTError:
            raise credentials_exception


# Create a singleton instance
auth_service = AuthService()
