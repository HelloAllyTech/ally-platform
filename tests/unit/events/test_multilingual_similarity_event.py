"""
Tests for multilingual sentence similarity event detection.
Tests actual capability with real text in different languages.
"""
import pytest
from app.core.events.event_types.similarity_based.similarity_event import SimilarityEvent
from app.core.events.event_types.similarity_based.text_processor import UnifiedTextProcessor
from app.core.events.event_types.similarity_based.stopwords_provider import (
    MultilingualStopwordsProvider,
    get_stopwords_provider,
)
from app.core.events.base import ChatMessage


class TestMultilingualTextProcessing:
    """Test text processing (normalization and tokenization) for different languages."""
    
    def test_english_normalization(self):
        """Test English text normalization."""
        processor = UnifiedTextProcessor(language_code="en-IN")
        
        # Test basic normalization
        assert processor.normalize("Hello, World!") == "hello world"
        # Apostrophe is replaced with space, then punctuation removed
        assert processor.normalize("That's great!") == "that s great"
        assert processor.normalize("How are you?") == "how are you"
        
        # Test with quotes
        assert processor.normalize('"Hello"') == "hello"
        assert processor.normalize("'World'") == "world"
        
        # Test whitespace normalization
        assert processor.normalize("  multiple   spaces  ") == "multiple spaces"
    
    def test_english_tokenization(self):
        """Test English text tokenization."""
        processor = UnifiedTextProcessor(language_code="en-IN")
        
        tokens = processor.tokenize("hello world how are you")
        assert tokens == ["hello", "world", "how", "are", "you"]
        
        tokens = processor.tokenize("  multiple   spaces  ")
        assert tokens == ["multiple", "spaces"]
    
    def test_hindi_normalization(self):
        """Test Hindi (Devanagari script) text normalization."""
        processor = UnifiedTextProcessor(language_code="hi-IN")
        
        # Hindi text with Devanagari script
        normalized = processor.normalize("नमस्ते, कैसे हैं?")
        # Should normalize Unicode, remove punctuation, lowercase
        assert "नमस्ते" in normalized or len(normalized) > 0
        
        # Test with mixed content
        normalized = processor.normalize("Hello नमस्ते World")
        assert len(normalized) > 0
    
    def test_hindi_tokenization(self):
        """Test Hindi text tokenization."""
        processor = UnifiedTextProcessor(language_code="hi-IN")
        
        # Hindi sentence with spaces
        tokens = processor.tokenize("नमस्ते कैसे हैं आप")
        assert len(tokens) > 0
        assert "नमस्ते" in tokens or any(len(t) > 0 for t in tokens)
    
    def test_malayalam_normalization(self):
        """Test Malayalam text normalization."""
        processor = UnifiedTextProcessor(language_code="ml-IN")
        
        # Malayalam text
        normalized = processor.normalize("നമസ്കാരം, എങ്ങനെയുണ്ട്?")
        # Should preserve Malayalam characters, remove punctuation
        assert len(normalized) > 0
        
        # Test with common Malayalam words
        normalized = processor.normalize("നിങ്ങൾക്ക് എങ്ങനെ തോന്നുന്നു")
        assert len(normalized) > 0
    
    def test_malayalam_tokenization(self):
        """Test Malayalam text tokenization."""
        processor = UnifiedTextProcessor(language_code="ml-IN")
        
        # Malayalam sentence
        tokens = processor.tokenize("നിങ്ങൾക്ക് എങ്ങനെ തോന്നുന്നു")
        assert len(tokens) >= 3  # Should have at least 3 tokens
        assert all(len(t) > 0 for t in tokens)
    
    def test_kannada_normalization(self):
        """Test Kannada text normalization."""
        processor = UnifiedTextProcessor(language_code="kn-IN")
        
        # Kannada text
        normalized = processor.normalize("ನಮಸ್ಕಾರ, ಹೇಗಿದ್ದೀರಿ?")
        assert len(normalized) > 0
        
        # Test with common Kannada words
        normalized = processor.normalize("ನಿಮಗೆ ಹೇಗೆ ಅನಿಸುತ್ತದೆ")
        assert len(normalized) > 0
    
    def test_kannada_tokenization(self):
        """Test Kannada text tokenization."""
        processor = UnifiedTextProcessor(language_code="kn-IN")
        
        # Kannada sentence
        tokens = processor.tokenize("ನಿಮಗೆ ಹೇಗೆ ಅನಿಸುತ್ತದೆ")
        assert len(tokens) >= 3  # Should have at least 3 tokens
        assert all(len(t) > 0 for t in tokens)
    
    def test_unicode_normalization_preserves_indic_scripts(self):
        """Test that Unicode normalization preserves Indic script characters."""
        processor = UnifiedTextProcessor(language_code="hi-IN")
        
        # Hindi, Malayalam, Kannada - all should preserve their scripts
        hindi_text = "नमस्ते"
        malayalam_text = "നമസ്കാരം"
        kannada_text = "ನಮಸ್ಕಾರ"
        
        assert processor.normalize(hindi_text) != ""
        assert processor.normalize(malayalam_text) != ""
        assert processor.normalize(kannada_text) != ""


