"""
Scenario endpoints.
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth.auth_service import auth_service
from app.core.scenario.scenario_service import scenario_service
from app.schemas.scenario import Scenario, ScenarioList
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("", response_model=ScenarioList)
async def get_scenarios() -> ScenarioList:
    """
    Get all available scenarios.
    
    Args:
        session_id: The session ID from the JWT token.
        
    Returns:
        ScenarioList: List of all available scenarios.
    """
    try:
        scenarios = await scenario_service.get_all_scenarios()
        return ScenarioList(scenarios=scenarios)
    except Exception as e:
        logger.exception(f"Failed to get scenarios: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get scenarios: {str(e)}"
        )
