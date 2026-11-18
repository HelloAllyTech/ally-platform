"""The WhatsApp Q&A bot's retrieval-augmented answering agent.

Stateless, like the analytics agent: conversation history arrives on the request and
this service owns no database. It reads the KnowledgeChunk index and calls an LLM;
ally-be owns every row, every phone number and every decision about what to do with the
result.

The pipeline, and why it is in this order:

    detect + translate → embed → retrieve → deterministic decline gate → answer

Translation comes FIRST because retrieval happens in embedding space: a Hindi or Tamil
question embedded by text-embedding-3-small and matched against an English corpus
retrieves badly, and no amount of prompt quality recovers from being handed the wrong
passages. The failure is invisible from the answer alone — the model dutifully answers
from whatever it was given — which is exactly why it is worth an extra call.

The deterministic gate comes BEFORE the answer call so that "the corpus does not cover
this" is decided by a threshold the admin can see and tune, not by a model's mood, and
so that the common case of a genuinely uncovered question costs no generation tokens at
all.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypedDict

from app.core.config import settings
from app.core.knowledge_agent.prompt import (
    ANSWER_PROMPT_PATH,
    CRISIS_PROMPT_PATH,
    GENERAL_ANSWER_PROMPT_PATH,
    TRANSLATE_PROMPT_PATH,
    build_answer_prompt,
    build_crisis_prompt,
    build_translate_prompt,
)
from app.core.knowledge_agent.schemas import (
    AnswerIntent,
    CrisisVerdict,
    DeclineReason,
    KnowledgeAnswer,
    TranslatedQuery,
    is_general,
)
from app.core.knowledge_base.corpus import KbCorpus
from app.core.knowledge_base.knowledge_chunk_service import (
    ChunkAudience,
    KnowledgeChunkService,
)
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.core.phi_events import PHIEvents
from app.core.phi_logger import PHILogEvent, phi_logger
from app.core.retrieval_log.emitter import emit_retrieval_log
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The v2 agent's passage selection (chunk 20a-2). A hit under this many tokens is a
#: heading on its own and never sets the similarity band.
AGENT_MIN_BEST_TOKENS = 10
#: The v2 agent always sees up to this many hits above the decline threshold.
AGENT_FLOOR_PASSAGES = 4

# Answer length the reply is composed to. ally-be renders the source lines on top of
# this and hard-caps the whole message at 1600 characters (Twilio's ceiling, below
# Meta's 4096 — composing to the portable one is what keeps the provider seam honest).
DEFAULT_MAX_ANSWER_CHARS = 1400


#: DeclineReason -> the disposition ally-be records. A translation failure is kept apart
#: from the two corpus answers on purpose: retrieval ran on untranslated text, so a weak
#: result says nothing about coverage and must never be counted as a gap.
_DECLINE_DISPOSITIONS = {
    DeclineReason.NO_HITS: "declined_no_hits",
    DeclineReason.BELOW_THRESHOLD: "declined_below_threshold",
    DeclineReason.TRANSLATION_FAILED: "declined_translation_failed",
}


class AnswerResult(TypedDict, total=False):
    """The `/knowledge-agent/answer` response, before validation. The agent path adds
    `turn_type`."""

    intent: AnswerIntent
    answer: str
    language: str
    confidence: float
    citations: List[Dict[str, Any]]
    decline_reason: DeclineReason
    retrieval: Dict[str, Any]
    provider: str
    model: str
    prompt_version: str
    turn_type: str


def build_result(
    *,
    intent: AnswerIntent,
    answer: str,
    language: str,
    confidence: float,
    citations: List[Dict[str, Any]],
    decline_reason: DeclineReason,
    retrieval: Dict[str, Any],
    meta: Optional[Dict[str, Any]] = None,
) -> AnswerResult:
    """One answer result; `meta` is the model call's dispatch metadata (none for a
    decline made before any model call)."""
    meta = meta or {}
    return {
        "intent": intent,
        "answer": answer,
        "language": language,
        "confidence": confidence,
        "citations": citations,
        "decline_reason": decline_reason,
        "retrieval": retrieval,
        "provider": meta.get("provider", ""),
        "model": meta.get("model", ""),
        "prompt_version": settings.KNOWLEDGE_AGENT.PROMPT_VERSION,
    }


def resolve_citations(
    numbers: List[int], passages: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Map the model's passage numbers back to real chunk metadata, dropping
    anything bogus.

    Validated in code rather than trusted, on the same principle as
    validate_chart() in the analytics agent: a citation pointing at passage 9
    when 5 were supplied would render as a source line the reader cannot check,
    and an answer that cites something is read as more trustworthy than one
    that does not. Out-of-range numbers are dropped rather than clamped —
    clamping would silently attribute the claim to a real but wrong passage,
    which is worse than losing the citation.

    Order is preserved and duplicates collapsed, so the rendered source list
    matches the order the model reasoned in.
    """
    resolved: List[Dict[str, Any]] = []
    seen: set[int] = set()

    for number in numbers:
        try:
            index = int(number)
        except (TypeError, ValueError):
            continue
        if index < 1 or index > len(passages) or index in seen:
            continue
        seen.add(index)
        passage = passages[index - 1]
        record = {"record_id": passage["record_id"]} if passage.get("record_id") else {}
        resolved.append(
            {
                **record,
                "passage_number": index,
                "chunk_id": passage.get("chunk_id"),
                "document_id": passage.get("document_id"),
                "document_title": passage.get("document_title") or "",
                "page_from": int(passage.get("page_from") or 0),
                "page_to": int(passage.get("page_to") or 0),
                "section_path": passage.get("section_path") or "",
                "source_url": passage.get("source_url") or "",
                "similarity": float(passage.get("similarity") or 0.0),
            }
        )

    if len(resolved) < len(numbers):
        logger.warning(
            "Dropped %d invalid citation number(s) out of %d",
            len(numbers) - len(resolved),
            len(numbers),
        )
    return resolved


