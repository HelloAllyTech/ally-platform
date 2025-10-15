"""create-otp-table

Revision ID: 002
Revises: 001
Create Date: 2025-08-05 16:18:36.660881

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, Sequence[str], None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create OTP table
    op.create_table(
        'otps',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('email', sa.String(255), nullable=False, index=True),
        sa.Column('code', sa.String(6), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, default=0),
        sa.Column('is_verified', sa.Boolean(), nullable=False, default=False),
        sa.Column('is_expired', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text("timezone('UTC', now())")),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    )
    
    # Create indexes for better query performance
    # op.create_index('ix_otps_email', 'otps', ['email'])
    op.create_index('ix_otps_email_code', 'otps', ['email', 'code'])


def downgrade() -> None:
    """Downgrade schema."""
    # Drop indexes
    # op.drop_index('ix_otps_email_code', 'otps')
    # op.drop_index('ix_otps_email', 'otps')
    
    # Drop OTP table
    op.drop_table('otps')
