"""
Database initialization utilities with singleton DatabaseManager.
"""

import logging

from app.core.database.manager import db_manager
from app.core.config import settings

logger = logging.getLogger(__name__)


async def initialize_database() -> None:
    """Initialize the database connection and create tables."""
    try:
        # Initialize the database manager (singleton)
        await db_manager.initialize()
        
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def close_database() -> None:
    """Close database connections gracefully."""
    try:
        await db_manager.close()
        logger.info("Database connections closed")
    except Exception as e:
        logger.error(f"Error closing database connections: {e}")
        raise
