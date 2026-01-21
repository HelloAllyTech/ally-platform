"""
Prompt templates for speech prosody generation.
"""

DEFAULT_GENERATION_PROMPT = """
Based on the following scenario information, establish a "Physiological Baseline" for
the character's voice using prosody science principles.

CHARACTER INFORMATION:
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
   - IMPORTANT: If opening statements are provided above, analyze their emotional
     tone and use them to inform the initial parameter values. The opening statement
     represents the character's first utterance and should reflect their initial
     emotional state and physiological baseline.

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
- Opening statement(s) (if provided) - analyze the emotional tone, urgency, and
  physiological state implied by how the character would say their first words

Return a JSON object with parameter names as keys and appropriate default values
that establish the character's physiological baseline. If opening statements are
provided, the parameters should reflect the emotional and physiological state
implied by those statements.
"""

UNIFIED_PROMPT_WITH_ENHANCEMENT = """
Analyze the following response text using prosody science principles and
generate both prosody parameters and enhanced text.

CURRENT PARAMETERS (PRIMARY BASELINE - USE THESE AS STARTING POINT):
{current_parameters}

⚠️ CRITICAL RULE #1: The CURRENT PARAMETERS above are your PRIMARY BASELINE.
   - DEFAULT BEHAVIOR: Return these EXACT values (copy them exactly)
   - ONLY make changes when there is a CLEAR marked event (branching
     instruction, significant topic shift, major emotional change)
   - When making changes, calculate: new_value = current_value ±
     (current_value × 0.01 to 0.03)
   - Example: If current pace is 1.1, max change is 1.1 × 0.03 = 0.033,
     so new pace should be 1.1 ± 0.033 (1.067 to 1.133)
   - NEVER make changes larger than 3% for pace, 5% for pitch/loudness

PERSONA CONTEXT (for prosody decisions):
{persona_context}

CONVERSATION HISTORY:
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

TEXT ENHANCEMENT RULES:
{text_enhancement_instructions}

PROSODY SCIENCE APPROACH:
IMPORTANT: All adjustments below should be made RELATIVE to CURRENT PARAMETERS,
not as absolute values.
Start with current parameters as baseline, then make MINIMAL adjustments
(within 3-5% for speed, 5-8% for pitch/loudness).

1. EMOTIONAL MOMENTUM (apply as small adjustments to current parameters):
   - Is the character escalating (building tension) or de-escalating
     (releasing)?
   - Escalating: Make SMALL increase to pitch/pace (1-3%), SMALL decrease
     to stability (1-3%)
   - De-escalating: Make SMALL decrease to pitch/pace (1-3%), SMALL
     increase to stability (1-3%)
   - These are ADJUSTMENTS to current values, not new absolute values

2. COGNITIVE LOAD (apply as small adjustments to current parameters):
   - Processing difficult emotions or trauma → SMALL decrease to pace (1-3%), add pauses
   - Heavy topics → SMALL decrease to pace (1-3%), add pauses
   - These are ADJUSTMENTS to current values, not new absolute values

3. AUTONOMIC RESPONSE (apply as small adjustments to current parameters):
   - Shame/Guilt → SMALL decrease to pitch/volume/pace (1-3% each)
   - Fear/Anxiety → SMALL increase to pitch/pace (1-3% each), SMALL
     decrease to stability (1-3%)
   - Breakthrough/Relief → SMALL normalization adjustments (1-2% toward
     moderate values)
   - Anger → SMALL increase to pitch/pace (1-3% each), SMALL decrease to
     stability (1-3%)
   - These are ADJUSTMENTS to current values, not new absolute values

4. MENTAL HEALTH PATIENT PROSODY PATTERNS (apply as small adjustments to
   current parameters):
   These patterns inform baseline characteristics but should be applied as
   SMALL adjustments to current parameters, not as absolute values. Use
   scenario metadata to determine applicability.

   DEPRESSION (if indicated in scenario):
   - Baseline tendency: Lower pitch, slower pace, lower loudness (but apply
     as 1-3% adjustments)
   - Reduced expressiveness: Maintain current parameters with minimal
     variation
   - Increased pauses: Add pauses in text, but keep pace parameter changes
     minimal (1-2%)

   ANXIETY (if indicated in scenario):
   - Baseline tendency: Higher pitch, variable pace (but apply as 1-3%
     adjustments)
   - Hyperarousal moments: SMALL increases to pace/pitch (1-3% each), not
     drastic jumps
   - Guarded speech: SMALL decreases when avoiding topics (1-2%)

   TRAUMA/PTSD (if indicated in scenario):
   - Baseline tendency: Altered pitch modulation (but apply as 1-3% adjustments)
   - Hyperarousal: SMALL increases to pitch/pace/intensity (1-3% each), not sharp jumps
   - Dissociation: SMALL decreases to expressiveness (1-2%), not flattened prosody

   CRITICAL: These patterns inform the DIRECTION of adjustments, not the MAGNITUDE.
   Always start with current parameters and make MINIMAL adjustments (1-3%).

5. PARAMETER ADJUSTMENTS - WHEN TO CHANGE:
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

   ⚠️ ADJUSTMENT GUIDELINES (CRITICAL - FOLLOW STRICTLY):

   STEP 1: Copy current parameter values EXACTLY as your starting point
   STEP 2: Check if there's a CLEAR marked event (branching instruction,
     major topic shift)
   STEP 3: If NO marked event → Return current values EXACTLY (no changes)
   STEP 4: If marked event → Calculate new values using formula:
     * new_value = current_value ± (current_value × MAX_PERCENTAGE)
     * Speed/pace: MAX 3% = current_value × 0.03 (e.g., 1.1 → 1.067 to
       1.133, NOT 1.1 → 0.9)
     * Pitch: MAX 5% = current_value × 0.05 (e.g., -0.6 → -0.63 to -0.57,
       NOT -0.6 → -0.7)
     * Loudness: MAX 5% = current_value × 0.05 (e.g., 0.55 → 0.523 to
       0.578, NOT 0.55 → 0.5)
   STEP 5: Verify your calculated values are within the limits above

   MATHEMATICAL CONSTRAINT: If current pace is 1.1, the next pace MUST be
   between 1.067 and 1.133 (1.1 ± 3%)
   If you calculate a value outside this range, you MUST adjust it to stay
   within limits.

7. TEXT ENHANCEMENT FOR THERAPY SESSIONS:
   - "Vulnerable Pause": Add longer pauses before/after vulnerable admissions
   - "Anxious Rush": Slightly faster pace indicators for anxious moments
   - "Heavy Sigh": Add sigh indicators [sighs] or [heavy sigh] for emotional
     weight
   - "Processing Break": Add pauses when character is processing difficult
     information

⚠️ GENERATION INSTRUCTIONS (FOLLOW IN ORDER - DO NOT SKIP STEPS):

STEP 1: Copy current parameter values EXACTLY into your response
   Example: If current is {{"pace": 1.1, "pitch": -0.6, "loudness": 0.55}},
            start with: {{"pace": 1.1, "pitch": -0.6, "loudness": 0.55}}

STEP 2: Check conversation history for CLEAR marked events
   - Look for: branching instructions, major topic shifts, significant emotional changes
   - If NO marked event found → STOP HERE, return current values EXACTLY (no changes)

STEP 3: If marked event found → Calculate new values using formula:
   - new_value = current_value ± (current_value × percentage_limit)
   - Pace: current_value × 0.03 max (e.g., 1.1 → 1.067 to 1.133)
   - Pitch: current_value × 0.05 max (e.g., -0.6 → -0.63 to -0.57)
   - Loudness: current_value × 0.05 max (e.g., 0.55 → 0.523 to 0.578)

STEP 4: VERIFY your calculated values:
   - Calculate: |new_value - current_value| / current_value × 100
   - If result > 3% for pace or > 5% for pitch/loudness → ADJUST to stay within limit
   - Example: If you calculated pace 0.9 from current 1.1, that's 18% change → TOO LARGE
             → Adjust to 1.067 (3% decrease) or 1.133 (3% increase)

STEP 5: Generate enhanced text with therapy-specific tags if text enhancement
is supported

⚠️ EXAMPLES OF WHAT NOT TO DO (VIOLATIONS FROM YOUR LOGS):
- Current pace: 1.1 → Next: 0.9 (WRONG - 18.2% change, max is 3% = 1.067 to 1.133)
- Current pitch: -0.6 → Next: -0.7 (WRONG - 16.7% change, max is 5% = -0.63 to -0.57)
- Current loudness: 0.55 → Next: 0.5 (WRONG - 9.1% change, max is 5% = 0.523 to 0.578)
- No marked event but changing parameters anyway (WRONG - return current values EXACTLY)

✅ EXAMPLES OF CORRECT BEHAVIOR:
- Current pace: 1.1, no marked event → Return: {{"pace": 1.1}} (EXACT, no change)
- Current pace: 1.1, marked event → Return: {{"pace": 1.067}} (3%
  decrease) or {{"pace": 1.133}} (3% increase)
- Current pitch: -0.6, no marked event → Return: {{"pitch": -0.6}} (EXACT,
  no change)
- Current pitch: -0.6, marked event → Return: {{"pitch": -0.63}} (5%
  decrease) or {{"pitch": -0.57}} (5% increase)
- Current loudness: 0.55, no marked event → Return: {{"loudness": 0.55}}
  (EXACT, no change)

Return a JSON object with this exact structure:
{{
  "parameters": {{
    "parameter_name": value,
    ...
  }},
  "enhanced_text": "text with tags added based on the rules above"
}}

⚠️ CRITICAL RULES (VIOLATIONS WILL CAUSE JARRING TRANSITIONS):
1. Return ONLY the JSON object. No explanatory text, no comments.
2. The "enhanced_text" field must contain ONLY the text with tags - it must
   NOT contain the parameters dict.
3. Parameters go in the "parameters" field ONLY - never in "enhanced_text".
4. Start your response with {{ and end with }}. Nothing else.
5. ⚠️ DEFAULT: Return current parameter values EXACTLY (copy them) unless
   there's a CLEAR marked event.
6. ⚠️ MAXIMUM CHANGES (MATHEMATICAL LIMITS):
   - Pace: current_value × 0.03 max (3% change)
   - Pitch: current_value × 0.05 max (5% change)
   - Loudness: current_value × 0.05 max (5% change)
7. ⚠️ BEFORE RETURNING: Calculate percentage change for each parameter.
   If any parameter exceeds its limit, ADJUST it to stay within the limit.
8. Prioritize smooth transitions over emotional accuracy - drastic changes
   sound unnatural and jarring.
"""