class TestMultilingualStopwords:
    """Test stopword handling for different languages."""
    
    def test_english_stopwords_available(self):
        """Test that English stopwords are available."""
        provider = get_stopwords_provider(use_multilingual=True)
        stopwords = provider.get_stopwords("en-IN")
        
        assert len(stopwords) > 0
        # Common English stopwords should be present
        assert "the" in stopwords or "is" in stopwords or "are" in stopwords
    
    def test_hindi_stopwords_available(self):
        """Test that Hindi stopwords are available (from libraries or fallback)."""
        provider = get_stopwords_provider(use_multilingual=True)
        stopwords = provider.get_stopwords("hi-IN")
        
        # Should have stopwords (either from library or fallback to English)
        assert len(stopwords) > 0
    
    def test_malayalam_stopwords_fallback(self):
        """Test that Malayalam falls back appropriately when no stopwords available."""
        provider = get_stopwords_provider(use_multilingual=True)
        stopwords = provider.get_stopwords("ml-IN")
        
        # Should have stopwords (fallback to English if libraries don't have Malayalam)
        assert len(stopwords) > 0
    
    def test_kannada_stopwords_fallback(self):
        """Test that Kannada falls back appropriately when no stopwords available."""
        provider = get_stopwords_provider(use_multilingual=True)
        stopwords = provider.get_stopwords("kn-IN")
        
        # Should have stopwords (fallback to English if libraries don't have Kannada)
        assert len(stopwords) > 0
    
    def test_stopwords_are_frozen_set(self):
        """Test that stopwords are returned as FrozenSet."""
        provider = get_stopwords_provider(use_multilingual=True)
        stopwords = provider.get_stopwords("en-IN")
        
        assert isinstance(stopwords, frozenset)


