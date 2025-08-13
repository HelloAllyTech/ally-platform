"""
Authentication Service for email-OTP login flow with JWT tokens.
"""

import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from jose import jwt, JWTError

from app.core.database import DatabaseManager
from app.core.models import User, OTP
from app.core.config import settings
from app.core.exceptions import NotFoundException
from app.core.services.email_service import EmailService
from app.schemas.auth import TokenPair


class AuthenticationService:
    """Service class for handling authentication operations."""
    
    def __init__(self, session: AsyncSession):
        """Initialize the service with database session."""
        self.session = session
        self.email_service = EmailService()
    
    # OTP Management
    
    async def generate_and_send_otp(self, email: str) -> bool:
        """
        Generate OTP for email and send it via AWS SES.
        
        Args:
            email: Email address to send OTP to
            
        Returns:
            True if OTP was generated and sent successfully
        """
        # Clean up any existing OTPs for this email
        await self._cleanup_expired_otps(email)
        
        # Generate 4-digit OTP
        otp_code = self._generate_otp_code()
        
        # Set expiry time (10 minutes from now)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        # Create OTP record
        otp = OTP(
            email=email,
            code=otp_code,
            expires_at=expires_at
        )
        
        try:
            self.session.add(otp)
            await self.session.flush()  # Get the ID without committing
            
            # Send OTP email via SES
            email_sent = await self.email_service.send_otp_email(email, otp_code)
            
            if not email_sent:
                # If email sending fails, rollback the OTP creation
                await self.session.rollback()
                return False
            
            return True
            
        except Exception as e:
            await self.session.rollback()
            print(f"Failed to generate OTP: {e}")
            return False
    
    async def verify_otp_and_login(self, email: str, code: str) -> Tuple[Optional[User], Optional[TokenPair]]:
        """
        Verify OTP and perform login for existing users only.
        
        Args:
            email: Email address
            code: OTP code to verify
            
        Returns:
            Tuple of (User, TokenPair) or (None, None) if verification failed
            
        Raises:
            NotFoundException: If user doesn't exist in the system
        """
        # Find valid OTP
        otp = await self._get_valid_otp(email, code)
        if not otp:
            return None, None
        
        # Mark OTP as verified
        otp.is_verified = True
        otp.verified_at = datetime.now(timezone.utc)
        
        # Get existing user only - don't create new users
        user = await self._get_existing_user(email)
        if not user:
            raise NotFoundException(f"User with email {email} does not exist. Please contact administrator.")
        
        # Generate token pair
        tokens = await self._generate_token_pair(user)
        if not tokens:
            return None, None
        
        # Update user's refresh token
        user.refresh_token = self._hash_token(tokens.refresh_token)
        
        try:
            await self.session.flush()
            return user, tokens
            
        except Exception as e:
            await self.session.rollback()
            print(f"Failed to complete login: {e}")
            return None, None
    
    async def refresh_access_token(self, refresh_token: str) -> Optional[TokenPair]:
        """
        Generate new access token and refresh token using refresh token.
        
        Args:
            refresh_token: Valid refresh token
            
        Returns:
            TokenPair with new access and refresh tokens or None if refresh token is invalid
        """
        try:
            # Decode refresh token to get user info
            payload = jwt.decode(refresh_token, settings.SECRET_KEY, algorithms=["HS256"])
            user_id = payload.get("user_id")
            
            if not user_id:
                return None
            
            # Find user and verify refresh token
            user = await self._get_user_by_id(user_id)
            if not user or not user.refresh_token:
                return None
            
            # Verify refresh token hash
            if not self._verify_token_hash(refresh_token, user.refresh_token):
                return None
            
            # Generate new tokens
            access_token = self._create_access_token(user_id, user.email)
            new_refresh_token = self._create_refresh_token(user_id, user.email)
            
            # Update refresh token in database
            hashed_refresh_token = self._hash_token(new_refresh_token)
            stmt = (
                update(User)
                .where(User.id == user_id)
                .values(refresh_token=hashed_refresh_token)
            )
            await self.session.execute(stmt)
            
            return TokenPair(
                access_token=access_token,
                refresh_token=new_refresh_token,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # Convert to seconds
            )
            
        except JWTError:
            return None
    
    def verify_access_token(self, token: str) -> Optional[Dict]:
        """
        Verify access token and extract user information.
        
        Args:
            token: JWT access token
            
        Returns:
            User information dict or None if token is invalid
        """
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
            
            # Check if it's an access token
            if payload.get("type") != "access":
                return None
            
            user_id = payload.get("user_id")
            email = payload.get("email")
            
            if not user_id or not email:
                return None
            
            return {
                "user_id": user_id,
                "email": email
            }
            
        except JWTError:
            return None
    
    async def get_current_user_from_token(self, token: str) -> Optional[User]:
        """
        Get current user from access token.
        
        Args:
            token: JWT access token
            
        Returns:
            User object or None if token is invalid or user not found
        """
        token_data = self.verify_access_token(token)
        if not token_data:
            return None
        
        return await self._get_user_by_id(token_data["user_id"])
    
    async def logout_user(self, user_id: int) -> bool:
        """
        Logout user by removing refresh token.
        
        Args:
            user_id: User ID to logout
            
        Returns:
            True if logout successful
        """
        try:
            stmt = (
                update(User)
                .where(User.id == user_id)
                .values(refresh_token=None)
            )
            result = await self.session.execute(stmt)
            return result.rowcount > 0
            
        except Exception as e:
            print(f"Failed to logout user: {e}")
            return False
    
    # Private helper methods
    
    def _generate_otp_code(self) -> str:
        """Generate a 4-digit OTP code."""
        return f"{secrets.randbelow(10000):04d}"
    
    async def _cleanup_expired_otps(self, email: str) -> None:
        """Clean up expired or used OTPs for email."""
        cutoff_time = datetime.now(timezone.utc)
        
        stmt = delete(OTP).where(
            OTP.email == email,
            (OTP.expires_at < cutoff_time) | (OTP.is_verified == True)
        )
        await self.session.execute(stmt)
    
    async def _get_valid_otp(self, email: str, code: str) -> Optional[OTP]:
        """Get valid, unexpired OTP for email and code."""
        current_time = datetime.now(timezone.utc)
        
        stmt = select(OTP).where(
            OTP.email == email,
            OTP.code == code,
            OTP.is_verified == False,
            OTP.expires_at > current_time
        )
        
        result = await self.session.execute(stmt)
        otp = result.scalar_one_or_none()
        
        if otp:
            # Increment attempt count
            otp.attempts += 1
        
        return otp
    
    async def _get_existing_user(self, email: str) -> Optional[User]:
        """Get existing user."""
        stmt = select(User).where(User.email == email, User.deleted_at.is_(None))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get user by ID."""
        stmt = select(User).where(User.id == user_id, User.deleted_at.is_(None))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _generate_token_pair(self, user: User) -> Optional[TokenPair]:
        """Generate access and refresh token pair."""
        try:
            access_token = self._create_access_token(user.id, user.email)
            refresh_token = self._create_refresh_token(user.id, user.email)
            
            return TokenPair(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60  # Convert to seconds
            )
            
        except Exception as e:
            print(f"Failed to generate tokens: {e}")
            return None
    
    def _create_access_token(self, user_id: int, email: str) -> str:
        """Create JWT access token."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        payload = {
            "user_id": user_id,
            "email": email,
            "type": "access",
            "exp": expire
        }
        
        return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
    
    def _create_refresh_token(self, user_id: int, email: str) -> str:
        """Create JWT refresh token."""
        expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        
        payload = {
            "user_id": user_id,
            "email": email,
            "type": "refresh",
            "exp": expire
        }
        
        return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
    
    def _hash_token(self, token: str) -> str:
        """Hash token for secure storage."""
        return hashlib.sha256(token.encode()).hexdigest()
    
    def _verify_token_hash(self, token: str, stored_hash: str) -> bool:
        """Verify token against stored hash."""
        return hashlib.sha256(token.encode()).hexdigest() == stored_hash
