"""API routers."""

from fastapi import APIRouter

from app.api.scenario_report import router as scenario_report_router
from app.api.scenario_session_evaluation import (
    router as scenario_session_evaluation_router,
)
from app.v2v_tester.router import router as v2v_tester_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(scenario_report_router)
api_router.include_router(scenario_session_evaluation_router)
api_router.include_router(v2v_tester_router)

__all__ = ["api_router"]