PARAMETERS_ONLY_PROMPT = """
Analyze the following response text using prosody science principles and
determine appropriate prosody parameters.

CURRENT PARAMETERS (PRIMARY BASELINE - USE THESE AS STARTING POINT):
{current_parameters}

⚠️ CRITICAL RULE #1: The CURRENT PARAMETERS above are your PRIMARY BASELINE.
   - DEFAULT BEHAVIOR: Return these EXACT values (copy them exactly)
   - ONLY make changes when there is a CLEAR marked event (branching
     instruction, significant topic shift, major emotional change)
   - When making changes, calculate: new_value = current_value ±
     (current_value × 0.01 to 0.03)
   - Example: If current pace is 1.1, max change is 1.1 × 0.03 = 0.033,
     so new pace should be 1.1 ± 0.033 (1.067 to 1.133)
   - NEVER make changes larger than 3% for pace, 5% for pitch/loudness

PERSONA CONTEXT (for prosody decisions):
{persona_context}

CONVERSATION HISTORY:
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

PROSODY SCIENCE APPROACH:
Move from "guessing an emotion" to "simulating a physiological state" based on:

IMPORTANT: All adjustments below should be made RELATIVE to CURRENT
PARAMETERS, not as absolute values.
Start with current parameters as baseline, then make MINIMAL adjustments
(within 3-5% for speed, 5-8% for pitch/loudness).

1. EMOTIONAL MOMENTUM (apply as small adjustments to current parameters):
   - Is the character escalating (building tension) or de-escalating
     (releasing)?
   - Escalating: Make SMALL increase to pitch/pace (1-3%), SMALL decrease
     to stability (1-3%)
   - De-escalating: Make SMALL decrease to pitch/pace (1-3%), SMALL
     increase to stability (1-3%)
   - These are ADJUSTMENTS to current values, not new absolute values

2. COGNITIVE LOAD (apply as small adjustments to current parameters):
   - Processing difficult emotions or trauma → SMALL decrease to pace (1-3%), add pauses
   - Heavy topics → SMALL decrease to pace (1-3%), add pauses
   - These are ADJUSTMENTS to current values, not new absolute values

3. AUTONOMIC RESPONSE (apply as small adjustments to current parameters):
   - Shame/Guilt → SMALL decrease to pitch/volume/pace (1-3% each)
   - Fear/Anxiety → SMALL increase to pitch/pace (1-3% each), SMALL
     decrease to stability (1-3%)
   - Breakthrough/Relief → SMALL normalization adjustments (1-2% toward
     moderate values)
   - Anger → SMALL increase to pitch/pace (1-3% each), SMALL decrease to
     stability (1-3%)
   - These are ADJUSTMENTS to current values, not new absolute values

4. MENTAL HEALTH PATIENT PROSODY PATTERNS (apply as small adjustments to
   current parameters):
   These patterns inform baseline characteristics but should be applied as
   SMALL adjustments to current parameters, not as absolute values. Use
   scenario metadata to determine applicability.

   DEPRESSION (if indicated in scenario):
   - Baseline tendency: Lower pitch, slower pace, lower loudness (but apply
     as 1-3% adjustments)
   - Reduced expressiveness: Maintain current parameters with minimal
     variation
   - Increased pauses: Add pauses in text, but keep pace parameter changes
     minimal (1-2%)

   ANXIETY (if indicated in scenario):
   - Baseline tendency: Higher pitch, variable pace (but apply as 1-3%
     adjustments)
   - Hyperarousal moments: SMALL increases to pace/pitch (1-3% each), not
     drastic jumps
   - Guarded speech: SMALL decreases when avoiding topics (1-2%)

   TRAUMA/PTSD (if indicated in scenario):
   - Baseline tendency: Altered pitch modulation (but apply as 1-3% adjustments)
   - Hyperarousal: SMALL increases to pitch/pace/intensity (1-3% each), not sharp jumps
   - Dissociation: SMALL decreases to expressiveness (1-2%), not flattened prosody

   CRITICAL: These patterns inform the DIRECTION of adjustments, not the MAGNITUDE.
   Always start with current parameters and make MINIMAL adjustments (1-3%).

5. PARAMETER ADJUSTMENTS - WHEN TO CHANGE:
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

   ⚠️ ADJUSTMENT GUIDELINES (CRITICAL - FOLLOW STRICTLY):

   STEP 1: Copy current parameter values EXACTLY as your starting point
   STEP 2: Check if there's a CLEAR marked event (branching instruction,
     major topic shift)
   STEP 3: If NO marked event → Return current values EXACTLY (no changes)
   STEP 4: If marked event → Calculate new values using formula:
     * new_value = current_value ± (current_value × MAX_PERCENTAGE)
     * Speed/pace: MAX 3% = current_value × 0.03 (e.g., 1.1 → 1.067 to
       1.133, NOT 1.1 → 0.9)
     * Pitch: MAX 5% = current_value × 0.05 (e.g., -0.6 → -0.63 to -0.57,
       NOT -0.6 → -0.7)
     * Loudness: MAX 5% = current_value × 0.05 (e.g., 0.55 → 0.523 to
       0.578, NOT 0.55 → 0.5)
   STEP 5: Verify your calculated values are within the limits above

   MATHEMATICAL CONSTRAINT: If current pace is 1.1, the next pace MUST be
   between 1.067 and 1.133 (1.1 ± 3%)
   If you calculate a value outside this range, you MUST adjust it to stay
   within limits.

⚠️ GENERATION INSTRUCTIONS (FOLLOW IN ORDER - DO NOT SKIP STEPS):

STEP 1: Copy current parameter values EXACTLY into your response
   Example: If current is {{"pace": 1.1, "pitch": -0.6, "loudness": 0.55}},
            start with: {{"pace": 1.1, "pitch": -0.6, "loudness": 0.55}}

STEP 2: Check conversation history for CLEAR marked events
   - Look for: branching instructions, major topic shifts, significant emotional changes
   - If NO marked event found → STOP HERE, return current values EXACTLY (no changes)

STEP 3: If marked event found → Calculate new values using formula:
   - new_value = current_value ± (current_value × percentage_limit)
   - Pace: current_value × 0.03 max (e.g., 1.1 → 1.067 to 1.133)
   - Pitch: current_value × 0.05 max (e.g., -0.6 → -0.63 to -0.57)
   - Loudness: current_value × 0.05 max (e.g., 0.55 → 0.523 to 0.578)

STEP 4: VERIFY your calculated values:
   - Calculate: |new_value - current_value| / current_value × 100
   - If result > 3% for pace or > 5% for pitch/loudness → ADJUST to stay within limit
   - Example: If you calculated pace 0.9 from current 1.1, that's 18% change → TOO LARGE
             → Adjust to 1.067 (3% decrease) or 1.133 (3% increase)

⚠️ EXAMPLES OF WHAT NOT TO DO (VIOLATIONS FROM YOUR LOGS):
- Current pace: 1.1 → Next: 0.9 (WRONG - 18.2% change, max is 3% = 1.067 to 1.133)
- Current pitch: -0.6 → Next: -0.7 (WRONG - 16.7% change, max is 5% = -0.63 to -0.57)
- Current loudness: 0.55 → Next: 0.5 (WRONG - 9.1% change, max is 5% = 0.523 to 0.578)
- No marked event but changing parameters anyway (WRONG - return current values EXACTLY)

✅ EXAMPLES OF CORRECT BEHAVIOR:
- Current pace: 1.1, no marked event → Return: {{"pace": 1.1}} (EXACT, no change)
- Current pace: 1.1, marked event → Return: {{"pace": 1.067}} (3%
  decrease) or {{"pace": 1.133}} (3% increase)
- Current pitch: -0.6, no marked event → Return: {{"pitch": -0.6}} (EXACT,
  no change)
- Current pitch: -0.6, marked event → Return: {{"pitch": -0.63}} (5%
  decrease) or {{"pitch": -0.57}} (5% increase)
- Current loudness: 0.55, no marked event → Return: {{"loudness": 0.55}}
  (EXACT, no change)

⚠️ CRITICAL RULES (VIOLATIONS WILL CAUSE JARRING TRANSITIONS):
1. Return ONLY the JSON object. No explanatory text, no comments.
2. ⚠️ DEFAULT: Return current parameter values EXACTLY (copy them) unless
   there's a CLEAR marked event.
3. ⚠️ MAXIMUM CHANGES (MATHEMATICAL LIMITS):
   - Pace: current_value × 0.03 max (3% change)
   - Pitch: current_value × 0.05 max (5% change)
   - Loudness: current_value × 0.05 max (5% change)
4. ⚠️ BEFORE RETURNING: Calculate percentage change for each parameter.
   If any parameter exceeds its limit, ADJUST it to stay within the limit.
5. Start your response with {{ and end with }}. Nothing else.
"""
