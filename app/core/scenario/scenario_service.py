"""
Service for managing scenarios.
"""
from app.utils.logger import get_logger
from typing import List

from app.core.scenario.scenario_types import ScenarioType
from app.schemas.scenario import Scenario

logger = get_logger(__name__)

# Hardcoded scenarios with the required fields
SCENARIOS = [
    Scenario(
        unique_id=ScenarioType.HOPELESS_MALE,
        title="Hopeless Male, 40",
        short_description="A 40-year-old male is experiencing deep hopelessness.",
        long_description="He feels overwhelmed by ongoing personal and professional failures, believes his situation won't improve, and is withdrawing socially. He's showing signs of resignation and low self-worth. Your goal is to explore his thoughts gently, offer validation, and begin rebuilding his sense of agency and hope.",
        cover_image=None
    ),
    Scenario(
        unique_id=ScenarioType.BURNOUT_TECH_PROFESSIONAL,
        title="Burned-Out Tech Professional, 29",
        short_description="A 29-year-old tech worker is showing signs of burnout.",
        long_description="He works long hours under constant pressure and feels emotionally drained. He mentions irritability, sleep problems, and questioning the purpose of his work. Your aim is to validate his exhaustion, explore boundaries and recovery, and help him reconnect with his values and needs.",
        cover_image=None
    ),
    Scenario(
        unique_id=ScenarioType.ANXIOUS_STUDENT,
        title="Anxious Student, 21",
        short_description="A 21-year-old college student struggles with anxiety.",
        long_description="She constantly fears failure, overthinks social interactions, and experiences frequent panic attacks before exams. She's beginning to avoid classes. Your aim is to help her manage her anxious thoughts, introduce coping strategies, and encourage small steps toward re-engaging with academic and social life.",
        cover_image=None
    ),
    Scenario(
        unique_id=ScenarioType.DEPRESSED_WORKING_MOTHER,
        title="Depressed Working Mother, 35",
        short_description="A 35-year-old mother feels emotionally numb and overwhelmed.",
        long_description="She juggles a demanding job and parenting, but recently feels like she's failing at both. She's lost interest in activities she once enjoyed, sleeps poorly, and feels persistently low. Your task is to validate her experience, explore sources of pressure, and introduce small ways to rebuild motivation.",
        cover_image=None
    ),
    Scenario(
        unique_id=ScenarioType.GRIEVING_RETIRED_MALE,
        title="Grieving Retired Male, 68",
        short_description="A recently retired 68-year-old man is grieving his spouse.",
        long_description="After losing his partner of 40 years, he feels purposeless and alone. Retirement has further amplified his sense of isolation. He finds it hard to talk to family. Your goal is to hold space for his grief while gently exploring ways to reconnect and find meaning again.",
        cover_image=None
    ),
    Scenario(
        unique_id=ScenarioType.SUICIDAL_TEEN,
        title="A young girl experiencing suicidal thoughts",
        short_description="A 17 year old teen expresses suicidal thoughts.",
        long_description="She feels misunderstood at home, isolated at school, and says life \"feels pointless.\" She hints at not wanting to wake up. Your goal is to assess her safety non-judgmentally, build rapport, and identify immediate steps to ensure safety while offering hope and emotional connection.",
        cover_image=None
    )
]


class ScenarioService:
    """Service for managing scenarios."""
    
    async def get_all_scenarios(self) -> List[Scenario]:
        """
        Get all available scenarios.
        
        Returns:
            List[Scenario]: List of all scenarios.
        """
        logger.info(f"Returning {len(SCENARIOS)} scenarios")
        return SCENARIOS


# Create a singleton instance
scenario_service = ScenarioService()
