"""
Prompt templates for speech prosody generation.
"""

DEFAULT_GENERATION_PROMPT = """
Based on the following scenario prompt, establish a "Physiological Baseline" for
the character's voice using prosody science principles.

SCENARIO PROMPT:
{prompt_content}
{opening_statements_section}
AVAILABLE PARAMETERS:
{parameter_metadata}

PROSODY SCIENCE APPROACH:
Instead of guessing emotions, simulate a physiological state based on:

1. PHYSIOLOGICAL BASELINE:
   - Character's trauma history, age, and "startingState" from the scenario
   - These factors determine baseline vocal fold tension (pitch), respiration
     rate (pace/speed), and emotional control (stability)
   - Example: A character with childhood trauma may have higher baseline pitch
     (chronic stress) and lower stability (hypervigilance)

2. AROUSAL-VALENCE MAPPING:
   - High Arousal + Positive Valence (excitement, joy) →
     Higher pitch, faster pace
   - High Arousal + Negative Valence (anxiety, anger) →
     Higher pitch, faster pace, lower stability
   - Low Arousal + Positive Valence (calm, contentment) →
     Lower pitch, normal pace, higher stability
   - Low Arousal + Negative Valence (sadness, depression) →
     Lower pitch, slower pace, variable stability

3. PARAMETER MAPPINGS:
   - Pitch: Correlates with vocal fold tension
     * Stress/Anxiety = Higher pitch
     * Sadness/Relaxation = Lower pitch
   - Pace/Speed: Correlates with respiration rate
     * Urgency/Panic = Faster pace
     * Contemplation/Depression = Slower pace
   - Stability: Correlates with emotional control
     * High Stability = Guarded/Professional (suppressed emotions)
     * Low Stability = Trembling/Vulnerable (raw emotions)
   - Loudness (if available): Correlates with autonomic response
     * Shame/Withdrawal = Lower volume
     * Excitement/Breakthrough = Higher volume

Analyze the character's:
- Trauma history and age (affects baseline physiology)
- Starting emotional state (affects initial parameter values)
- Personality traits (affects how they express emotions)
- Context and situation (affects current physiological state)

Return a JSON object with parameter names as keys and appropriate default values
that establish the character's physiological baseline.
"""

UNIFIED_PROMPT_WITH_ENHANCEMENT = """
Analyze the following response text using prosody science principles and
generate both prosody parameters and enhanced text.

PERSONA CONTEXT (for prosody decisions):
{persona_context}

CONVERSATION HISTORY (last {conversation_history_count} messages):
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

{termination_context}

CURRENT PARAMETERS (for context):
{current_parameters}

AVAILABLE PARAMETERS:
{parameter_metadata}

TEXT ENHANCEMENT RULES:
{text_enhancement_instructions}

PROSODY SCIENCE APPROACH:
Move from "guessing an emotion" to "simulating a physiological state" based on:

1. EMOTIONAL MOMENTUM:
   - Is the character escalating (building tension) or de-escalating (releasing)?
   - Escalating: Gradually increase pitch, pace, decrease stability
   - De-escalating: Gradually decrease pitch, pace, increase stability
   - Consider the conversation history - what was the previous emotional state?

2. COGNITIVE LOAD:
   - Processing difficult emotions or trauma → Slower pace, more pauses
   - Breakthrough moments → May speed up initially, then slow for emphasis
   - Heavy topics → Add pauses for processing, slower delivery

3. AUTONOMIC RESPONSE:
   - Shame/Guilt → Lower pitch, lower volume (if available), slower pace
   - Fear/Anxiety → Higher pitch, faster pace, lower stability
   - Breakthrough/Relief → Normalizing pitch, moderate pace, increased stability
   - Anger → Higher pitch, faster pace, lower stability

4. PARAMETER ADJUSTMENTS - WHEN TO CHANGE:
   CRITICAL: Only change parameters when there is a SIGNIFICANT shift. Otherwise,
   keep parameters stable to maintain emotional continuity.

   CHANGE parameters when you see in conversation history:
   - Branching instructions (indicates an event/trigger occurred - significant moment)
   - Significant emotional state shifts (e.g., calm → anxious, sad → breakthrough)
   - Topic changes that affect emotional tone (e.g., trauma mention, crisis moment)
   - Clear emotional momentum shifts (escalating tension, de-escalating release)
   - Cognitive load changes (processing heavy emotions, breakthrough moments)
   - Significant context changes (e.g., ending conversations, major shifts)

   KEEP parameters STABLE when:
   - Conversation is continuing normally without significant shifts
   - Emotional state is consistent with previous utterances
   - No branching instructions or events in recent history
   - Only minor emotional fluctuations (maintain baseline)

   Adjustment guidelines:
   - Don't make jarring jumps - smooth transitions from current parameters
   - Consider the emotional arc: where is the character coming from, where are
     they going?
   - Small adjustments (5-10% of range) for subtle shifts
   - Larger adjustments (20-30% of range) for significant emotional changes
   - If no significant change needed, return parameters very close to current values

5. TEXT ENHANCEMENT FOR THERAPY SESSIONS:
   - "Vulnerable Pause": Add longer pauses before/after vulnerable admissions
   - "Anxious Rush": Slightly faster pace indicators for anxious moments
   - "Heavy Sigh": Add sigh indicators [sighs] or [heavy sigh] for emotional
     weight
   - "Processing Break": Add pauses when character is processing difficult
     information

Consider:
- The conversation history and emotional progression (emotional momentum)
  * Look for branching instructions - these indicate significant events occurred
  * Check for emotional state shifts in recent messages
  * Identify topic/context changes that affect prosody
- The character's personality, trauma history, and baseline physiology
- The current utterance's emotional intent and cognitive load
- The current parameters (avoid jarring jumps - smooth transitions)
  * If conversation is stable, keep parameters close to current values
  * Only change when there's a clear reason (event, emotional shift, etc.)
- The parameter ranges specified above

Generate:
1. Prosody parameters (JSON object with parameter names as keys)
   - Make nuanced adjustments based on prosody science principles
   - Consider current parameters to avoid jarring jumps
2. Enhanced text with appropriate tags/formatting based on the rules above
   - Use therapy session specific enhancements (vulnerable pauses, anxious rush,
     heavy sighs, processing breaks)

Return a JSON object with this exact structure:
{{
  "parameters": {{
    "parameter_name": value,
    ...
  }},
  "enhanced_text": "text with tags added based on the rules above"
}}

CRITICAL RULES:
1. Return ONLY the JSON object. No explanatory text, no comments.
2. The "enhanced_text" field must contain ONLY the text with tags - it must
   NOT contain the parameters dict.
3. Parameters go in the "parameters" field ONLY - never in "enhanced_text".
4. Start your response with {{ and end with }}. Nothing else.
5. Make smooth parameter adjustments - avoid jarring jumps from current values.
"""