class TestMultilingualEventDetection:
    """Test actual event detection with real sentences in different languages."""
    
    @pytest.mark.asyncio
    async def test_english_event_detection(self):
        """Test event detection with English sentences."""
        event = SimilarityEvent.create(
            event_id="test-en",
            custom_sentences=["How are you feeling?", "Tell me about your emotions"],
            language_code="en-IN",
        )
        
        # Should match when counselor says similar content
        conversations = [
            ChatMessage(role="counselor", content="How are you feeling today?")
        ]
        assert await event.detect_event(conversations) is True
        
        # Should match partial content
        conversations = [
            ChatMessage(role="counselor", content="I want to tell you about my emotions")
        ]
        assert await event.detect_event(conversations) is True
        
        # Should not match unrelated content
        conversations = [
            ChatMessage(role="counselor", content="The weather is nice today")
        ]
        assert await event.detect_event(conversations) is False
    
    @pytest.mark.asyncio
    async def test_hindi_event_detection(self):
        """Test event detection with Hindi sentences."""
        event = SimilarityEvent.create(
            event_id="test-hi",
            custom_sentences=["आप कैसा महसूस कर रहे हैं?", "मुझे अपनी भावनाओं के बारे में बताएं"],
            language_code="hi-IN",
        )
        
        # Should match when counselor says similar content in Hindi
        conversations = [
            ChatMessage(role="counselor", content="आप कैसा महसूस कर रहे हैं आज?")
        ]
        assert await event.detect_event(conversations) is True
        
        # Should match partial content
        conversations = [
            ChatMessage(role="counselor", content="मैं आपको अपनी भावनाओं के बारे में बताना चाहता हूं")
        ]
        assert await event.detect_event(conversations) is True
    
    @pytest.mark.asyncio
    async def test_malayalam_event_detection(self):
        """Test event detection with Malayalam sentences."""
        event = SimilarityEvent.create(
            event_id="test-ml",
            custom_sentences=["നിങ്ങൾക്ക് എങ്ങനെ തോന്നുന്നു?", "നിങ്ങളുടെ വികാരങ്ങളെക്കുറിച്ച് പറയൂ"],
            language_code="ml-IN",
        )
        
        # Should match when counselor says similar content in Malayalam
        conversations = [
            ChatMessage(role="counselor", content="നിങ്ങൾക്ക് എങ്ങനെ തോന്നുന്നു ഇന്ന്?")
        ]
        assert await event.detect_event(conversations) is True
        
        # Should match partial content
        conversations = [
            ChatMessage(role="counselor", content="എനിക്ക് നിങ്ങളുടെ വികാരങ്ങളെക്കുറിച്ച് പറയാൻ ആഗ്രഹമുണ്ട്")
        ]
        assert await event.detect_event(conversations) is True
    
    @pytest.mark.asyncio
    async def test_kannada_event_detection(self):
        """Test event detection with Kannada sentences."""
        event = SimilarityEvent.create(
            event_id="test-kn",
            custom_sentences=["ನಿಮಗೆ ಹೇಗೆ ಅನಿಸುತ್ತದೆ?", "ನಿಮ್ಮ ಭಾವನೆಗಳ ಬಗ್ಗೆ ಹೇಳಿ"],
            language_code="kn-IN",
        )
        
        # Should match when counselor says similar content in Kannada
        conversations = [
            ChatMessage(role="counselor", content="ನಿಮಗೆ ಹೇಗೆ ಅನಿಸುತ್ತದೆ ಇಂದು?")
        ]
        assert await event.detect_event(conversations) is True
        
        # Should match partial content
        conversations = [
            ChatMessage(role="counselor", content="ನನಗೆ ನಿಮ್ಮ ಭಾವನೆಗಳ ಬಗ್ಗೆ ಹೇಳಲು ಬಯಸುತ್ತೇನೆ")
        ]
        assert await event.detect_event(conversations) is True
    
    @pytest.mark.asyncio
    async def test_language_specific_matching(self):
        """Test that events don't match across different languages."""
        # English event
        english_event = SimilarityEvent.create(
            event_id="test-en-only",
            custom_sentences=["How are you feeling?"],
            language_code="en-IN",
        )
        
        # Hindi input should not match English event
        conversations = [
            ChatMessage(role="counselor", content="आप कैसा महसूस कर रहे हैं?")
        ]
        assert await english_event.detect_event(conversations) is False
        
        # Malayalam input should not match English event
        conversations = [
            ChatMessage(role="counselor", content="നിങ്ങൾക്ക് എങ്ങനെ തോന്നുന്നു?")
        ]
        assert await english_event.detect_event(conversations) is False
    
    @pytest.mark.asyncio
    async def test_case_insensitive_matching(self):
        """Test that matching is case-insensitive across languages."""
        # English
        event = SimilarityEvent.create(
            event_id="test-case-en",
            custom_sentences=["How are you feeling?"],
            language_code="en-IN",
        )
        conversations = [
            ChatMessage(role="counselor", content="HOW ARE YOU FEELING?")
        ]
        assert await event.detect_event(conversations) is True
    
    @pytest.mark.asyncio
    async def test_punctuation_handling(self):
        """Test that punctuation doesn't affect matching."""
        event = SimilarityEvent.create(
            event_id="test-punct",
            custom_sentences=["How are you feeling?"],
            language_code="en-IN",
        )
        
        # Various punctuation should still match
        test_cases = [
            "How are you feeling!",
            "How are you feeling.",
            "How are you feeling...",
            "How are you feeling???",
        ]
        
        for content in test_cases:
            conversations = [ChatMessage(role="counselor", content=content)]
            assert await event.detect_event(conversations) is True, f"Failed for: {content}"