class KnowledgeAgentService:
    """Answers a question from the knowledge corpus, or declines."""

    def __init__(self, chunk_service: KnowledgeChunkService) -> None:
        self.chunk_service = chunk_service

    # ------------------------------------------------------------------ query prep

    async def prepare_query(
        self, question: str, *, prompts: Optional[Dict[str, Any]] = None
    ) -> Tuple[str, str, Optional[str], bool]:
        """
        Detect the question's language and, when it is not English, restate it in
        English.

        Returns ``(search_text, language, translated_query, degraded)``.
        `translated_query` is None when no translation happened, so the caller can
        show an admin exactly what was searched versus what was asked. `degraded`
        is True only when translation was ATTEMPTED and failed (call error, or a
        missing prompt template) — never for a question that was already English,
        which is a normal, fully-successful outcome and must not be conflated with
        a failure.

        A failure here degrades to searching the ORIGINAL text rather than failing
        the question. That is deliberate: a translation outage should cost
        retrieval quality for non-English questions, not take the bot down for
        everyone. But the caller needs `degraded` precisely because of that: a
        NO_HITS/BELOW_THRESHOLD decline that follows is "we couldn't understand
        your language", not "we don't cover this" — see
        DeclineReason.TRANSLATION_FAILED.
        """
        provider, model, temperature = get_backend_llm_overrides(
            TRANSLATE_PROMPT_PATH, prompts
        )
        prompt = build_translate_prompt(question, prompts=prompts)
        if not prompt:
            logger.error(
                "Translate prompt template resolved empty; skipping translation"
            )
            return question, "en", None, True

        try:
            parsed, _meta = await generate_structured(
                schema=TranslatedQuery,
                prompt=prompt,
                task=LLMTask.WHATSAPP_QUERY_TRANSLATE.value,
                provider=provider,
                model=model or settings.KNOWLEDGE_AGENT.TRANSLATE_MODEL,
                temperature=temperature if temperature is not None else 0.0,
            )
        except (
            Exception
        ) as e:  # noqa: BLE001 — never fail the question over translation
            logger.warning(
                "Query translation failed (%s); searching the original text",
                type(e).__name__,
            )
            return question, "en", None, True

        language = (parsed.language or "en").strip() or "en"
        english = (parsed.english_query or "").strip()

        if parsed.is_english or not english:
            return question, language, None, False
        return english, language, english, False

    # ------------------------------------------------------------------ crisis

    async def classify_crisis(
        self,
        message: str,
        *,
        history: Optional[List[str]] = None,
        prompts: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Decide whether a message is about a crisis happening now.

        A SEPARATE call from `answer`, not a stage inside it, for two reasons. It
        lets ally-be run the two concurrently, so the safety net costs no latency
        on a question that is not a crisis. And it keeps the precedence decision
        — crisis beats answer, always — in ally-be, which is the side that
        actually sends.

        The keyword rules in ally-be remain the first line and are still
        terminal: they are instant, free, and auditable. This exists for what
        they structurally cannot catch, which is indirect disclosure ("I can't
        keep doing this"). Neither replaces the other.

        `history` is the sender's own earlier messages, oldest first (chunk 15a):
        "I mean it" is risk only after a disclosure, and "what if I miss a day?"
        is ordinary after a question about streaks. Never the assistant's
        replies: the crisis reply's own wording would tip every later message.

        A failure here returns ``is_crisis: false`` rather than raising, and
        `failed` says so. Raising would take the whole question down over the
        classifier, and defaulting to true would answer every question with a
        crisis message the moment an API key expired — a bot that only ever says
        "call a crisis line" is a broken bot, and workers would stop reading the
        message that matters. The keyword rules are what still hold in that
        window, which is why they were not replaced.
        """
        cfg = settings.KNOWLEDGE_AGENT
        provider, model, temperature = get_backend_llm_overrides(
            CRISIS_PROMPT_PATH, prompts
        )
        prompt = build_crisis_prompt(message, history=history, prompts=prompts)
        if not prompt:
            logger.error(
                "Crisis prompt template resolved empty; skipping classification"
            )
            return {
                "is_crisis": False,
                "signal": "",
                "confidence": 0.0,
                "failed": True,
            }

        try:
            parsed, meta = await generate_structured(
                schema=CrisisVerdict,
                prompt=prompt,
                task=LLMTask.WHATSAPP_CRISIS_CLASSIFY.value,
                provider=provider,
                model=model or cfg.CRISIS_MODEL,
                # Zero, not low: this is a classification, and any sampling
                # variance means the same message is a crisis on Tuesday and not
                # on Wednesday.
                temperature=temperature if temperature is not None else 0.0,
            )
        # noqa: BLE001 below — never fail the question over the classifier.
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Crisis classification failed (%s); keyword rules still apply",
                type(e).__name__,
            )
            return {
                "is_crisis": False,
                "signal": "",
                "confidence": 0.0,
                "failed": True,
            }

        if parsed.is_crisis:
            # Info, not debug: a positive verdict is an operationally significant
            # event. The signal phrase itself is a worker's verbatim disclosure,
            # so it goes to the PHI audit log, never the application log — only
            # the confidence does.
            logger.info("Crisis classifier fired: confidence=%.2f", parsed.confidence)
            await phi_logger.log(
                PHILogEvent(
                    event_type=PHIEvents.DATA_ACCESSED,
                    chat_id=None,
                    audit_id=None,
                    details={
                        "message": "Crisis classifier fired",
                        "component": "KnowledgeAgentService.classify_crisis",
                        "confidence": parsed.confidence,
                        "signal": parsed.signal[:120],
                    },
                )
            )

        return {
            "is_crisis": bool(parsed.is_crisis),
            "signal": (parsed.signal or "").strip(),
            "confidence": float(parsed.confidence or 0.0),
            "failed": False,
            "provider": meta.get("provider", "") if isinstance(meta, dict) else "",
            "model": meta.get("model", "") if isinstance(meta, dict) else "",
        }

    # ------------------------------------------------------------------ retrieval

    def _report_retrieval(
        self,
        *,
        query: str,
        min_similarity: float,
        decline_similarity: float,
        top_k: int,
        hits: Sequence[Dict[str, Any]],
        returned_count: int,
        latency_ms: int,
        language: Optional[str],
        disposition: str,
    ) -> None:
        """Report this retrieval to ally-be's log.

        Best-effort; never affects the answer.

        The query is a health worker's own question, so it goes with
        ``query_sensitive=True`` and every read surface withholds the text. What the
        panel shows instead is the judge's own words about what was missing, which is
        judge-authored and safe to render.

        Reported at DECLINE as well as at answer, because the decline is the outcome
        the worker experienced and the one the bot's threshold should be calibrated
        against.
        """
        emit_retrieval_log(
            corpus=KbCorpus.WHATSAPP_QA.value,
            consumer="whatsapp_bot",
            query=query,
            min_similarity=min_similarity,
            decline_similarity=decline_similarity,
            requested_limit=top_k,
            returned_count=returned_count,
            latency_ms=latency_ms,
            hits=hits,
            disposition=disposition,
            query_language=language,
            query_sensitive=True,
        )

    @staticmethod
    def _select_passages(
        hits: List[Dict[str, Any]],
        *,
        band: float,
        max_passages: int,
        max_context_tokens: int,
        min_best_tokens: int = 0,
        floor_passages: int = 0,
        floor_similarity: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Narrow raw hits to the passages actually worth putting in the prompt.

        The last three arguments are off by default, which is v1 exactly. The v2
        agent turns them on (chunk 20a-2), because on short web pages a chunk that
        holds only a heading ("Greenfield Meadows") matches any question that names
        the business, sets the band, and pushes the passage with the answer out:

        - ``min_best_tokens``: a hit shorter than this can't set the band;
        - ``floor_passages`` / ``floor_similarity``: keep at least this many hits
          that clear ``floor_similarity`` (the decline threshold), band or not.

        Three filters, in order:

        1. A similarity BAND relative to the best hit. One strong match plus seven
           weak ones is worse than the strong match alone — the weak ones give the
           model licence to blend unrelated material into a single confident-sounding
           answer.
        2. A hard count cap, because a 1600-character reply cannot honestly ground
           on more than a handful of passages.
        3. A context token budget, using the token_count ally-be already computed
           per chunk. No tokeniser is needed here, and none exists in this
           service.
        """
        if not hits:
            return []

        def similarity(hit: Dict[str, Any]) -> float:
            return float(hit.get("similarity") or 0.0)

        def token_count(hit: Dict[str, Any]) -> int:
            # Fall back to a rough character estimate only when ally-be sent no
            # count, so a missing field cannot silently disable the budget.
            return int(hit.get("token_count") or 0) or max(
                1, len(hit.get("text") or "") // 4
            )

        setter = next((h for h in hits if token_count(h) >= min_best_tokens), hits[0])
        best = similarity(setter)
        banded = [h for h in hits if similarity(h) >= best - band]
        if floor_passages and len(banded) < floor_passages:
            extra = [
                h for h in hits if h not in banded and similarity(h) >= floor_similarity
            ][: floor_passages - len(banded)]
            banded = sorted(banded + extra, key=similarity, reverse=True)

        selected: List[Dict[str, Any]] = []
        budget = max_context_tokens
        for hit in banded[:max_passages]:
            tokens = token_count(hit)
            if selected and tokens > budget:
                break
            selected.append(hit)
            budget -= tokens
        return selected

    # ------------------------------------------------------------------ pipeline steps
    #
    # `answer` is these steps in order. They are separate so the LangGraph runtime
    # (app/core/agent_runtime) can run each one as a node and stay identical to this
    # path by construction rather than by copy.

    @staticmethod
    def resolve_limits(
        *,
        top_k: Optional[int] = None,
        min_similarity: Optional[float] = None,
        decline_similarity: Optional[float] = None,
        max_passages: Optional[int] = None,
        max_context_tokens: Optional[int] = None,
        similarity_band: Optional[float] = None,
    ) -> Dict[str, Any]:
        """The request's retrieval thresholds, with the settings defaults filled in."""
        cfg = settings.KNOWLEDGE_AGENT
        return {
            "top_k": top_k or cfg.TOP_K,
            "min_similarity": (
                cfg.MIN_SIMILARITY if min_similarity is None else min_similarity
            ),
            "decline_similarity": (
                cfg.DECLINE_SIMILARITY
                if decline_similarity is None
                else decline_similarity
            ),
            "max_passages": max_passages or cfg.MAX_PASSAGES,
            "max_context_tokens": max_context_tokens or cfg.MAX_CONTEXT_TOKENS,
            "similarity_band": (
                cfg.SIMILARITY_BAND if similarity_band is None else similarity_band
            ),
        }

    async def translate(
        self,
        question: str,
        *,
        prompts: Optional[Dict[str, Any]] = None,
        enabled: bool = True,
    ) -> Tuple[str, str, Optional[str], bool]:
        """`prepare_query`, or the question as written when translation is off."""
        if not enabled:
            return question, "en", None, False
        return await self.prepare_query(question, prompts=prompts)

    async def retrieve(
        self,
        search_text: str,
        audience: ChunkAudience,
        *,
        limits: Dict[str, Any],
        document_ids: Optional[List[str]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Search the corpus. Returns ``(hits, latency_ms)``."""
        retrieval_started_at = time.monotonic()
        hits = await self.chunk_service.search(
            query=search_text,
            limit=limits["top_k"],
            min_similarity=limits["min_similarity"],
            document_ids=document_ids,
            audience=audience,
        )
        retrieval_latency_ms = int((time.monotonic() - retrieval_started_at) * 1000)
        return hits, retrieval_latency_ms

    @staticmethod
    def retrieval_meta(
        limits: Dict[str, Any],
        hits: Sequence[Dict[str, Any]],
        *,
        language: str,
        translated: Optional[str],
        translation_degraded: bool,
    ) -> Dict[str, Any]:
        """The `retrieval` block of the response, before passages are selected."""
        top_similarity = float(hits[0].get("similarity") or 0.0) if hits else 0.0
        return {
            "top_k": limits["top_k"],
            "min_similarity": limits["min_similarity"],
            "decline_similarity": limits["decline_similarity"],
            "hit_count": len(hits),
            "top_similarity": round(top_similarity, 4),
            "passages_used": 0,
            "query_language": language,
            "translated_query": translated,
            "unsupported": False,
            "translation_degraded": translation_degraded,
        }

    @staticmethod
    def gate(
        hits: Sequence[Dict[str, Any]],
        *,
        decline_similarity: float,
        general: bool,
        translation_degraded: bool,
    ) -> Optional[DeclineReason]:
        """
        Gate 1: deterministic, no LLM call. Returns the decline reason, or None to
        go on to the model.

        Answering this in code rather than asking the model is what makes the
        threshold auditable and tunable, and it means the common "we simply don't
        have this" case costs nothing in generation tokens. A bot allowed to answer
        beyond its documents skips this gate: with nothing relevant retrieved it
        still goes to the model, with no passages, under the general-knowledge
        template (which makes the model say so).
        """
        top_similarity = float(hits[0].get("similarity") or 0.0) if hits else 0.0
        if general or (hits and top_similarity >= decline_similarity):
            return None
        if translation_degraded:
            # Retrieval ran on untranslated/original-language text because query
            # translation failed — a weak or empty result here says nothing about
            # whether the corpus covers the topic, so it must not be reported (or
            # answered for) as NO_HITS/BELOW_THRESHOLD.
            return DeclineReason.TRANSLATION_FAILED
        return DeclineReason.NO_HITS if not hits else DeclineReason.BELOW_THRESHOLD

    def decline(
        self,
        reason: DeclineReason,
        *,
        search_text: str,
        hits: List[Dict[str, Any]],
        limits: Dict[str, Any],
        latency_ms: int,
        language: str,
        retrieval: Dict[str, Any],
    ) -> AnswerResult:
        """The result for a gate decline, reported to the retrieval log."""
        logger.info(
            "Declining before generation: reason=%s hits=%d top=%.4f",
            reason.value,
            len(hits),
            float(hits[0].get("similarity") or 0.0) if hits else 0.0,
        )
        # Report the DECLINE, not just the search. A retrieval that returned six
        # passages and was refused on all of them looks healthy in every count except
        # this one, and refusal is what the worker actually experienced.
        self.report_gate_decline(
            reason,
            search_text=search_text,
            hits=hits,
            limits=limits,
            latency_ms=latency_ms,
            language=language,
        )
        return build_result(
            intent=AnswerIntent.DECLINE,
            answer="",
            language=language,
            confidence=0.0,
            citations=[],
            decline_reason=reason,
            retrieval=retrieval,
        )

    def report_gate_decline(
        self,
        reason: DeclineReason,
        *,
        search_text: str,
        hits: List[Dict[str, Any]],
        limits: Dict[str, Any],
        latency_ms: int,
        language: str,
    ) -> None:
        """Report a search the gate refused to the retrieval log.

        The conversational agent's first `search_knowledge` call uses this without
        declining: the run goes on to the agent, but the search is logged the same way.
        """
        self._report_retrieval(
            query=search_text,
            min_similarity=limits["min_similarity"],
            decline_similarity=limits["decline_similarity"],
            top_k=limits["top_k"],
            hits=hits,
            returned_count=0,
            latency_ms=latency_ms,
            language=language,
            disposition=_DECLINE_DISPOSITIONS.get(reason, "declined_below_threshold"),
        )

    def select(
        self,
        hits: List[Dict[str, Any]],
        *,
        search_text: str,
        limits: Dict[str, Any],
        latency_ms: int,
        language: str,
        retrieval: Dict[str, Any],
        log_retrieval: bool = True,
        agent_selection: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Pick the passages for the prompt, set ``retrieval["passages_used"]`` and
        report the retrieval as answered (unless ``log_retrieval`` is false). Below
        the decline threshold (general mode only gets here) the model is given no
        passages.
        """
        top_similarity = float(hits[0].get("similarity") or 0.0) if hits else 0.0
        relevant = (
            hits if hits and top_similarity >= limits["decline_similarity"] else []
        )
        passages = self._select_passages(
            relevant,
            band=limits["similarity_band"],
            max_passages=limits["max_passages"],
            max_context_tokens=limits["max_context_tokens"],
            # The v2 agent's search (chunk 20a-2); v1 keeps the plain band.
            **(
                {
                    "min_best_tokens": AGENT_MIN_BEST_TOKENS,
                    "floor_passages": AGENT_FLOOR_PASSAGES,
                    "floor_similarity": limits["decline_similarity"],
                }
                if agent_selection
                else {}
            ),
        )
        retrieval["passages_used"] = len(passages)
        if log_retrieval:
            self._report_retrieval(
                query=search_text,
                min_similarity=limits["min_similarity"],
                decline_similarity=limits["decline_similarity"],
                top_k=limits["top_k"],
                hits=hits,
                returned_count=len(passages),
                latency_ms=latency_ms,
                language=language,
                disposition="answered",
            )
        return passages

    async def write(
        self,
        question: str,
        passages: List[Dict[str, Any]],
        *,
        history: Optional[List[Dict[str, str]]] = None,
        prompts: Optional[Dict[str, Any]] = None,
        persona: Optional[Dict[str, Any]] = None,
        general: bool = False,
        max_answer_chars: int = DEFAULT_MAX_ANSWER_CHARS,
    ) -> Tuple[KnowledgeAnswer, Dict[str, Any]]:
        """The answer call. Returns the parsed answer and the dispatch metadata."""
        provider, model, temperature = get_backend_llm_overrides(
            GENERAL_ANSWER_PROMPT_PATH if general else ANSWER_PROMPT_PATH, prompts
        )
        prompt = build_answer_prompt(
            question,
            passages=passages,
            history=history,
            max_chars=max_answer_chars,
            prompts=prompts,
            persona=persona,
            general=general,
        )
        if not prompt:
            # A missing template must not become an unguided free-text answer.
            logger.error("Answer prompt template resolved empty")
            raise LLMInvocationFailedException(
                "The knowledge answer prompt template is missing or empty."
            )

        return await generate_structured(
            schema=KnowledgeAnswer,
            prompt=prompt,
            task=LLMTask.WHATSAPP_RAG_ANSWER.value,
            provider=provider,
            model=model,
            temperature=temperature if temperature is not None else 0.0,
        )

    def check(
        self,
        parsed: KnowledgeAnswer,
        meta: Dict[str, Any],
        passages: List[Dict[str, Any]],
        *,
        language: str,
        retrieval: Dict[str, Any],
    ) -> AnswerResult:
        """Gate 2: validate the model's answer and build the result."""
        intent = parsed.intent
        answer_text = (parsed.answer or "").strip()
        citations = resolve_citations(parsed.citations, passages)
        decline_reason = DeclineReason.NONE

        if intent == AnswerIntent.ANSWER and not answer_text:
            # "I answered" with nothing in it reaches the worker as silence.
            # Treat it as the decline it actually is, so it also lands in the
            # unanswered queue.
            logger.warning("Model returned intent=answer with an empty answer")
            intent = AnswerIntent.DECLINE

        if intent == AnswerIntent.DECLINE:
            decline_reason = DeclineReason.MODEL_DECLINED
            citations = []
        elif intent == AnswerIntent.CLARIFY:
            # A clarification is not grounded in anything, so it carries no
            # citations — and deliberately does NOT create an
            # unanswered-question row: a vague question is not evidence of a
            # corpus gap.
            citations = []
        elif intent == AnswerIntent.ANSWER and not citations:
            # Kept, not discarded: a legitimate synthesis across passages
            # sometimes cites nothing. Flagged so the dashboard can count
            # ungrounded answers, which is the number that tells you whether
            # the grounding instruction is holding.
            retrieval["unsupported"] = True
            logger.info("Answer returned with no usable citations")

        return build_result(
            intent=intent,
            answer=answer_text,
            language=(parsed.language or language or "en").strip(),
            confidence=float(parsed.confidence or 0.0),
            citations=citations,
            decline_reason=decline_reason,
            retrieval=retrieval,
            meta=meta,
        )

    # ------------------------------------------------------------------ main entry

    async def answer(
        self,
        question: str,
        audience: ChunkAudience,
        *,
        history: Optional[List[Dict[str, str]]] = None,
        prompts: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
        min_similarity: Optional[float] = None,
        decline_similarity: Optional[float] = None,
        max_passages: Optional[int] = None,
        max_context_tokens: Optional[int] = None,
        similarity_band: Optional[float] = None,
        max_answer_chars: int = DEFAULT_MAX_ANSWER_CHARS,
        translate_query: bool = True,
        document_ids: Optional[List[str]] = None,
        persona: Optional[Dict[str, Any]] = None,
        answer_mode: str = "documents_only",
    ) -> Dict[str, Any]:
        """
        Answer one question. Every threshold is overridable per request by ally-be,
        which reads them from the `whatsapp_bot` settings row, so retrieval can be
        tuned without a deploy.

        `audience` is positional and required for the same reason it is on
        `KnowledgeChunkService.search`: documents are targetable at one, some or
        all organisations, and an omitted audience would answer from material the
        asker may not be entitled to. There is no default — a caller that cannot
        say who is asking has to decide what to do about that itself.
        """
        limits = self.resolve_limits(
            top_k=top_k,
            min_similarity=min_similarity,
            decline_similarity=decline_similarity,
            max_passages=max_passages,
            max_context_tokens=max_context_tokens,
            similarity_band=similarity_band,
        )
        search_text, language, translated, translation_degraded = await self.translate(
            question, prompts=prompts, enabled=translate_query
        )
        hits, latency_ms = await self.retrieve(
            search_text, audience, limits=limits, document_ids=document_ids
        )
        retrieval = self.retrieval_meta(
            limits,
            hits,
            language=language,
            translated=translated,
            translation_degraded=translation_degraded,
        )

        general = is_general(answer_mode)
        reason = self.gate(
            hits,
            decline_similarity=limits["decline_similarity"],
            general=general,
            translation_degraded=translation_degraded,
        )
        if reason is not None:
            return self.decline(
                reason,
                search_text=search_text,
                hits=hits,
                limits=limits,
                latency_ms=latency_ms,
                language=language,
                retrieval=retrieval,
            )

        passages = self.select(
            hits,
            search_text=search_text,
            limits=limits,
            latency_ms=latency_ms,
            language=language,
            retrieval=retrieval,
        )
        parsed, meta = await self.write(
            question,
            passages,
            history=history,
            prompts=prompts,
            persona=persona,
            general=general,
            max_answer_chars=max_answer_chars,
        )
        return self.check(
            parsed, meta, passages, language=language, retrieval=retrieval
        )
