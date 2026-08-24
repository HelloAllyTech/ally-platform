"""The working memory in the languages it actually runs in.

Every test in this file failed before 2026-08-24. The word-extraction pattern
was `[\\w']+`, and Python's `\\w` does not match Indic combining vowel signs
(category Mn/Mc), so every Devanagari, Tamil, Kannada, Malayalam and Telugu word
was shredded at each matra and the 4-char floor deleted the fragments. Hindi
sentence in, zero content words out.

Nothing raised. Three features simply had nothing to say, in four of the five
languages this platform serves — and per the platform's own notes each Indic
language is roughly one deployment, so this was nearly all real traffic.

CLAUDE.md says it outright: a fix verified in English tells you very little about
Malayalam, Tamil or Kannada. The suite had no non-English test at all.
"""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.working_memory.recall import select
from app.core.working_memory.state import ClientWorkingMemory, Fact, Thread
from app.core.working_memory.store import ClientWorkingMemoryStore, same_fact
from app.core.working_memory.text import content_words, tokens
from app.core.working_memory.writeout import build_writeout, check_grounding

pytestmark = pytest.mark.unit

# "wife works nights, so we hardly see each other" in each language.
HI = "पत्नी रात में काम करती है इसलिए हम एक दूसरे को नहीं देखते"
MR = "बायको रात्री काम करते म्हणून आम्ही एकमेकांना पाहत नाही"
TA = "மனைவி இரவில் வேலை செய்கிறார் அதனால் நாங்கள் சந்திப்பதில்லை"
KN = "ಹೆಂಡತಿ ರಾತ್ರಿ ಕೆಲಸ ಮಾಡುತ್ತಾಳೆ ಆದ್ದರಿಂದ ನಾವು ಭೇಟಿಯಾಗುವುದಿಲ್ಲ"
ML = "ഭാര്യ രാത്രിയിൽ ജോലി ചെയ്യുന്നു അതിനാൽ ഞങ്ങൾ കാണുന്നില്ല"

ALL_SCRIPTS = [("hi", HI), ("mr", MR), ("ta", TA), ("kn", KN), ("ml", ML)]


class TestWordExtraction:
    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_content_words_are_found(self, name, text):
        # Was 0 for every one of these.
        assert content_words(text), f"{name}: no content words extracted"

    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_words_are_not_shredded_at_the_vowel_mark(self, name, text):
        # A matra-split produced ~2x the real word count in fragments.
        assert len(tokens(text)) <= len(text.split()) + 1

    def test_english_is_unchanged(self):
        assert content_words("wife works nights at a garment unit") == {
            "wife",
            "works",
            "nights",
            "garment",
            "unit",
        }

    def test_latin_short_words_are_still_filtered(self):
        # The floor still does its stopword job where it was calibrated.
        assert "the" not in content_words("the unit")
        assert "unit" in content_words("the unit")

    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_a_short_indic_word_survives_the_floor(self, name, text):
        # An abugida encodes a syllable per codepoint, so applying the English
        # 4-char floor to Devanagari removes ordinary nouns, not function words.
        assert any(len(w) < 4 for w in content_words(text)) or content_words(text)


class TestReconsolidation:
    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_an_exact_repeat_folds(self, name, text):
        assert same_fact(text, text)

    def test_a_hindi_paraphrase_folds(self):
        # same_fact compared two empty sets before, so it returned False for
        # every non-identical Indic pair and the ledger accumulated duplicates.
        assert same_fact(
            "पत्नी रात में काम करती है",
            "पत्नी रात में काम करती है और हम कम मिलते हैं",
        )

    def test_unrelated_hindi_facts_do_not_fold(self):
        assert not same_fact("पत्नी रात में काम करती है", "मेरी दो बेटियाँ हैं")

    def test_different_scripts_never_fold(self):
        assert not same_fact(HI, TA)

    async def test_the_ledger_dedupes_in_hindi(self):
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        await store.commit(0, disclosed=[Fact(text="पत्नी रात में काम करती है")])
        await store.begin_turn()
        await store.commit(
            1, disclosed=[Fact(text="पत्नी रात में काम करती है और हम कम मिलते हैं")]
        )
        assert len((await store.snapshot()).disclosed) == 1

    async def test_a_hindi_thread_can_be_closed(self):
        # Closing matches via same_fact, so it was impossible in Indic: threads
        # accumulated forever and `reflecting` became unreachable.
        store = ClientWorkingMemoryStore()
        await store.begin_turn()
        await store.commit(0, opened_threads=[Thread(topic="पत्नी से बातचीत")])
        await store.begin_turn()
        await store.commit(1, closed_topics=["पत्नी से बातचीत"])
        assert (await store.snapshot()).open_threads == []


class TestGroundedness:
    def _transcript(self, reply):
        return [HumanMessage(content="बताइए"), AIMessage(content=reply)]

    def test_a_hindi_disclosure_is_grounded_not_vanished(self):
        # THE severe one: check_grounding skips an item with no extractable
        # words, so every Indic disclosure disappeared into neither list.
        t = self._transcript("मेरी पत्नी रात में काम करती है, हम कम ही मिलते हैं")
        grounded, ungrounded = check_grounding(["पत्नी रात में काम करती है"], t)
        assert len(grounded) == 1
        assert ungrounded == []

    def test_an_invented_hindi_disclosure_is_still_caught(self):
        t = self._transcript("मेरी पत्नी रात में काम करती है")
        grounded, ungrounded = check_grounding(["मेरा भाई कनाडा चला गया"], t)
        assert grounded == []
        assert len(ungrounded) == 1

    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_the_writeout_is_not_empty(self, name, text):
        # build_writeout returned None for every non-English session, so the
        # whole semantic record was missing in production for those languages.
        memory = ClientWorkingMemory(disclosed=[Fact(text=text)])
        record = build_writeout(memory, self._transcript(text))
        assert record is not None, f"{name}: write-out was empty"
        assert record["disclosed"] == [text]


class TestRecall:
    @pytest.mark.parametrize("name,text", ALL_SCRIPTS)
    def test_a_cue_matches_in_script(self, name, text):
        # Cue derivation produced nothing, so recall never responded to an
        # Indic conversation and the tier-2 fallback could not rescue it.
        facts = [Fact(text=text), Fact(text="unrelated english filler fact")]
        cue = sorted(content_words(text))[0]
        _, scored = select(facts, turn_index=1, stance="guarded", cues=[cue])
        assert any(s.cue_hits for s in scored)

    def test_the_learner_text_fallback_works_in_hindi(self):
        facts = [Fact(text="पत्नी रात में काम करती है")]
        _, scored = select(
            facts,
            turn_index=1,
            stance="guarded",
            cues=[],
            last_learner_text="आपकी पत्नी के बारे में बताइए",
        )
        assert any(s.cue_hits for s in scored)
