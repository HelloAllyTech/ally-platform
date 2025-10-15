"""
User Management Service with ACID transaction support.
"""

from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError

from app.core.models import User
from app.core.exceptions import NotFoundException, UserAlreadyExistsException


class UserManagementService:
    """Service class for managing user operations with ACID transaction support."""
    
    def __init__(self, session: AsyncSession):
        """Initialize the service with database session."""
        self.session = session
    
    async def create_user(
        self,
        email: str,
        name: str,
        refresh_token: Optional[str] = None
    ) -> User:
        """
        Create a new user with ACID transaction support.
        
        Args:
            email: User's email address
            name: User's full name
            refresh_token: Optional refresh token
            
        Returns:
            Created User object
            
        Raises:
            UserAlreadyExistsException: If user with email already exists
        """
        try:
            # Check if user already exists
            existing_user = await self.get_user_by_email(email)
            if existing_user:
                raise UserAlreadyExistsException(f"User with email {email} already exists")
            
            user = User(
                email=email,
                name=name,
                refresh_token=refresh_token
            )
            
            self.session.add(user)
            await self.session.flush()  # Flush to get the ID without committing
            await self.session.refresh(user)
            
            return user
            
        except IntegrityError as e:
            raise UserAlreadyExistsException(f"User with email {email} already exists") from e
    
    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """
        Get user by ID (excluding soft-deleted users).
        
        Args:
            user_id: User's unique identifier
            
        Returns:
            User object if found, None otherwise
        """
        stmt = select(User).where(
            User.id == user_id,
            User.deleted_at.is_(None)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def get_user_by_email(self, email: str) -> Optional[User]:
        """
        Get user by email (excluding soft-deleted users).
        
        Args:
            email: User's email address
            
        Returns:
            User object if found, None otherwise
        """
        stmt = select(User).where(
            User.email == email,
            User.deleted_at.is_(None)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def get_all_users(
        self,
        include_deleted: bool = False,
        limit: Optional[int] = None,
        offset: Optional[int] = None
    ) -> List[User]:
        """
        Get all users with optional pagination.
        
        Args:
            include_deleted: Whether to include soft-deleted users
            limit: Maximum number of users to return
            offset: Number of users to skip
            
        Returns:
            List of User objects
        """
        stmt = select(User)
        
        if not include_deleted:
            stmt = stmt.where(User.deleted_at.is_(None))
        
        stmt = stmt.order_by(User.created_at.desc())
        
        if limit:
            stmt = stmt.limit(limit)
        if offset:
            stmt = stmt.offset(offset)
        
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    async def update_user(
        self,
        user_id: int,
        name: Optional[str] = None,
        email: Optional[str] = None
    ) -> User:
        """
        Update user information with ACID transaction support.
        
        Args:
            user_id: User's unique identifier
            name: New name (optional)
            email: New email (optional)
            
        Returns:
            Updated User object
            
        Raises:
            NotFoundException: If user doesn't exist
            UserAlreadyExistsException: If email already exists for another user
        """
        # First check if user exists
        user = await self.get_user_by_id(user_id)
        if not user:
            raise NotFoundException(f"User with ID {user_id} not found")
        
        update_data = {}
        if name is not None:
            update_data['name'] = name
        if email is not None:
            # Check if email is already taken by another user
            existing_user = await self.get_user_by_email(email)
            if existing_user and existing_user.id != user_id:
                raise UserAlreadyExistsException(f"User with email {email} already exists")
            update_data['email'] = email
        
        if not update_data:
            return user
        
        try:
            stmt = (
                update(User)
                .where(User.id == user_id, User.deleted_at.is_(None))
                .values(**update_data)
                .returning(User)
            )
            result = await self.session.execute(stmt)
            updated_user = result.scalar_one_or_none()
            
            if updated_user:
                await self.session.refresh(updated_user)
            
            return updated_user
            
        except IntegrityError as e:
            if 'email' in update_data:
                raise UserAlreadyExistsException(f"User with email {email} already exists") from e
            raise
    
    async def update_refresh_token(
        self,
        user_id: int,
        refresh_token: Optional[str]
    ) -> Optional[User]:
        """
        Update user's refresh token.
        
        Args:
            user_id: User's unique identifier
            refresh_token: New refresh token (can be None to clear)
            
        Returns:
            Updated User object if found, None otherwise
        """
        stmt = (
            update(User)
            .where(User.id == user_id, User.deleted_at.is_(None))
            .values(refresh_token=refresh_token)
            .returning(User)
        )
        result = await self.session.execute(stmt)
        updated_user = result.scalar_one_or_none()
        
        if updated_user:
            await self.session.refresh(updated_user)
        
        return updated_user
    
    async def soft_delete_user(self, user_id: int) -> bool:
        """
        Soft delete a user by setting deleted_at timestamp.
        
        Args:
            user_id: User's unique identifier
            
        Returns:
            True if user was deleted
            
        Raises:
            NotFoundException: If user doesn't exist
        """
        # First check if user exists
        user = await self.get_user_by_id(user_id)
        if not user:
            raise NotFoundException(f"User with ID {user_id} not found")
        
        stmt = (
            update(User)
            .where(User.id == user_id, User.deleted_at.is_(None))
            .values(deleted_at=datetime.now(timezone.utc))
        )
        result = await self.session.execute(stmt)
        return result.rowcount > 0
    
    async def restore_user(self, user_id: int) -> bool:
        """
        Restore a soft-deleted user by clearing deleted_at timestamp.
        
        Args:
            user_id: User's unique identifier
            
        Returns:
            True if user was restored
            
        Raises:
            NotFoundException: If user doesn't exist or is not soft-deleted
        """
        # First check if user exists and is soft-deleted
        stmt_check = select(User).where(User.id == user_id)
        result_check = await self.session.execute(stmt_check)
        user = result_check.scalar_one_or_none()
        
        if not user:
            raise NotFoundException(f"User with ID {user_id} not found")
        
        if user.deleted_at is None:
            raise NotFoundException(f"User with ID {user_id} is not deleted")
        
        stmt = (
            update(User)
            .where(User.id == user_id, User.deleted_at.is_not(None))
            .values(deleted_at=None)
        )
        result = await self.session.execute(stmt)
        return result.rowcount > 0
    
    async def hard_delete_user(self, user_id: int) -> bool:
        """
        Permanently delete a user from the database.
        
        Args:
            user_id: User's unique identifier
            
        Returns:
            True if user was deleted
            
        Raises:
            NotFoundException: If user doesn't exist
        """
        # First check if user exists (including soft-deleted users)
        stmt_check = select(User).where(User.id == user_id)
        result_check = await self.session.execute(stmt_check)
        user = result_check.scalar_one_or_none()
        
        if not user:
            raise NotFoundException(f"User with ID {user_id} not found")
        
        stmt = delete(User).where(User.id == user_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0
