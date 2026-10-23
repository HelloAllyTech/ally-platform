"""API dependencies for authentication and authorization."""

import httpx
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.constants import AUTH_VERIFY_ENDPOINT
from app.core.logger import get_logger

logger = get_logger(__name__)

security = HTTPBearer()


async def verify_api_key(
    x_api_key: str = Header(..., description="API key for backend-to-backend auth"),
) -> None:
    """
    Validate the x-api-key header for backend-to-backend authentication.

    Compares the provided key against the configured CORE_SERVICE_API_KEY.

    Args:
        x_api_key: The API key from the request header.

    Raises:
        HTTPException 401: If the API key is missing or invalid.
    """
    if x_api_key != settings.X_API_KEY:
        logger.warning("Invalid API key provided for backend-to-backend auth")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """
    Verify JWT token by calling the backend auth service.

    Extracts the Bearer token from the Authorization header and forwards it
    to the configured CORE_SERVICE_BASE_URL + AUTH_VERIFY_ENDPOINT for validation.

    Args:
        credentials: The HTTP Bearer credentials extracted by FastAPI.

    Returns:
        dict: The verified token payload / user info from the auth service.

    Raises:
        HTTPException 401: If the token is invalid or expired.
        HTTPException 403: If the token is valid but lacks required permissions.
        HTTPException 503: If the auth service is unreachable.
    """
    token = credentials.credentials

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{settings.CORE_SERVICE_BASE_URL}{AUTH_VERIFY_ENDPOINT}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "x-api-key": settings.CORE_SERVICE_API_KEY,
                },
                json={
                    "permissions": [
                        "view:scenario-voices",
                    ]
                },
            )

        if response.status_code == 200:
            data = response.json()
            logger.info("Token verified successfully")
            return data

        # Extract error detail from auth service response
        try:
            error_data = response.json()
            detail = error_data.get("detail", error_data.get("message", response.text))
        except Exception:
            detail = response.text or "Authentication failed"

        logger.warning(
            f"Token verification failed: status={response.status_code}, "
            f"detail={detail}"
        )

        raise HTTPException(
            status_code=response.status_code,
            detail=detail,
            headers=(
                {"WWW-Authenticate": "Bearer"} if response.status_code == 401 else None
            ),
        )

    except httpx.RequestError as e:
        logger.exception(f"Auth service unreachable: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )
