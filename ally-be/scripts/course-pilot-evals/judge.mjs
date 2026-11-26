// The independent plan judge, shared by run.mjs and plan-eval.mjs.
/**
 * An independent judge of the proposed blueprint: a different, stronger model than the critic
 * under test, with its own fixed rubric, so "the critic found nothing" can be checked rather than
 * trusted. Minutes are checked in code. Returns blocking/minor issues.
 */
export async function judgeBlueprint(apiKey, savedBrief, blueprint) {
  if (!blueprint?.sections?.length) return null;
  const items = blueprint.sections.flatMap((s) => s.items ?? []);
  const minutes = items.reduce(
    (a, i) => a + (Number(i.estimatedMinutes) || 0),
    0,
  );
  const target = Number(savedBrief?.shape?.durationMinutes) || null;
  const compact = {
    title: blueprint.title,
    sections: blueprint.sections.map((s) => ({
      title: s.title,
      purpose: s.purpose,
      items: (s.items ?? []).map((i) => ({
        type: i.type,
        title: i.title,
        minutes: i.estimatedMinutes,
        // Transfer marks first and whole: a cut-off spec hid them from the judge.
        ...(i.spec?.transfer ? { transfer: i.spec.transfer } : {}),
        ...(i.spec?.targetSkills ? { targetSkills: i.spec.targetSkills } : {}),
        spec: JSON.stringify(i.spec ?? i.brief ?? {}).slice(0, 400),
        rule: i.completionCriteria,
      })),
    })),
  };
  const rubric = [
    'assessment: the final assessed item matches the brief assessment kind and carries its pass rule',
    'skill_targets: every skill target is practised; a B2 target has practice on a new scenario of similar difficulty, a B3 target on a harder one',
    'progression: practice goes from easier to harder, explanation before practice',
    'reflection: some reflection or debrief follows roleplay practice',
    'fit: items suit the learners (level, context) and serve the outcome; nothing off-topic or duplicated',
  ];
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a senior instructional designer judging a course plan for helper/counsellor training against its brief. ' +
            'Judge EACH criterion below exactly once, as pass or fail:\n- ' +
            rubric.join('\n- ') +
            '\nThe skill targets, exactly as in the brief (judge only these levels; a B2 target needs no harder scenario): ' +
            JSON.stringify(
              (savedBrief?.skillTargets ?? []).map((t) => ({
                skill: t.skill,
                a: t.a,
                b: t.b,
              })),
            ) +
            '. Items may carry "transfer" (practised | new-similar | new-harder) and "targetSkills"; use them as the plan\'s own statement of what each practice is. ' +
            'Return JSON {"criteria":[{"criterion": one of assessment|skill_targets|progression|reflection|fit, "pass": true|false, ' +
            '"severity": "blocking"|"minor" (only when pass is false; blocking = a trainer would send the plan back), ' +
            '"evidence": "one sentence quoting the plan or brief"}]}. A criterion the plan meets is pass:true, never a problem.',
        },
        {
          role: 'user',
          content: `BRIEF:\n${JSON.stringify(savedBrief)}\n\nPLAN:\n${JSON.stringify(compact)}`,
        },
      ],
    }),
  });
  const body = await res.json();
  let issues = [];
  let verdicts = [];
  try {
    verdicts = JSON.parse(body.choices[0].message.content).criteria ?? [];
    issues = verdicts
      .filter((v) => v.pass === false)
      .map((v) => ({
        criterion: v.criterion,
        severity: v.severity === 'blocking' ? 'blocking' : 'minor',
        problem: v.evidence,
      }));
  } catch {}
  if (target && Math.abs(minutes - target) > target * 0.2) {
    issues.push({
      criterion: 'minutes',
      severity: 'blocking',
      problem: `items add up to ${minutes} min for a ${target}-min course`,
    });
  }
  return {
    minutes,
    target,
    blocking: issues.filter((i) => i.severity === 'blocking').length,
    minor: issues.filter((i) => i.severity !== 'blocking').length,
    issues,
    verdicts,
  };
}
