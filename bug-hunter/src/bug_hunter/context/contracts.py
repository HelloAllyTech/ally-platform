"""Cross-app contract hints: which ally-be code talks to which ally-ai /
ally-ai-learn route, and who produces and consumes each SQS queue.

Best-effort and regex-based on top of the repo map's decorators: routes come from
``@router.<verb>("/path")`` decorators plus ``APIRouter(prefix=…)`` and
``include_router(…, prefix=…)`` in the Python apps; client calls come from path
literals in ally-be's integration directories. Matching is by path suffix with
parameters wildcarded, so ``${baseUrl}/api/v1/learn/webhook/room-metadata/${name}``
meets ``/webhook/room-metadata/{room_name}``. Used by the ``api_contract`` lens
(chunk 08); until then it is data for ``investigate``.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.repo_map import RepoMap

SERVICE_APPS = ("ally-ai", "ally-ai-learn")
CLIENT_DIRS = {
    "ally-be": (
        "src/ai/",
        "src/learn/",
        "src/scenario-report/",
        "src/livekit/",
        "src/queue/",
        "src/message-broker/",
    ),
}
QUEUE_NAMES = (
    "sqs-ai-transcription-request-queue",
    "sqs-ai-transcription-response-queue",
    "sqs-learn-message-and-event-queue",
    "sqs-audio-upload-queue",
)

_ROUTE_DECORATOR = re.compile(
    r"@(?:router|app|\w+_router)\.(get|post|put|patch|delete)\(\s*[\"']([^\"']*)[\"']"
)
_ROUTER_PREFIX = re.compile(r"APIRouter\([^)]*prefix\s*=\s*[\"']([^\"']+)[\"']")
_INCLUDE_PREFIX = re.compile(
    r"include_router\(\s*([\w.]+)[^)]*prefix\s*=\s*[\"']([^\"']+)[\"']"
)
_PATH_LITERAL = re.compile(
    r"[\"'`]([^\"'`\n]*?/(?:api|v1|v2|summary|helpline|knowledge|scenario|learn"
    r"|transcri|analy|judge|answer)[^\"'`\n]*)[\"'`]"
)
_PARAM = re.compile(r"\$\{[^}]*\}|\{[^}]*\}|:[A-Za-z_]+")


@dataclass
class Route:
    service: str
    method: str
    path: str  # prefix + decorator path, params as *
    file: str
    symbol: str


@dataclass
class ClientCall:
    app: str
    file: str
    literal: str
    path: str  # normalised


@dataclass
class HttpContract:
    client_file: str
    client_literal: str
    service: str
    route_file: str
    route_symbol: str
    method: str
    route_path: str


@dataclass
class QueueContract:
    queue: str
    producers: list[str] = field(default_factory=list)  # app:file
    consumers: list[str] = field(default_factory=list)


@dataclass
class Contracts:
    http: list[HttpContract] = field(default_factory=list)
    queues: list[QueueContract] = field(default_factory=list)
    routes: list[Route] = field(default_factory=list)
    unmatched_client_calls: list[ClientCall] = field(default_factory=list)

    def hints_for(self, app: str, file: str) -> list[str]:
        """Human-readable hints for a file on either side of a contract."""
        hints: list[str] = []
        for c in self.http:
            if app == "ally-be" and c.client_file == file:
                hints.append(
                    f"calls {c.service} {c.method.upper()} {c.route_path} → "
                    f"{c.route_file}::{c.route_symbol}"
                )
            elif app == c.service and c.route_file == file:
                hints.append(f"called by ally-be {c.client_file} ({c.client_literal})")
        for q in self.queues:
            tag = f"{app}:{file}"
            if tag in q.producers:
                hints.append(
                    f"produces {q.queue}; consumers: "
                    f"{', '.join(q.consumers) or 'none found'}"
                )
            if tag in q.consumers:
                hints.append(
                    f"consumes {q.queue}; producers: "
                    f"{', '.join(q.producers) or 'none found'}"
                )
        return hints

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=1)

    @classmethod
    def from_json(cls, text: str) -> "Contracts":
        d = json.loads(text)
        return cls(
            http=[HttpContract(**x) for x in d["http"]],
            queues=[QueueContract(**x) for x in d["queues"]],
            routes=[Route(**x) for x in d["routes"]],
            unmatched_client_calls=[
                ClientCall(**x) for x in d["unmatched_client_calls"]
            ],
        )


def normalise_path(path: str) -> str:
    path = _PARAM.sub("*", path.strip())
    path = re.sub(r"/+", "/", path)
    return path.rstrip("/") or "/"


def _segments(path: str) -> list[str]:
    return [s for s in normalise_path(path).split("/") if s]


def paths_match(client_path: str, route_path: str) -> bool:
    """Suffix match on segments, ``*`` matching any one segment."""
    return match_quality(client_path, route_path) > 0


def match_quality(client_path: str, route_path: str) -> int:
    """0 = no match; otherwise the number of segments matched exactly plus one,
    so an exact route outranks a parameter route for the same literal."""
    c, r = _segments(client_path), _segments(route_path)
    if not r or len(c) < len(r):
        return 0
    tail = c[-len(r) :]
    exact = 0
    for a, b in zip(tail, r):
        if a == b:
            exact += 1
        elif a != "*" and b != "*":
            return 0
    return exact + 1


def _read(root: Path, rel: str) -> str:
    try:
        return (root / rel).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def routes_of(
    service: str, repo_map: RepoMap, root: Path, app_path: str
) -> list[Route]:
    """Routes from decorators in the map, prefixed with the file's APIRouter prefix
    and the include_router prefix that mounts it (best effort)."""
    include_prefixes: dict[str, str] = {}  # router variable module stem -> prefix
    file_prefix: dict[str, str] = {}
    for path, entry in repo_map.files.items():
        if entry.lang != "python":
            continue
        src = _read(root, f"{app_path}/{path}")
        if not src:
            continue
        m = _ROUTER_PREFIX.search(src)
        if m:
            file_prefix[path] = m.group(1)
        for m in _INCLUDE_PREFIX.finditer(src):
            include_prefixes[m.group(1).split(".")[0]] = m.group(2)
    routes: list[Route] = []
    for path, entry in repo_map.files.items():
        if entry.lang != "python":
            continue
        stem = Path(path).stem
        mount = include_prefixes.get(stem, "") or include_prefixes.get(
            f"{stem}_router", ""
        )
        prefix = file_prefix.get(path, "")
        for sym in entry.symbols:
            for deco in sym.decorators:
                m = _ROUTE_DECORATOR.search(deco)
                if m:
                    full = normalise_path(f"{mount}/{prefix}/{m.group(2)}")
                    routes.append(Route(service, m.group(1), full, path, sym.qualified))
    return routes


def client_calls_of(
    app: str, repo_map: RepoMap, root: Path, app_path: str
) -> list[ClientCall]:
    calls: list[ClientCall] = []
    dirs = CLIENT_DIRS.get(app, ())
    for path in repo_map.files:
        if not path.startswith(dirs) or repo_map.is_test_file(path):
            continue
        src = _read(root, f"{app_path}/{path}")
        for m in _PATH_LITERAL.finditer(src):
            literal = m.group(1).strip()
            if (
                len(literal) > 200
                or " " in literal
                or literal.startswith((".", "src/", "@"))
            ):
                continue  # module imports and aliases, not URLs
            if literal.endswith((".ts", ".tsx", ".js", ".json")):
                continue
            calls.append(ClientCall(app, path, literal[:120], normalise_path(literal)))
    return calls


def queue_sides(
    maps: dict[str, RepoMap], root: Path, config: BugHunterConfig
) -> list[QueueContract]:
    found: dict[str, QueueContract] = {q: QueueContract(q) for q in QUEUE_NAMES}
    for app, repo_map in maps.items():
        app_path = config.app(app).path
        for path in repo_map.files:
            if repo_map.is_test_file(path):
                continue
            src = _read(root, f"{app_path}/{path}")
            for queue in QUEUE_NAMES:
                if queue not in src:
                    continue
                tag = f"{app}:{path}"
                lowered = src.lower()
                if re.search(r"sendmessage|send_message|producer|publish", lowered):
                    found[queue].producers.append(tag)
                if re.search(
                    r"receivemessage|receive_message|consumer|@sqsmessagehandler|poll",
                    lowered,
                ):
                    found[queue].consumers.append(tag)
    return [q for q in found.values() if q.producers or q.consumers]


def build_contracts(
    config: BugHunterConfig, maps: dict[str, RepoMap], root: Path | None = None
) -> Contracts:
    root = Path(root or config.repo_root)
    routes: list[Route] = []
    for service in SERVICE_APPS:
        if service in maps:
            routes.extend(
                routes_of(service, maps[service], root, config.app(service).path)
            )
    contracts = Contracts(routes=routes)
    for app in CLIENT_DIRS:
        if app not in maps:
            continue
        for call in client_calls_of(app, maps[app], root, config.app(app).path):
            scored = [(match_quality(call.path, r.path), r) for r in routes]
            best = max((q for q, _r in scored), default=0)
            if best == 0:
                contracts.unmatched_client_calls.append(call)
                continue
            for quality, route in scored:
                if quality == best:
                    contracts.http.append(
                        HttpContract(
                            call.file,
                            call.literal,
                            route.service,
                            route.file,
                            route.symbol,
                            route.method,
                            route.path,
                        )
                    )
    contracts.queues = queue_sides(maps, root, config)
    return contracts


def save_contracts(contracts: Contracts, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contracts.to_json(), encoding="utf-8")
    return path.stat().st_size


def load_contracts(path: Path) -> Contracts | None:
    try:
        return Contracts.from_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError, TypeError):
        return None


def group_by_service(contracts: Contracts) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for c in contracts.http:
        counts[c.service] += 1
    return dict(counts)