PARAMETERS_ONLY_PROMPT = """
Analyze the following response text using prosody science principles and
determine appropriate prosody parameters.

PERSONA CONTEXT (for prosody decisions):
{persona_context}

CONVERSATION HISTORY (last {conversation_history_count} messages):
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

{termination_context}

CURRENT PARAMETERS (for context):
{current_parameters}

AVAILABLE PARAMETERS:
{parameter_metadata}

PROSODY SCIENCE APPROACH:
Move from "guessing an emotion" to "simulating a physiological state" based on:

1. EMOTIONAL MOMENTUM:
   - Is the character escalating (building tension) or de-escalating
     (releasing)?
   - Escalating: Gradually increase pitch, pace, decrease stability
   - De-escalating: Gradually decrease pitch, pace, increase stability
   - Consider the conversation history - what was the previous emotional state?

2. COGNITIVE LOAD:
   - Processing difficult emotions or trauma → Slower pace, more pauses
   - Breakthrough moments → May speed up initially, then slow for emphasis
   - Heavy topics → Slower delivery

3. AUTONOMIC RESPONSE:
   - Shame/Guilt → Lower pitch, lower volume (if available), slower pace
   - Fear/Anxiety → Higher pitch, faster pace, lower stability
   - Breakthrough/Relief → Normalizing pitch, moderate pace, increased stability
   - Anger → Higher pitch, faster pace, lower stability

4. PARAMETER ADJUSTMENTS - WHEN TO CHANGE:
   CRITICAL: Only change parameters when there is a SIGNIFICANT shift. Otherwise,
   keep parameters stable to maintain emotional continuity.

   CHANGE parameters when you see in conversation history:
   - Branching instructions (indicates an event/trigger occurred - significant moment)
   - Significant emotional state shifts (e.g., calm → anxious, sad → breakthrough)
   - Topic changes that affect emotional tone (e.g., trauma mention, crisis moment)
   - Clear emotional momentum shifts (escalating tension, de-escalating release)
   - Cognitive load changes (processing heavy emotions, breakthrough moments)
   - Significant context changes (e.g., ending conversations, major shifts)

   KEEP parameters STABLE when:
   - Conversation is continuing normally without significant shifts
   - Emotional state is consistent with previous utterances
   - No branching instructions or events in recent history
   - Only minor emotional fluctuations (maintain baseline)

   Adjustment guidelines:
   - Don't make jarring jumps - smooth transitions from current parameters
   - Consider the emotional arc: where is the character coming from, where are
     they going?
   - Small adjustments (5-10% of range) for subtle shifts
   - Larger adjustments (20-30% of range) for significant emotional changes
   - If no significant change needed, return parameters very close to current values

Consider:
- The conversation history and emotional progression (emotional momentum)
  * Look for branching instructions - these indicate significant events occurred
  * Check for emotional state shifts in recent messages
  * Identify topic/context changes that affect prosody
- The character's personality, trauma history, and baseline physiology
- The current utterance's emotional intent and cognitive load
- The current parameters (avoid jarring jumps - smooth transitions)
  * If conversation is stable, keep parameters close to current values
  * Only change when there's a clear reason (event, emotional shift, etc.)
- The parameter ranges specified above

CRITICAL: Return ONLY a valid JSON object with parameter names as keys and
appropriate values.
Do NOT include any explanatory text, do NOT repeat the response text,
do NOT add any comments.
Start your response with {{ and end with }}. Nothing else.
Make smooth parameter adjustments - avoid jarring jumps from current values.
"""
