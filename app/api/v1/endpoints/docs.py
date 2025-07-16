"""
Documentation endpoints for Swagger UI and ReDoc.
"""
from fastapi import APIRouter
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html

from app.core.config import settings

router = APIRouter()


@router.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    """
    Custom Swagger UI endpoint.
    """
    return get_swagger_ui_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=f"{settings.PROJECT_NAME} - Swagger UI",
    )


@router.get("/redoc", include_in_schema=False)
async def redoc_html():
    """
    ReDoc endpoint.
    """
    return get_redoc_html(
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        title=f"{settings.PROJECT_NAME} - ReDoc",
    )
