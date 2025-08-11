"""
Database manager with async support and singleton session management.
"""

import asyncio
from typing import AsyncGenerator, Optional
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker, AsyncEngine

from app.core.config import settings
from app.core.models.base import Base


class DatabaseManager:
    """Singleton database manager for handling connections and sessions."""
    
    _instance: Optional['DatabaseManager'] = None
    _engine: Optional[AsyncEngine] = None
    _session_maker: Optional[async_sessionmaker] = None
    _lock = asyncio.Lock()
    
    def __new__(cls) -> 'DatabaseManager':
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def initialize(self) -> None:
        """Initialize the database engine and session maker."""
        if self._engine is not None:
            return
            
        async with self._lock:
            if self._engine is not None:
                return
                
            self._engine = create_async_engine(
                settings.DATABASE_URL,
                echo=settings.DATABASE_ECHO,
                future=True,
                pool_pre_ping=True,
            )
            
            self._session_maker = async_sessionmaker(
                self._engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=True,
                autocommit=False,
            )
    
    @property
    def engine(self) -> AsyncEngine:
        """Get the database engine."""
        if self._engine is None:
            raise RuntimeError("Database not initialized. Call initialize() first.")
        return self._engine
    
    @property
    def session_maker(self) -> async_sessionmaker:
        """Get the session maker."""
        if self._session_maker is None:
            raise RuntimeError("Database not initialized. Call initialize() first.")
        return self._session_maker
    
    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """
        Get a database session with proper ACID transaction handling.
        This ensures singleton session behavior within the same context.
        """
        async with self.session_maker() as session:
            try:
                # Begin transaction explicitly for ACID compliance
                await session.begin()
                yield session
                # Commit transaction if no exceptions occurred
                await session.commit()
            except Exception:
                # Rollback transaction on any exception
                await session.rollback()
                raise
            finally:
                # Ensure session is properly closed
                await session.close()

    async def close(self) -> None:
        """Close database connections gracefully."""
        if self._engine:
            await self._engine.dispose()
            self._engine = None
            self._session_maker = None


# Global database manager instance
db_manager = DatabaseManager()


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for getting database session.
    Provides singleton session management with ACID transaction support.
    """
    async with db_manager.get_session() as session:
        yield session
