"""
Custom exceptions for the application.
"""

class NotFoundException(Exception):
    """Exception raised when a requested resource is not found."""
    
    def __init__(self, message: str = "Resource not found"):
        self.message = message
        super().__init__(self.message)


class UserAlreadyExistsException(Exception):
    """Exception raised when trying to create a user that already exists."""
    
    def __init__(self, message: str = "User already exists"):
        self.message = message
        super().__init__(self.message)


class AuthenticationException(Exception):
    """Exception raised for authentication-related errors."""
    
    def __init__(self, message: str = "Authentication failed"):
        self.message = message
        super().__init__(self.message)


class InvalidOTPException(AuthenticationException):
    """Exception raised when OTP verification fails."""
    
    def __init__(self, message: str = "Invalid or expired OTP"):
        super().__init__(message)


class TokenException(AuthenticationException):
    """Exception raised for token-related errors."""
    
    def __init__(self, message: str = "Token error"):
        super().__init__(message)