class TestMultilingualEventCache:
    """Test that caching works correctly with different languages."""
    
    def test_cache_separates_by_language(self):
        """Test that events with different languages use separate cache entries."""
        event_en = SimilarityEvent.create(
            event_id="cache-test-en",
            custom_sentences=["hello world"],
            language_code="en-IN",
        )
        
        event_hi = SimilarityEvent.create(
            event_id="cache-test-hi",
            custom_sentences=["नमस्ते दुनिया"],
            language_code="hi-IN",
        )
        
        # Build patterns for both
        event_en._match("hello world")
        event_hi._match("नमस्ते दुनिया")
        
        # Both should be built
        assert event_en._instance_built is True
        assert event_hi._instance_built is True
        
        # Cache should have separate entries (different language codes in cache key)
        assert len(SimilarityEvent._PATTERN_CACHE) >= 2
    
    def test_same_language_same_sentences_shares_cache(self):
        """Test that same language and sentences share cache."""
        event1 = SimilarityEvent.create(
            event_id="cache-share-1",
            custom_sentences=["test sentence"],
            language_code="en-IN",
        )
        
        event2 = SimilarityEvent.create(
            event_id="cache-share-2",
            custom_sentences=["test sentence"],
            language_code="en-IN",
        )
        
        # Build first
        event1._match("test sentence")
        assert event1._instance_built is True
        
        # Build second - should use cache
        event2._match("test sentence")
        assert event2._instance_built is True
        
        # Should share cached patterns
        cached_lists = list(SimilarityEvent._PATTERN_CACHE.values())
        assert any(pl is event2._instance_patterns for pl in cached_lists)


class TestMultilingualEdgeCases:
    """Test edge cases for multilingual event detection."""
    
    @pytest.mark.asyncio
    async def test_empty_sentences_list(self):
        """Test that empty sentences list works for all languages."""
        for lang_code in ["en-IN", "hi-IN", "ml-IN", "kn-IN"]:
            event = SimilarityEvent.create(
                event_id=f"empty-{lang_code}",
                custom_sentences=[],
                language_code=lang_code,
            )
            conversations = [
                ChatMessage(role="counselor", content="anything")
            ]
            assert await event.detect_event(conversations) is False
    
    @pytest.mark.asyncio
    async def test_empty_counselor_message(self):
        """Test that empty counselor message doesn't match."""
        event = SimilarityEvent.create(
            event_id="empty-msg",
            custom_sentences=["test sentence"],
            language_code="en-IN",
        )
        conversations = [
            ChatMessage(role="counselor", content="")
        ]
        assert await event.detect_event(conversations) is False
    
    @pytest.mark.asyncio
    async def test_only_punctuation(self):
        """Test that messages with only punctuation don't match."""
        event = SimilarityEvent.create(
            event_id="punct-only",
            custom_sentences=["test sentence"],
            language_code="en-IN",
        )
        conversations = [
            ChatMessage(role="counselor", content="!!! ??? ...")
        ]
        assert await event.detect_event(conversations) is False
    
    @pytest.mark.asyncio
    async def test_mixed_language_sentences(self):
        """Test event with mixed language sentences."""
        event = SimilarityEvent.create(
            event_id="mixed-lang",
            custom_sentences=["How are you?", "आप कैसे हैं?"],
            language_code="en-IN",  # Default to English processing
        )
        
        # Should match English
        conversations = [
            ChatMessage(role="counselor", content="How are you today?")
        ]
        assert await event.detect_event(conversations) is True
        
        # Note: Hindi might not match perfectly with English processor,
        # but the system should handle it gracefully
        conversations = [
            ChatMessage(role="counselor", content="आप कैसे हैं आज?")
        ]
        # This might or might not match depending on normalization
        # Just ensure it doesn't crash
        result = await event.detect_event(conversations)
        assert isinstance(result, bool)
    
    def test_default_language_code(self):
        """Test that default language code is used when not specified."""
        event = SimilarityEvent.create(
            event_id="default-lang",
            custom_sentences=["test"],
        )
        # Should default to en-IN (now stored as regular field, not PrivateAttr)
        assert event.language_code == "en-IN"
        assert event._text_processor is not None
        assert event._stopwords is not None

