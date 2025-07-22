"""
Enum for scenario types.
"""
from enum import Enum, auto


class ScenarioType(str, Enum):
    """Enum for different types of scenarios."""
    
    HOPELESS_MALE = "hopeless-male"
    BURNOUT_TECH_PROFESSIONAL = "burnout-tech-professional"
    ANXIOUS_STUDENT = "anxious-student"
    DEPRESSED_WORKING_MOTHER = "depressed-working-mother"
    GRIEVING_RETIRED_MALE = "grieving-retired-male"
    SUICIDAL_TEEN = "suicidal-teen"
