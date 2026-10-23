from app.core.agent.glossary_swap import StreamingWordSwapper, build_swap_table

TABLE = build_swap_table(
    [
        {"avoid": "அதனால்", "say": "அதனால"},
        {"avoid": "பற்றி", "say": "பத்தி"},
        {"avoid": "apprehensive", "say": "nervous"},
    ]
)


def stream(swapper: StreamingWordSwapper, chunks: list[str]) -> str:
    return "".join(swapper.feed(c) for c in chunks) + swapper.flush()


def test_swaps_whole_words():
    s = StreamingWordSwapper(TABLE)
    out = s.swap_text("அதனால் நான் அதை பற்றி யோசிச்சேன்.")
    assert out == "அதனால நான் அதை பத்தி யோசிச்சேன்."
    assert {r["avoid"]: r["count"] for r in s.swap_summary()} == {
        "அதனால்": 1,
        "பற்றி": 1,
    }


def test_never_touches_an_inflected_form():
    # பற்றிய is its own word; the rule named only பற்றி.
    s = StreamingWordSwapper(TABLE)
    assert s.swap_text("அது பற்றிய கவலை") == "அது பற்றிய கவலை"
    assert s.swap_summary() == []


def test_word_split_across_chunks_is_still_swapped():
    s = StreamingWordSwapper(TABLE)
    # The virama-bearing word arrives in three pieces.
    assert stream(s, ["சரி, அத", "னா", "ல் போனேன்"]) == "சரி, அதனால போனேன்"


def test_holds_back_only_the_partial_word():
    s = StreamingWordSwapper(TABLE)
    assert s.feed("சரி அதனா") == "சரி "
    assert s.feed("ல் சொல்றேன்") == "அதனால "
    assert s.flush() == "சொல்றேன்"


def test_stage_directions_are_left_alone():
    table = build_swap_table([{"avoid": "pause", "say": "wait"}])
    s = StreamingWordSwapper(table)
    assert stream(s, ["[long pa", "use] then a pause"]) == "[long pause] then a wait"


def test_keeps_a_sentence_initial_capital():
    s = StreamingWordSwapper(TABLE)
    assert s.swap_text("Apprehensive, honestly.") == "Nervous, honestly."


def test_reset_drops_held_text_from_an_interrupted_turn():
    s = StreamingWordSwapper(TABLE)
    s.feed("அதனா")
    s.reset()
    assert s.feed("சரி ") == "சரி "
    assert s.flush() == ""


def test_build_table_rejects_malformed_and_conflicting_pairs():
    table = build_swap_table(
        [
            {"avoid": "மன அழுத்தம்", "say": "டென்ஷன்"},  # multi-word
            {"avoid": "சரி", "say": "சரி"},  # identical
            {"avoid": "x", "say": ""},  # empty
            {"avoid": "இரவு", "say": "ராத்திரி"},
            {"avoid": "இரவு", "say": "நைட்"},  # conflicts with the line above
            {"avoid": "மாலை", "say": "சாயங்காலம்"},
        ]
    )
    assert table == {"மாலை": "சாயங்காலம்"}


def test_empty_table_passes_text_through():
    s = StreamingWordSwapper({})
    assert stream(s, ["அதனால் ", "[sighs] ok"]) == "அதனால் [sighs] ok"


def test_scenario_table_and_complete_text_helpers():
    from types import SimpleNamespace

    from app.core.agent.glossary_swap import swap_complete_text, swap_table_for

    scenario = SimpleNamespace(
        prompt_data=SimpleNamespace(
            glossary_swaps=[
                {"avoid": "பற்றி", "say": "பத்தி", "sectionCode": "core_style"}
            ]
        )
    )
    table = swap_table_for(scenario)
    assert table == {"பற்றி": "பத்தி"}
    swapped = swap_complete_text(table, "அது பற்றி [sighs] தான்")
    assert swapped == "அது பத்தி [sighs] தான்"
    # Non-string content (tool-call lists) and missing data pass through.
    assert swap_complete_text(table, ["x"]) == ["x"]
    assert swap_table_for(SimpleNamespace(prompt_data=None)) == {}
    assert swap_table_for(None) == {}
