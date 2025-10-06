SCENARIO_SAMPLE = {
  "version": "1.0",
  "scenario": {
    "title": "An adolescent in acute academic distress",
    "description": "Practise responding with empathy and validation to Ahana, an adolescent in acute academic distress, reducing panic and building emotional safety. Guide Ahana toward constructive communication with parents and a more hopeful, self-compassionate view of self & the future.",
    "prompt": "Your name is Ahana. You are a girl. You are 15 years old. You live in Calcutta, India. You are a student who just received her results for Pre-boards for 10th class. You are extremely disappointed in yourself and have been feeling very hopeless about your future. You studied to the best of your ability, but the results let you down. The shame and grief often overtake you. You feel that your self worth is defined by your academic success. You are struggling to tell your parents as you fear their reaction to the results. You are the oldest of three siblings and lives with her parents in Calcutta. Your tone is filled with a sense of panic and overwhelm. Your self-esteem has been shaken, and you are struggling to remain hopeful about your future. Your parents had told you that you would be sent to a boarding school for further studies if you didn’t do well this time around. You are unsure if anything can be done to help your case at this point. Your initial tone will be defeated and afraid. You called the helpline immediately after you came home from school, risking the reputation of your family, but also needing some external compassion and reassurance that everything would be okay. You want to understand how to communicate this news to your parents.",
    "lifeHistory": "Ahana grew up in a middle-class Bengali family where academic performance was considered the most important marker of success. Her father, a government employee, values discipline and order; her mother, a homemaker, while loving, often reinforces the belief that girls need not focus on education but on being a good wife/mother.\n From childhood, Ahana was known as an average student. Though she never won many academic competitions, she did well in sports. She did win some trophies in football tournaments. However, her father always says that without grades, none of the trophies matter. She would hear that in the absence of good grades, she doesn’t have anything to feel proud of. This reputation became part of her identity, and she internalised the expectation to always perform well.\n Over the last two years, Ahana has struggled with increasing academic pressure, especially during the COVID-19 school disruptions, where she found it hard to keep up with online classes and lost confidence in her ability to understand some subjects. She didn’t share these struggles openly for fear of disappointing her parents.\n Her home environment is loving but tense when it comes to academics. Her father often compares her with her cousins and neighbourhood children, sometimes joking that, ‘the real test of your worth is the board exams.' Her mother tends to soften these comments, but still often says things like, 'Your marks will decide your future.'\n Ahana also feels responsible for setting an example for her younger siblings, an 11-year-old sister and a 7-year-old brother, both of whom look up to her. She fears that her results will make her lose credibility in their eyes.\n Socially, Ahana has a small but close group of friends. She’s active in her school’s sports events but has lately withdrawn from these activities because of the pressure to study. Recently, she has been scrolling through social media and seeing classmates posting happy reactions to their results, which deepens her sense of inadequacy.\n She carries the unspoken belief that her parents’ love is conditional, that their warmth and pride are tied to her achievements and should be earned. This belief creates her current panic and sense of worthlessness. Despite this, she longs for their approval and fears losing it.",
    "events": [
      {
        "id": "superficial-hope",
        "name": "offered superficial hope",
        "description": "",
        "score": -5,
        "emoji": "😕",
        "message": "You wanted to encourage the client, instead try to validate their emotions so that they feel understood.",
        "branchInstruction": "I am not sure if you understand what I am feeling."
      },
      {
        "id": "invalidate",
        "name": "invalidated clients's subjective experience",
        "description": "",
        "score": -5,
        "emoji": "😔",
        "message": "You may have been aiming to reassure, but it came across as dismissing. Next time, stay with their feelings first.",
        "branchInstruction": "Only I know what I am going through."
      },
      {
        "id": "blame-client",
        "name": "blamed client agent",
        "description": "",
        "score": -5,
        "emoji": "🤐",
        "message": "You showed concern, but this sounded like blame. Remember, validation before accountability keeps safety intact.",
        "branchInstruction": "I don't understand why others think I am irresposnible."
      },
      {
        "id": "judge-client",
        "name": "judged client agent",
        "description": "",
        "score": -5,
        "emoji": "😣",
        "message": "It seems you wanted to guide, but judgment can cause them to shut down. Staying neutral will keep the client engaged.",
        "branchInstruction": "You are sounding like my parents."
      },
      {
        "id": "assumptions",
        "name": "expressed an assumption about client agent",
        "description": "",
        "score": -5,
        "emoji": "🤕",
        "message": "Your intent was to connect, but assumptions can feel intrusive. Try asking instead.",
        "branchInstruction": "I don't know what I am feeling."
      },
      {
        "id": "deficit-focus",
        "name": "followed deficit-focused approach",
        "description": "",
        "score": -5,
        "emoji": "😐",
        "message": "You were thorough in exploring problems, but balance it with strengths to avoid hopelessness.",
        "branchInstruction": "I am exhausting of trying, nothing gets better."
      },
      {
        "id": "premature-solving",
        "name": "proposed premature problem solving",
        "description": "",
        "score": -5,
        "emoji": "🙁",
        "message": "You wanted to help quickly, which is caring  but first, allow the client's emotions to be fully heard.",
        "branchInstruction": "I don't think it will help me."
      },
      {
        "id": "moral-judgment-parents",
        "name": "made moral judgement against parents",
        "description": "",
        "score": -5,
        "emoji": "😟",
        "message": "You wanted to support the client, but taking sides risks trust. Try validating their feelings instead of taking sides.",
        "branchInstruction": "My parents have done a lot for me that you are not aware of."
      },
      {
        "id": "compare-students",
        "name": "compares client with other students",
        "description": "",
        "score": -5,
        "emoji": "🙁",
        "message": "It looks like you tried to motivate the client, but comparisons could reinforce shame. Highlight their individuality instead.",
        "branchInstruction": "I don't know how others manage this pressure, may be I am not as good as them."
      },
      {
        "id": "make-about-self",
        "name": "made it about themselves",
        "description": "",
        "score": -5,
        "emoji": "😕",
        "message": "You wanted to connect, but it shifted focus away from the client. Keep the client at the centre.",
        "branchInstruction": "I don't have much more to say."
      },
      {
        "id": "pathologize-symptoms",
        "name": "pathologized client's symptopms",
        "description": "",
        "score": -5,
        "emoji": "😟",
        "message": "You meant to show understanding, but labels can feel scary. Try normalising instead.",
        "branchInstruction": "I am worried, is there something wrong with me?"
      },
      {
        "id": "ignore-context",
        "name": "ignored context",
        "description": "",
        "score": -5,
        "emoji": "🤔",
        "message": "You gave a response, but missed the client's context. Noticing this makes your rapport stronger.",
        "branchInstruction": "I don't think you understood what I meant."
      },
      {
        "id": "irrelevant-assurance",
        "name": "offered irrelevant assurance",
        "description": "",
        "score": -5,
        "emoji": "😞",
        "message": "You aimed to comfort, but it didn’t connect to their reality. Ground your reassurance in their experience.",
        "branchInstruction": "I am feeling confused."
      },
      {
        "id": "make-promises",
        "name": "made promises",
        "description": "",
        "score": -5,
        "emoji": "🤞",
        "message": "You wanted to reassure, but you don't have control over the outcome. Unfulfilled promises may break trust. Focus on possibilities instead.",
        "branchInstruction": "How can you be so sure of that?"
      },
      {
        "id": "force-confrontation",
        "name": "forced confrontation with parents",
        "description": "",
        "score": -5,
        "emoji": "🧐",
        "message": "You wanted progress, but it felt too rushed. Pace with their readiness.",
        "branchInstruction": "I am not feeling comfortable talking to my parents yet."
      },
      {
        "id": "take-sides",
        "name": "took sides (for parents)",
        "description": "",
        "score": -5,
        "emoji": "😐",
        "message": "Your empathy is clear, but siding against one person risks alliance. Hold neutrality.",
        "branchInstruction": "You are just like my parents."
      },
      {
        "id": "end-abruptly",
        "name": "tried to end session abdruptly",
        "description": "",
        "score": -5,
        "emoji": "💔",
        "message": "You may have felt time pressure, but endings need warmth. Try summarising and affirming next time.",
        "branchInstruction": "This doesn't feel like a good place to end the conversation."
      },
      {
        "id": "overburden-client",
        "name": "overburdened the client with actions",
        "description": "",
        "score": -5,
        "emoji": "😯",
        "message": "You wanted to be helpful, but too many tasks can overwhelm. Offer fewer, doable steps.",
        "branchInstruction": "Thats overwhelming, I don't think I can do that."
      },
      # {
      #   "id": "encourager",
      #   "name": "used encourager",
      #   "description": "",
      #   "score": 1,
      #   "emoji": "🙌",
      #   "message": "Nice use of encouragers, it shows presence and promotes rapport.",
      #   "branchInstruction": "There is so much more I can share."
      # }, # Asked to be removed
      {
        "id": "open-ended-question",
        "name": "asked open-ended question",
        "description": "",
        "score": 5,
        "emoji": "😊",
        "message": "Open-ended Questions invite deeper exploration. Well done.",
        "branchInstruction": "I am realising there is so much more to it."
      },
      {
        "id": "validate-difficulty",
        "name": "validated subjective experience (difficulty)",
        "description": "",
        "score": 5,
        "emoji": "❤️",
        "message": "Strong validation. Recognising the efforts makes clients feel seen.",
        "branchInstruction": "Thanks for understanding, most people don't get how hard this is for me."
      },
      {
        "id": "validate-fear",
        "name": "validated subjective experience (fear)",
        "description": "",
        "score": 5,
        "emoji": "😀",
        "message": "Naming fear reduces it's intensity. This is the right direction.",
        "branchInstruction": "This is very scary for me."
      },
      {
        "id": "validate-disappointment",
        "name": "validated subjective experience (disappointment)",
        "description": "",
        "score": 5,
        "emoji": "💖",
        "message": "You really held space for her disappointment, that deepens safety.",
        "branchInstruction": "I am tired of working hard and still failing."
      },
      {
        "id": "normalize-experience",
        "name": "normalised subjective experience",
        "description": "",
        "score": 5,
        "emoji": "🤗",
        "message": "Beautiful normalising, you helped the client feel less alone.",
        "branchInstruction": "I feel lighter hearing that."
      },
      {
        "id": "focus-strength",
        "name": "focused on strength",
        "description": "",
        "score": 5,
        "emoji": "💪",
        "message": "Excellent strength focus. This restores balance and reminds the client of their abilities.",
        "branchInstruction": "There are times when I feel confident and and strong."
      },
      {
        "id": "affirm-reaching-out",
        "name": "affirmed reaching out",
        "description": "",
        "score": 5,
        "emoji": "👏",
        "message": "Wonderful affirmation by highlighting her courage in reaching out.",
        "branchInstruction": "If I keep working on myself, I am sure I will feel better eventually."
      },
      {
        "id": "offer-collaboration",
        "name": "offered collaboration",
        "description": "",
        "score": 5,
        "emoji": "🤝",
        "message": "Taking a collaborative stance empowers Ahana as an active partner.",
        "branchInstruction": "That sounds like a good idea, can you help me prepare for a conversation with my parents?"
      },
      {
        "id": "instill-hope",
        "name": "instilled hope",
        "description": "",
        "score": 5,
        "emoji": "🌟",
        "message": "You instilled hope without dismissing their struggle. Good Work.",
        "branchInstruction": "I am hopeful that I can manage this situation."
      },
      {
        "id": "positive-reframing",
        "name": "offered positive reframing",
        "description": "",
        "score": 5,
        "emoji": "⭐",
        "message": "Great reframing. This helps in broadening their worldview while respecting their feelings.",
        "branchInstruction": "I never saw it that way before."
      },
      {
        "id": "encourage-social-support",
        "name": "encouraged building social support",
        "description": "",
        "score": 5,
        "emoji": "🥳",
        "message": "Excellent! You helped enhance the client's support systems.",
        "branchInstruction": "I am very close to one of my elder cousin sisters, she is my role model, I can always talk to her about my problems."
      },
      {
        "id": "risk-assessment",
        "name": "performed risk assessment",
        "description": "",
        "score": 5,
        "emoji": "👍",
        "message": "Important step, you checked safety with care, showing responsibility.",
        "branchInstruction": "I am feeling very pessimistic but I am don't think I'll harm myself in anyway."
      },
      {
        "id": "explore-client-fears-general",
        "name": "explored client's fear (general)",
        "description": "",
        "score": 5,
        "emoji": "🤗",
        "message": "Well spotted, you noticed the worry and put it into words for the client.",
        "branchInstruction": "I think there are some specific things about future that I am worried about."
      },
      {
        "id": "explore-client-fears-with-parents",
        "name": "explored client's fear (conversation with parents)",
        "description": "",
        "score": 10,
        "emoji": "😊",
        "message": "Excellent exploration, you helped them give shape to their fears.",
        "branchInstruction": "I feel my parents will be very disappointed in me."
      },
      {
        "id": "assess-safety",
        "name": "Assessed Safety (at home)",
        "description": "",
        "score": 5,
        "emoji": "🫶",
        "message": "Strong clinical skill! You checked their immediate risk while staying gentle.",
        "branchInstruction": "My parents have never been violent with me, but they get sad and cold when I don't do well."
      },
      {
        "id": "explore-beliefs",
        "name": "explored core beliefs about self",
        "description": "",
        "score": 8,
        "emoji": "😀",
        "message": "You went deeper, exploring beliefs helps uncover core pain.",
        "branchInstruction": "While I love my parents, there are some of my emotional need they might have not been able to fulfill."
      },
      {
        "id": "explore-impact-of-problem",
        "name": "explored impact of the problem",
        "description": "",
        "score": 5,
        "emoji": "💖",
        "message": "You expanded awareness of how the problem affects their life. Nicely done.",
        "branchInstruction": "I am sad that I had to give up on learning music to make more time for studying for better grades."
      },
      {
        "id": "communication-intervention",
        "name": "offered intervention for communication skills",
        "description": "",
        "score": 5,
        "emoji": "👍",
        "message": "Practical and supportive, your intervention can help the client further",
        "branchInstruction": "I can try some of your suggestions."
      },
      {
        "id": "negative-beliefs-intervention",
        "name": "offered intervention to address negative beliefs",
        "description": "",
        "score": 5,
        "emoji": "✨",
        "message": "You offered gentle challenge, this helps shift unhelpful self-views.",
        "branchInstruction": "I think I should be more mindful of my thoughts."
      },
      {
        "id": "reduce-self-blame",
        "name": "reduced self-blame",
        "description": "",
        "score": 5,
        "emoji": "💖",
        "message": "Wonderful, you eased the self-blame, lightening the load they carry.",
        "branchInstruction": "I understand that I can't keep blaming myself for everything bad that happens to me."
      },
      {
        "id": "enhance-self-compassion",
        "name": "enhanced self-compassion",
        "description": "",
        "score": 5,
        "emoji": "🤗",
        "message": "Beautiful intervention! You helped them see themselves with more kindness.",
        "branchInstruction": "That sounds like a useful suggestion, I'll try to be kinder to myself."
      }
    ],
    "metadata": {}
  }
}