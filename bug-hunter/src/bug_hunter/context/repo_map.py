"""Repo map: a tree-sitter symbol index with a best-effort call graph, per app.

Per file: symbols (classes, functions, methods, exported constants, types) with
line ranges, imports, call sites, and for classes the typed fields a NestJS
constructor injects (``private readonly userService: UserService``). Calls resolve
in a fixed order and the method is recorded:

1. ``di``        ``this.<prop>.<method>()`` through the injected property's type
2. ``self``      ``this.<method>()`` / ``self.<method>()`` to the same class
3. ``same_file`` a function or class defined in the same file
4. ``import``    a name imported from a file the import resolves to
5. ``qualified`` ``Receiver.<method>()`` where ``Receiver`` is a known class
6. ``unique``    the only symbol with that name in the app
7. ``unresolved``

The cache is one gzip JSON per (app, commit) under ``runs/cache/repo-map/``; it
stores files only (symbols, imports, calls, fields). Edges are recomputed on load,
which keeps the file small. A rebuild at a new commit re-parses only files whose git
blob changed. Only the newest ``repo_map_keep_commits`` versions per app are kept.
"""

from __future__ import annotations

import gzip
import json
import re
import subprocess
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from bug_hunter.config import CACHE_DIR, BugHunterConfig
from bug_hunter.safety.paths import matches_any

LANG_BY_EXT = {".ts": "typescript", ".tsx": "tsx", ".py": "python", ".dart": "dart"}

# Calls that can never point into the app: test frameworks, builtins, loggers.
# Skipped at parse time so callee lists and resolution shares describe app code.
NOISE_CALLS: dict[str, frozenset[str]] = {
    "typescript": frozenset(
        "describe it test expect beforeEach afterEach beforeAll afterAll fn mock "
        "spyOn mockResolvedValue mockRejectedValue mockReturnValue mockImplementation "
        "mockResolvedValueOnce mockReturnValueOnce clearAllMocks resetAllMocks "
        "Number String Boolean Date Map Set Promise Array Object JSON Error parseInt "
        "parseFloat require console setTimeout setInterval clearTimeout".split()
    ),
    "python": frozenset(
        "len str int float bool dict list set tuple range enumerate zip sorted "
        "reversed "
        "min max sum any all open type object hasattr getattr setattr isinstance "
        "issubclass iter next repr format super map filter print round abs id hash "
        "callable vars locals globals Field MagicMock AsyncMock Mock patch raises "
        "SimpleNamespace fixture mark parametrize skip".split()
    ),
    "dart": frozenset(
        "expect test testWidgets group setUp tearDown setUpAll tearDownAll when verify "
        "any print".split()
    ),
}
NOISE_RECEIVER_PREFIXES: dict[str, tuple[str, ...]] = {
    "typescript": (
        "expect(",
        "jest",
        "console",
        "Math",
        "JSON",
        "Object",
        "Array",
        "Promise",
    ),
    "python": (
        "logger",
        "log",
        "logging",
        "self.logger",
        "self._logger",
        "pytest",
        "mock",
    ),
    "dart": ("expect(", "tester", "find", "debugPrint"),
}
MAX_FILE_BYTES = 400_000
SKIP_SUFFIXES = (".d.ts", ".g.dart", ".freezed.dart", ".pb.dart")
CACHE_VERSION = 2

# --- data ---------------------------------------------------------------------------


@dataclass
class Symbol:
    name: str
    qualified: str  # Class.method or name
    kind: str  # class | function | method | constant | type
    file: str  # app-relative path
    start: int
    end: int
    exported: bool = True
    decorators: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.file}::{self.qualified}"

    def to_list(self) -> list:
        return [
            self.name,
            self.qualified,
            self.kind,
            self.start,
            self.end,
            int(self.exported),
            self.decorators,
        ]

    @classmethod
    def from_list(cls, file: str, row: list) -> "Symbol":
        return cls(
            row[0], row[1], row[2], file, row[3], row[4], bool(row[5]), list(row[6])
        )


@dataclass
class Import:
    module: str
    names: list[str]
    resolved: str | None = (
        None  # app-relative path when the import points inside the app
    )


@dataclass
class Call:
    name: str
    receiver: str | None
    line: int
    caller: str | None  # qualified name of the enclosing symbol


@dataclass
class FileEntry:
    path: str
    blob: str
    lang: str
    symbols: list[Symbol] = field(default_factory=list)
    imports: list[Import] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)
    fields: dict[str, dict[str, str]] = field(
        default_factory=dict
    )  # class -> prop -> type

    def to_json(self) -> dict:
        return {
            "p": self.path,
            "b": self.blob,
            "l": self.lang,
            "s": [s.to_list() for s in self.symbols],
            "i": [[i.module, i.names, i.resolved] for i in self.imports],
            "c": [[c.name, c.receiver, c.line, c.caller] for c in self.calls],
            "f": self.fields,
        }

    @classmethod
    def from_json(cls, d: dict) -> "FileEntry":
        entry = cls(d["p"], d["b"], d["l"])
        entry.symbols = [Symbol.from_list(d["p"], row) for row in d["s"]]
        entry.imports = [Import(m, list(n), r) for m, n, r in d["i"]]
        entry.calls = [Call(n, r, ln, c) for n, r, ln, c in d["c"]]
        entry.fields = {k: dict(v) for k, v in d["f"].items()}
        return entry


@dataclass
class Edge:
    caller: str  # symbol id
    callee: str  # symbol id
    method: str
    line: int


@dataclass
class BuildStats:
    app: str
    commit: str
    files_total: int = 0
    files_parsed: int = 0
    files_reused: int = 0
    files_skipped: int = 0
    symbols: int = 0
    calls: int = 0
    resolved_by: dict[str, int] = field(default_factory=dict)
    unresolved_plausible: int = 0
    build_seconds: float = 0.0
    cache_bytes: int = 0

    def resolution_share(
        self, exclude: Iterable[str] = (), plausible_only: bool = False
    ) -> float:
        """Share of calls with a resolved target. ``exclude`` drops resolution methods
        (e.g. ``("di",)`` to see what NestJS injection adds). ``plausible_only``
        restricts the denominator to calls whose name exists as a symbol in the app,
        i.e. leaves out library and framework calls."""
        resolved_all = sum(v for k, v in self.resolved_by.items() if k != "unresolved")
        resolved = sum(
            v
            for k, v in self.resolved_by.items()
            if k != "unresolved" and k not in exclude
        )
        if plausible_only:
            total = resolved_all + self.unresolved_plausible
        else:
            total = sum(self.resolved_by.values())
        return resolved / total if total else 0.0


# --- parsing ------------------------------------------------------------------------


def _parser(lang: str):
    from tree_sitter_language_pack import get_parser

    return get_parser(lang)


def _text(node, src: bytes) -> str:
    return src[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _child(node, kind: str):
    for c in node.children:
        if c.type == kind:
            return c
    return None


def _children(node, kind: str):
    return [c for c in node.children if c.type == kind]


def _strip_quotes(s: str) -> str:
    return s.strip().strip("'\"`")


class _Parser:
    """Walks one file's tree and fills a FileEntry."""

    def __init__(self, entry: FileEntry, src: bytes):
        self.entry = entry
        self.src = src
        self.stack: list[str] = []  # enclosing qualified names

    @property
    def scope(self) -> str | None:
        return self.stack[-1] if self.stack else None

    def qualify(self, name: str) -> str:
        return f"{self.stack[0]}.{name}" if self.stack else name

    def add_symbol(
        self, name: str, kind: str, node, exported: bool, decorators=()
    ) -> Symbol:
        sym = Symbol(
            name=name,
            qualified=self.qualify(name) if kind == "method" else name,
            kind=kind,
            file=self.entry.path,
            start=node.start_point[0] + 1,
            end=node.end_point[0] + 1,
            exported=exported,
            decorators=[d[:80] for d in decorators],
        )
        self.entry.symbols.append(sym)
        return sym

    def add_call(self, name: str, receiver: str | None, node) -> None:
        if not name or len(self.entry.calls) > 20000:
            return
        family = (
            "typescript"
            if self.entry.lang in ("typescript", "tsx")
            else self.entry.lang
        )
        if name in NOISE_CALLS.get(family, ()):
            return
        if receiver and receiver.startswith(NOISE_RECEIVER_PREFIXES.get(family, ())):
            return
        if (
            family == "typescript"
            and name.startswith("to")
            and receiver
            and "expect" in receiver
        ):
            return
        self.entry.calls.append(
            Call(name, receiver, node.start_point[0] + 1, self.scope)
        )

    # ---- TypeScript / TSX -------------------------------------------------------

    def ts(self, root) -> None:
        self._ts_walk(root, exported=False, decorators=[])

    def _ts_walk(self, node, exported: bool, decorators: list[str]) -> None:
        t = node.type
        if t == "import_statement":
            self._ts_import(node)
            return
        if t == "export_statement":
            decos = [_text(d, self.src) for d in _children(node, "decorator")]
            for c in node.children:
                if c.type not in ("export", "decorator", "default", ";"):
                    self._ts_walk(c, exported=True, decorators=decos)
            return
        if t in ("class_declaration", "abstract_class_declaration"):
            name_node = _child(node, "type_identifier")
            name = _text(name_node, self.src) if name_node else "<anonymous>"
            self.add_symbol(name, "class", node, exported, decorators)
            body = _child(node, "class_body")
            if body is not None:
                self.stack.append(name)
                self._ts_class_body(name, body)
                self.stack.pop()
            return
        if t == "function_declaration":
            name_node = _child(node, "identifier")
            if name_node is not None:
                name = _text(name_node, self.src)
                self.add_symbol(name, "function", node, exported, decorators)
                self.stack.append(name)
                self._ts_scan_calls(_child(node, "statement_block"))
                self.stack.pop()
            return
        if t == "lexical_declaration":
            for decl in _children(node, "variable_declarator"):
                name_node = decl.children[0] if decl.children else None
                if name_node is None or name_node.type != "identifier":
                    continue
                name = _text(name_node, self.src)
                value = decl.children[-1]
                if value.type in ("arrow_function", "function_expression", "function"):
                    self.add_symbol(name, "function", decl, exported)
                    self.stack.append(name)
                    self._ts_scan_calls(value)
                    self.stack.pop()
                elif exported:
                    self.add_symbol(name, "constant", decl, exported)
                    self._ts_scan_calls(value)
                else:
                    self._ts_scan_calls(value)
            return
        if t in ("interface_declaration", "enum_declaration", "type_alias_declaration"):
            name_node = _child(node, "type_identifier") or _child(node, "identifier")
            if name_node is not None:
                self.add_symbol(_text(name_node, self.src), "type", node, exported)
            return
        if t in ("expression_statement", "call_expression", "new_expression"):
            self._ts_scan_calls(node)
            return
        for c in node.children:
            self._ts_walk(c, exported=False, decorators=[])

    def _ts_import(self, node) -> None:
        source = _child(node, "string")
        module = _strip_quotes(_text(source, self.src)) if source else ""
        names: list[str] = []
        clause = _child(node, "import_clause")
        if clause is not None:
            for c in clause.children:
                if c.type == "identifier":
                    names.append(_text(c, self.src))
                elif c.type == "named_imports":
                    for spec in _children(c, "import_specifier"):
                        ids = _children(spec, "identifier")
                        if ids:
                            names.append(_text(ids[-1], self.src))
                elif c.type == "namespace_import":
                    ids = _children(c, "identifier")
                    if ids:
                        names.append(_text(ids[-1], self.src))
        if module:
            self.entry.imports.append(Import(module, names))

    def _ts_class_body(self, cls: str, body) -> None:
        pending_decorators: list[str] = []
        for member in body.children:
            if member.type == "decorator":
                pending_decorators.append(_text(member, self.src))
                continue
            if member.type == "method_definition":
                name_node = _child(member, "property_identifier") or _child(
                    member, "computed_property_name"
                )
                name = _text(name_node, self.src) if name_node else "<method>"
                if name == "constructor":
                    self._ts_constructor(cls, member)
                else:
                    self.add_symbol(name, "method", member, True, pending_decorators)
                self.stack.append(f"{cls}.{name}")
                self._ts_scan_calls(_child(member, "statement_block"))
                self.stack.pop()
            elif member.type == "public_field_definition":
                name_node = _child(member, "property_identifier")
                type_ann = _child(member, "type_annotation")
                if name_node is not None and type_ann is not None:
                    self._ts_record_field(cls, _text(name_node, self.src), type_ann)
                value = member.children[-1] if member.children else None
                if value is not None and value.type in (
                    "arrow_function",
                    "function_expression",
                ):
                    name = _text(name_node, self.src) if name_node else "<field>"
                    self.add_symbol(name, "method", member, True, pending_decorators)
                    self.stack.append(f"{cls}.{name}")
                    self._ts_scan_calls(value)
                    self.stack.pop()
            pending_decorators = []

    def _ts_constructor(self, cls: str, method) -> None:
        params = _child(method, "formal_parameters")
        if params is None:
            return
        for param in params.children:
            if param.type not in ("required_parameter", "optional_parameter"):
                continue
            has_modifier = (
                _child(param, "accessibility_modifier") is not None
                or _child(param, "readonly") is not None
            )
            ident = _child(param, "identifier")
            type_ann = _child(param, "type_annotation")
            if has_modifier and ident is not None and type_ann is not None:
                self._ts_record_field(cls, _text(ident, self.src), type_ann)

    def _ts_record_field(self, cls: str, prop: str, type_ann) -> None:
        type_node = None
        for c in type_ann.children:
            if c.type in ("type_identifier", "generic_type", "nested_type_identifier"):
                type_node = c
                break
        if type_node is None:
            return
        if type_node.type == "generic_type":
            inner = _child(type_node, "type_identifier")
            type_name = _text(inner, self.src) if inner else _text(type_node, self.src)
        else:
            type_name = _text(type_node, self.src).split(".")[-1]
        self.entry.fields.setdefault(cls, {})[prop] = type_name

    def _ts_scan_calls(self, node) -> None:
        if node is None:
            return
        stack = [node]
        while stack:
            n = stack.pop()
            if n.type == "call_expression":
                fn = n.children[0] if n.children else None
                if fn is not None:
                    if fn.type == "identifier":
                        self.add_call(_text(fn, self.src), None, n)
                    elif fn.type == "member_expression":
                        prop = _child(fn, "property_identifier")
                        obj = fn.children[0] if fn.children else None
                        if prop is not None and obj is not None:
                            self.add_call(
                                _text(prop, self.src), _text(obj, self.src)[:80], n
                            )
            elif n.type == "new_expression":
                ident = _child(n, "identifier")
                if ident is not None:
                    self.add_call(_text(ident, self.src), None, n)
            # nested declarations keep the enclosing scope; fine for a map
            stack.extend(reversed(n.children))

    # ---- Python -----------------------------------------------------------------

    def py(self, root) -> None:
        for node in root.children:
            self._py_top(node, [])

    def _py_top(self, node, decorators: list[str]) -> None:
        t = node.type
        if t == "decorated_definition":
            decos = [_text(d, self.src) for d in _children(node, "decorator")]
            inner = node.children[-1]
            self._py_top(inner, decos)
            return
        if t == "import_statement":
            for c in node.children:
                if c.type == "dotted_name":
                    self.entry.imports.append(Import(_text(c, self.src), []))
                elif c.type == "aliased_import":
                    dn = _child(c, "dotted_name")
                    if dn is not None:
                        self.entry.imports.append(Import(_text(dn, self.src), []))
            return
        if t == "import_from_statement":
            module_node = _child(node, "dotted_name") or _child(node, "relative_import")
            module = _text(module_node, self.src) if module_node else ""
            names: list[str] = []
            seen_import = False
            for c in node.children:
                if c.type == "import":
                    seen_import = True
                    continue
                if not seen_import:
                    continue
                if c.type == "dotted_name":
                    names.append(_text(c, self.src))
                elif c.type == "aliased_import":
                    ids = _children(c, "identifier")
                    dn = _child(c, "dotted_name")
                    names.append(
                        _text(ids[-1], self.src) if ids else _text(dn, self.src)
                    )
                elif c.type == "wildcard_import":
                    names.append("*")
            if module:
                self.entry.imports.append(Import(module, names))
            return
        if t == "class_definition":
            name = _text(_child(node, "identifier"), self.src)
            self.add_symbol(name, "class", node, not name.startswith("_"), decorators)
            body = _child(node, "block")
            if body is not None:
                self.stack.append(name)
                for member in body.children:
                    self._py_member(member, [])
                self.stack.pop()
            return
        if t == "function_definition":
            name = _text(_child(node, "identifier"), self.src)
            self.add_symbol(
                name, "function", node, not name.startswith("_"), decorators
            )
            self.stack.append(name)
            self._py_scan_calls(_child(node, "block"))
            self.stack.pop()
            return
        if t in ("expression_statement", "assignment"):
            assign = node if t == "assignment" else _child(node, "assignment")
            if (
                assign is not None
                and assign.children
                and assign.children[0].type == "identifier"
            ):
                name = _text(assign.children[0], self.src)
                if name.isupper() or re.match(r"^[A-Z][A-Z0-9_]+$", name):
                    self.add_symbol(name, "constant", node, True)
            self._py_scan_calls(node)
            return
        self._py_scan_calls(node)

    def _py_member(self, node, decorators: list[str]) -> None:
        if node.type == "decorated_definition":
            decos = [_text(d, self.src) for d in _children(node, "decorator")]
            self._py_member(node.children[-1], decos)
            return
        if node.type == "function_definition":
            name = _text(_child(node, "identifier"), self.src)
            self.add_symbol(name, "method", node, not name.startswith("_"), decorators)
            self.stack.append(f"{self.stack[0]}.{name}")
            self._py_scan_calls(_child(node, "block"))
            self.stack.pop()
            return
        self._py_scan_calls(node)

    def _py_scan_calls(self, node) -> None:
        if node is None:
            return
        stack = [node]
        while stack:
            n = stack.pop()
            if n.type == "call" and n.children:
                fn = n.children[0]
                if fn.type == "identifier":
                    self.add_call(_text(fn, self.src), None, n)
                elif fn.type == "attribute":
                    ids = _children(fn, "identifier")
                    if ids:
                        obj = fn.children[0]
                        self.add_call(
                            _text(ids[-1], self.src), _text(obj, self.src)[:80], n
                        )
            stack.extend(reversed(n.children))

    # ---- Dart -------------------------------------------------------------------

    def dart(self, root) -> None:
        children = root.children
        i = 0
        while i < len(children):
            node = children[i]
            t = node.type
            if t == "import_or_export":
                uri = None
                stack = [node]
                while stack and uri is None:
                    n = stack.pop()
                    if n.type == "string_literal":
                        uri = _strip_quotes(_text(n, self.src))
                    stack.extend(n.children)
                if uri:
                    self.entry.imports.append(Import(uri, []))
            elif (
                t == "class_definition"
                or t == "mixin_declaration"
                or t == "enum_declaration"
            ):
                ident = _child(node, "identifier")
                name = _text(ident, self.src) if ident else "<class>"
                self.add_symbol(
                    name,
                    "class" if t != "enum_declaration" else "type",
                    node,
                    not name.startswith("_"),
                )
                body = _child(node, "class_body") or _child(node, "enum_body")
                if body is not None:
                    self.stack.append(name)
                    self._dart_class_body(name, body)
                    self.stack.pop()
            elif t == "function_signature":
                ident = _child(node, "identifier")
                name = _text(ident, self.src) if ident else None
                body = (
                    children[i + 1]
                    if i + 1 < len(children) and children[i + 1].type == "function_body"
                    else None
                )
                if name:
                    end_node = body or node
                    sym = self.add_symbol(
                        name, "function", node, not name.startswith("_")
                    )
                    sym.end = end_node.end_point[0] + 1
                    self.stack.append(name)
                    self._dart_scan_calls(body)
                    self.stack.pop()
                if body is not None:
                    i += 1
            elif t in (
                "static_final_declaration_list",
                "initialized_variable_definition",
            ):
                for decl in node.children:
                    ident = (
                        _child(decl, "identifier")
                        if decl.type != "identifier"
                        else decl
                    )
                    if ident is not None:
                        name = _text(ident, self.src)
                        if not name.startswith("_"):
                            self.add_symbol(name, "constant", node, True)
            else:
                self._dart_scan_calls(node)
            i += 1

    def _dart_class_body(self, cls: str, body) -> None:
        members = body.children
        i = 0
        while i < len(members):
            m = members[i]
            if m.type == "declaration":
                type_node = _child(m, "type_identifier")
                id_list = _child(m, "initialized_identifier_list")
                if type_node is not None and id_list is not None:
                    for init in _children(id_list, "initialized_identifier"):
                        ident = _child(init, "identifier")
                        if ident is not None:
                            self.entry.fields.setdefault(cls, {})[
                                _text(ident, self.src)
                            ] = _text(type_node, self.src)
                self._dart_scan_calls(m)
            elif m.type in (
                "method_signature",
                "function_signature",
                "getter_signature",
                "setter_signature",
                "constructor_signature",
                "factory_constructor_signature",
            ):
                sig = _child(m, "function_signature") or m
                ident = _child(sig, "identifier")
                name = _text(ident, self.src) if ident is not None else None
                body = (
                    members[i + 1]
                    if i + 1 < len(members) and members[i + 1].type == "function_body"
                    else None
                )
                if name:
                    sym = self.add_symbol(name, "method", m, not name.startswith("_"))
                    sym.end = (body or m).end_point[0] + 1
                    self.stack.append(f"{cls}.{name}")
                    self._dart_scan_calls(body)
                    self.stack.pop()
                if body is not None:
                    i += 1
            else:
                self._dart_scan_calls(m)
            i += 1

    def _dart_scan_calls(self, node) -> None:
        """Dart calls are ``identifier`` + ``selector`` siblings: ``a.b(1)`` is
        identifier(a) selector(.b) selector((1))."""
        if node is None:
            return
        stack = [node]
        while stack:
            n = stack.pop()
            kids = n.children
            for idx, c in enumerate(kids):
                if c.type != "identifier":
                    continue
                name = _text(c, self.src)
                receiver = None
                j = idx + 1
                while j < len(kids) and kids[j].type == "selector":
                    sel = kids[j]
                    arg = _child(sel, "argument_part")
                    if arg is not None:
                        self.add_call(name, receiver, sel)
                        break
                    ids = []
                    s2 = [sel]
                    while s2:
                        x = s2.pop()
                        if x.type == "identifier":
                            ids.append(_text(x, self.src))
                        s2.extend(x.children)
                    if ids:
                        receiver = name if receiver is None else f"{receiver}.{name}"
                        name = ids[-1]
                    j += 1
            stack.extend(reversed(kids))


def parse_file(path: str, blob: str, lang: str, src: bytes) -> FileEntry:
    entry = FileEntry(path=path, blob=blob, lang=lang)
    tree = _parser(lang).parse(src)
    parser = _Parser(entry, src)
    if lang in ("typescript", "tsx"):
        parser.ts(tree.root_node)
    elif lang == "python":
        parser.py(tree.root_node)
    elif lang == "dart":
        parser.dart(tree.root_node)
    return entry


# --- import resolution --------------------------------------------------------------


def resolve_import(
    module: str, from_file: str, lang: str, known: set[str], app: str
) -> str | None:
    """App-relative path the import points to, if it is inside the app."""
    base = PurePosixPath(from_file).parent

    def first_existing(candidates: Iterable[str]) -> str | None:
        for c in candidates:
            norm = str(PurePosixPath(c))
            if norm in known:
                return norm
        return None

    if lang in ("typescript", "tsx"):
        if module.startswith("."):
            target = base / module
            stem = _normalise(str(target))
        elif module.startswith("src/"):
            stem = module
        else:
            return None
        return first_existing(
            [
                stem,
                f"{stem}.ts",
                f"{stem}.tsx",
                f"{stem}/index.ts",
                f"{stem}/index.tsx",
                f"{stem}.js",
            ]
        )
    if lang == "python":
        if module.startswith("."):
            return None
        rel = module.replace(".", "/")
        return first_existing([f"{rel}.py", f"{rel}/__init__.py"])
    if lang == "dart":
        if module.startswith("package:"):
            parts = module[len("package:") :].split("/", 1)
            if len(parts) == 2:
                return first_existing([f"lib/{parts[1]}"])
            return None
        if module.startswith("dart:"):
            return None
        return first_existing([_normalise(str(base / module))])
    return None


def _normalise(path: str) -> str:
    parts: list[str] = []
    for part in path.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


# --- the map -------------------------------------------------------------------------


class RepoMap:
    def __init__(
        self,
        app: str,
        commit: str,
        files: dict[str, FileEntry],
        config: BugHunterConfig | None = None,
    ):
        self.app = app
        self.commit = commit
        self.files = files
        self.config = config
        self.symbols: dict[str, Symbol] = {}
        self.by_name: dict[str, list[Symbol]] = defaultdict(list)
        self.by_qualified: dict[str, list[Symbol]] = defaultdict(list)
        self.edges: list[Edge] = []
        self.unresolved: list[tuple[str, str, str | None]] = (
            []
        )  # (caller id or file, name, receiver)
        self.resolved_by: Counter = Counter()
        self.unresolved_plausible = 0  # unresolved calls whose name exists as a symbol
        self._callers: dict[str, list[Edge]] = defaultdict(list)
        self._callees: dict[str, list[Edge]] = defaultdict(list)
        self._importers: dict[str, list[str]] = defaultdict(list)
        self._build_indexes()

    # ---- indexes -----------------------------------------------------------------

    def _build_indexes(self) -> None:
        known = set(self.files)
        for entry in self.files.values():
            for sym in entry.symbols:
                self.symbols[sym.id] = sym
                self.by_name[sym.name].append(sym)
                self.by_qualified[sym.qualified].append(sym)
            for imp in entry.imports:
                if imp.resolved is None:
                    imp.resolved = resolve_import(
                        imp.module, entry.path, entry.lang, known, self.app
                    )
                if imp.resolved:
                    self._importers[imp.resolved].append(entry.path)
        for entry in self.files.values():
            self._resolve_calls(entry)

    def _symbols_in_file(self, path: str) -> dict[str, list[Symbol]]:
        out: dict[str, list[Symbol]] = defaultdict(list)
        for sym in self.files[path].symbols:
            out[sym.name].append(sym)
            out[sym.qualified].append(sym)
        return out

    def _resolve_calls(self, entry: FileEntry) -> None:
        local = self._symbols_in_file(entry.path)
        imported: dict[str, str] = {}
        for imp in entry.imports:
            if imp.resolved:
                for name in imp.names:
                    imported[name] = imp.resolved
        for call in entry.calls:
            caller_id = f"{entry.path}::{call.caller}" if call.caller else entry.path
            cls = (
                call.caller.split(".")[0]
                if call.caller and "." in call.caller
                else None
            )
            target, method = self._resolve_one(call, entry, local, imported, cls)
            if target is None:
                self.resolved_by["unresolved"] += 1
                if call.name in self.by_name:
                    self.unresolved_plausible += 1
                if len(self.unresolved) < 20000:
                    self.unresolved.append((caller_id, call.name, call.receiver))
                continue
            self.resolved_by[method] += 1
            edge = Edge(caller_id, target.id, method, call.line)
            self.edges.append(edge)
            self._callees[caller_id].append(edge)
            self._callers[target.id].append(edge)

    def _resolve_one(
        self, call: Call, entry: FileEntry, local, imported, cls
    ) -> tuple[Symbol | None, str]:
        receiver = call.receiver
        name = call.name
        # 1. injected property: this.<prop>.<method>() / self.<prop>.<method>()
        if (
            receiver
            and cls
            and receiver.count(".") == 1
            and receiver.split(".")[0] in ("this", "self")
        ):
            prop = receiver.split(".")[1]
            type_name = entry.fields.get(cls, {}).get(prop)
            if type_name:
                hits = [
                    s
                    for s in self.by_qualified.get(f"{type_name}.{name}", [])
                    if s.kind == "method"
                ]
                if len(hits) >= 1:
                    return hits[0], "di"
        # 2. own method
        if receiver in ("this", "self") and cls:
            hits = [s for s in local.get(f"{cls}.{name}", []) if s.kind == "method"]
            if hits:
                return hits[0], "self"
            hits = [
                s
                for s in self.by_qualified.get(f"{cls}.{name}", [])
                if s.kind == "method"
            ]
            if hits:
                return hits[0], "self"
        # 2b. field without this. prefix: `api.fetch()` where `api` is typed
        if receiver and cls and "." not in receiver:
            type_name = entry.fields.get(cls, {}).get(receiver)
            if type_name:
                hits = [
                    s
                    for s in self.by_qualified.get(f"{type_name}.{name}", [])
                    if s.kind == "method"
                ]
                if hits:
                    return hits[0], "di"
        if receiver is None:
            # 3. same file
            hits = [s for s in local.get(name, []) if s.kind in ("function", "class")]
            if hits:
                return hits[0], "same_file"
            # 4. imported name
            target_file = imported.get(name)
            if target_file and target_file in self.files:
                hits = [
                    s
                    for s in self.files[target_file].symbols
                    if s.name == name and s.kind in ("function", "class", "constant")
                ]
                if hits:
                    return hits[0], "import"
            # 6. unique in app (never a test-file symbol for app code)
            hits = self._unique_candidates(name, ("function", "class"), entry.path)
            if len(hits) == 1:
                return hits[0], "unique"
            return None, "unresolved"
        # 5. Receiver.method() where Receiver is a known class or module import
        head = receiver.split(".")[-1]
        hits = [
            s for s in self.by_qualified.get(f"{head}.{name}", []) if s.kind == "method"
        ]
        if len(hits) == 1:
            return hits[0], "qualified"
        if head in imported and imported[head] in self.files:
            hits = [
                s
                for s in self.files[imported[head]].symbols
                if s.name == name and s.kind == "function"
            ]
            if hits:
                return hits[0], "import"
        # 6. unique method name in app (never a test-file symbol for app code)
        hits = self._unique_candidates(name, ("method",), entry.path)
        if len(hits) == 1:
            return hits[0], "unique"
        return None, "unresolved"

    def _unique_candidates(
        self, name: str, kinds: tuple[str, ...], caller_file: str
    ) -> list[Symbol]:
        hits = [s for s in self.by_name.get(name, []) if s.kind in kinds]
        if not self.is_test_file(caller_file):
            hits = [s for s in hits if not self.is_test_file(s.file)]
        return hits

    # ---- queries --------------------------------------------------------------------

    def outline(self, file: str) -> str:
        entry = self.files.get(file)
        if entry is None:
            return (
                f"{file}: not in the map (not a ts/tsx/py/dart source file of "
                f"{self.app}, or not tracked)"
            )
        lines = [
            f"{file} ({entry.lang}, {len(entry.symbols)} symbols, "
            f"{len(entry.imports)} imports)"
        ]
        for sym in entry.symbols:
            flag = "" if sym.exported else " (private)"
            deco = f"  {' '.join(sym.decorators)[:60]}" if sym.decorators else ""
            lines.append(
                f"  {sym.start:>5}-{sym.end:<5} {sym.kind:<9} "
                f"{sym.qualified}{flag}{deco}"
            )
        internal = [i.module for i in entry.imports if i.resolved]
        if internal:
            lines.append("  imports (in-app): " + ", ".join(internal[:20]))
        return "\n".join(lines)

    def find_symbol(self, name: str, limit: int = 20) -> list[Symbol]:
        exact = self.by_qualified.get(name) or self.by_name.get(name)
        if exact:
            return list(exact)[:limit]
        needle = name.lower()
        hits = [s for s in self.symbols.values() if needle in s.qualified.lower()]
        if not hits:  # a file name: its top-level symbols
            hits = [
                s
                for path, entry in self.files.items()
                if needle in path.lower()
                for s in entry.symbols
                if s.kind != "method"
            ]
        hits.sort(key=lambda s: (len(s.qualified), s.file))
        return hits[:limit]

    def _resolve_symbol_arg(self, symbol: str) -> list[Symbol]:
        if symbol in self.symbols:
            return [self.symbols[symbol]]
        return self.find_symbol(symbol, limit=5)

    def callers(self, symbol: str) -> list[Edge]:
        out: list[Edge] = []
        for sym in self._resolve_symbol_arg(symbol):
            out.extend(self._callers.get(sym.id, []))
        return out

    def callees(self, symbol: str) -> list[Edge]:
        out: list[Edge] = []
        for sym in self._resolve_symbol_arg(symbol):
            out.extend(self._callees.get(sym.id, []))
        return out

    def is_test_file(self, path: str) -> bool:
        if self.config is not None:
            return matches_any(path, self.config.app(self.app).test_dirs) is not None
        return bool(
            re.search(r"(\.spec\.|\.test\.|/tests?/|__tests__|_test\.dart$)", path)
        )

    def tests_for(self, target: str) -> list[str]:
        """Test files for an app-relative file path or a symbol name."""
        files: list[str] = []
        if target in self.files:
            files = [target]
        else:
            files = sorted({s.file for s in self.find_symbol(target, limit=10)})
        found: list[str] = []
        for file in files:
            found.extend(self._tests_for_file(file))
        if target not in self.files:  # symbol: also tests that call it by name
            for sym in self.find_symbol(target, limit=10):
                for edge in self._callers.get(sym.id, []):
                    caller_file = edge.caller.split("::")[0]
                    if self.is_test_file(caller_file):
                        found.append(caller_file)
        seen: dict[str, None] = {}
        for f in found:
            seen.setdefault(f, None)
        return list(seen)

    def _tests_for_file(self, file: str) -> list[str]:
        p = PurePosixPath(file)
        stem = p.name.rsplit(".", 1)[0]
        d = str(p.parent)
        candidates: list[str] = []
        if file.endswith((".ts", ".tsx")):
            base = stem
            candidates += [
                f"{d}/test/{base}.spec.ts",
                f"{d}/{base}.spec.ts",
                f"{d}/__tests__/{base}.test.ts",
                f"{d}/__tests__/{base}.test.tsx",
                f"{d}/{base}.test.ts",
                f"{d}/{base}.test.tsx",
            ]
        elif file.endswith(".py"):
            candidates += [
                f
                for f in self.files
                if f.startswith("tests/") and PurePosixPath(f).name == f"test_{stem}.py"
            ]
        elif file.endswith(".dart"):
            if file.startswith("lib/"):
                candidates.append(f"test/{file[4:-5]}_test.dart")
            candidates += [
                f
                for f in self.files
                if f.startswith("test/")
                and PurePosixPath(f).name == f"{stem}_test.dart"
            ]
        found = [c for c in candidates if c in self.files]
        found += [
            imp for imp in self._importers.get(file, []) if self.is_test_file(imp)
        ]
        return list(dict.fromkeys(found))

    def symbols_in_range(self, file: str, start: int, end: int) -> list[Symbol]:
        entry = self.files.get(file)
        if entry is None:
            return []
        return [
            s
            for s in entry.symbols
            if s.start <= end and s.end >= start and s.kind != "class"
        ] or [s for s in entry.symbols if s.start <= end and s.end >= start]

    # ---- neighbourhood ----

    def neighbourhood(self, diff: str, max_items: int = 40) -> "Neighbourhood":
        changed = parse_unified_diff(diff)
        app_path = self.config.app(self.app).path if self.config else self.app
        items: list[NeighbourhoodItem] = []
        for repo_path, ranges in changed.items():
            file = repo_path
            if file.startswith(app_path + "/"):
                file = file[len(app_path) + 1 :]
            if file not in self.files:
                continue
            seen: set[str] = set()
            for start, end in ranges:
                for sym in self.symbols_in_range(file, start, end):
                    if sym.id in seen:
                        continue
                    seen.add(sym.id)
                    items.append(
                        NeighbourhoodItem(
                            symbol=sym,
                            callers=self._callers.get(sym.id, [])[:max_items],
                            callees=self._callees.get(sym.id, [])[:max_items],
                            tests=self._tests_for_file(file),
                        )
                    )
        return Neighbourhood(self.app, list(changed), items)


@dataclass
class NeighbourhoodItem:
    symbol: Symbol
    callers: list[Edge]
    callees: list[Edge]
    tests: list[str]


@dataclass
class Neighbourhood:
    app: str
    changed_files: list[str]
    items: list[NeighbourhoodItem]

    def render(self, max_edges: int = 12) -> str:
        lines = [f"Changed files: {', '.join(self.changed_files) or '(none in map)'}"]
        for item in self.items:
            s = item.symbol
            lines.append(f"\n## {s.kind} {s.qualified}  ({s.file}:{s.start}-{s.end})")
            callers = _dedupe(item.callers, "caller")
            callees = _dedupe(item.callees, "callee")
            if callers:
                lines.append("callers:")
                for e in callers[:max_edges]:
                    lines.append(f"  - {e.caller} (line {e.line}, via {e.method})")
                if len(callers) > max_edges:
                    lines.append(f"  … {len(callers) - max_edges} more")
            if callees:
                lines.append("callees:")
                for e in callees[:max_edges]:
                    lines.append(f"  - {e.callee} (via {e.method})")
                if len(callees) > max_edges:
                    lines.append(f"  … {len(callees) - max_edges} more")
            if item.tests:
                lines.append("tests: " + ", ".join(item.tests[:8]))
        return "\n".join(lines)


def _dedupe(edges: list[Edge], attr: str) -> list[Edge]:
    seen: dict[str, Edge] = {}
    for e in edges:
        seen.setdefault(getattr(e, attr), e)
    return list(seen.values())


_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.MULTILINE)


def parse_unified_diff(diff: str) -> dict[str, list[tuple[int, int]]]:
    """``{path: [(start, end), …]}`` of new-side line ranges per changed file."""
    result: dict[str, list[tuple[int, int]]] = {}
    current: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path == "/dev/null":
                current = None
                continue
            if path.startswith("b/"):
                path = path[2:]
            current = path
            result.setdefault(current, [])
            continue
        if current and line.startswith("@@"):
            m = _HUNK.match(line)
            if m:
                start = int(m.group(1))
                count = int(m.group(2)) if m.group(2) is not None else 1
                result[current].append((start, max(start, start + count - 1)))
    return result


# --- building and caching ----


def _git_blobs(root: Path, app_path: str) -> dict[str, str]:
    """``{app-relative path: blob sha}`` for tracked source files of the app."""
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-s", "--", app_path],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    blobs: dict[str, str] = {}
    prefix = app_path + "/"
    for line in out.splitlines():
        try:
            meta, path = line.split("\t", 1)
        except ValueError:
            continue
        sha = meta.split()[1]
        if not path.startswith(prefix):
            continue
        rel = path[len(prefix) :]
        if PurePosixPath(rel).suffix not in LANG_BY_EXT or rel.endswith(SKIP_SUFFIXES):
            continue
        blobs[rel] = sha
    return blobs


def cache_dir_for(app: str, cache_root: Path = CACHE_DIR) -> Path:
    return cache_root / "repo-map" / app


def cache_path(app: str, commit: str, cache_root: Path = CACHE_DIR) -> Path:
    return cache_dir_for(app, cache_root) / f"{commit}.json.gz"


def _load_cached(path: Path) -> dict[str, FileEntry] | None:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if data.get("v") != CACHE_VERSION:
        return None
    return {d["p"]: FileEntry.from_json(d) for d in data["files"]}


def _save_cached(path: Path, app: str, commit: str, files: dict[str, FileEntry]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "v": CACHE_VERSION,
        "app": app,
        "commit": commit,
        "files": [f.to_json() for f in files.values()],
    }
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
        json.dump(payload, fh, separators=(",", ":"))
    tmp.replace(path)
    return path.stat().st_size


def _latest_cached(app: str, cache_root: Path) -> Path | None:
    folder = cache_dir_for(app, cache_root)
    if not folder.is_dir():
        return None
    candidates = sorted(
        folder.glob("*.json.gz"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    return candidates[0] if candidates else None


def prune_cache(app: str, keep: int, cache_root: Path = CACHE_DIR) -> list[Path]:
    folder = cache_dir_for(app, cache_root)
    if not folder.is_dir():
        return []
    files = sorted(
        folder.glob("*.json.gz"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    removed = []
    for old in files[keep:]:
        old.unlink(missing_ok=True)
        removed.append(old)
    return removed


def build_map(
    config: BugHunterConfig,
    app: str,
    root: Path | None = None,
    commit: str | None = None,
    cache_root: Path = CACHE_DIR,
    use_cache: bool = True,
) -> tuple[RepoMap, BuildStats]:
    """Build (or load) the map of ``app`` as checked out at ``root`` (a worktree or
    the repo root). ``commit`` defaults to that checkout's HEAD."""
    root = Path(root or config.repo_root).resolve()
    app_path = config.app(app).path
    if commit is None:
        commit = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    started = time.monotonic()
    stats = BuildStats(app=app, commit=commit)
    target = cache_path(app, commit, cache_root)

    previous: dict[str, FileEntry] = {}
    if use_cache:
        if target.exists():
            cached = _load_cached(target)
            if cached is not None:
                repo_map = RepoMap(app, commit, cached, config)
                stats.files_total = stats.files_reused = len(cached)
                stats.symbols = len(repo_map.symbols)
                stats.calls = sum(len(f.calls) for f in cached.values())
                stats.resolved_by = dict(repo_map.resolved_by)
                stats.unresolved_plausible = repo_map.unresolved_plausible
                stats.build_seconds = round(time.monotonic() - started, 2)
                stats.cache_bytes = target.stat().st_size
                return repo_map, stats
        latest = _latest_cached(app, cache_root)
        if latest is not None:
            previous = _load_cached(latest) or {}

    blobs = _git_blobs(root, app_path)
    files: dict[str, FileEntry] = {}
    stats.files_total = len(blobs)
    for rel, sha in blobs.items():
        prev = previous.get(rel)
        if prev is not None and prev.blob == sha:
            prev.imports = [Import(i.module, i.names, None) for i in prev.imports]
            files[rel] = prev
            stats.files_reused += 1
            continue
        full = root / app_path / rel
        try:
            if full.stat().st_size > MAX_FILE_BYTES:
                stats.files_skipped += 1
                continue
            src = full.read_bytes()
        except OSError:
            stats.files_skipped += 1
            continue
        files[rel] = parse_file(rel, sha, LANG_BY_EXT[PurePosixPath(rel).suffix], src)
        stats.files_parsed += 1

    repo_map = RepoMap(app, commit, files, config)
    stats.symbols = len(repo_map.symbols)
    stats.calls = sum(len(f.calls) for f in files.values())
    stats.resolved_by = dict(repo_map.resolved_by)
    stats.unresolved_plausible = repo_map.unresolved_plausible
    if use_cache:
        stats.cache_bytes = _save_cached(target, app, commit, files)
        prune_cache(app, config.limits.context.repo_map_keep_commits, cache_root)
    stats.build_seconds = round(time.monotonic() - started, 2)
    return repo_map, stats


def stats_table(stats: Iterable[BuildStats]) -> str:
    rows = [
        "| App | Files | Parsed | Reused | Symbols | Calls | Resolved "
        "| Build (s) | Cache |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for s in stats:
        rows.append(
            f"| {s.app} | {s.files_total} | {s.files_parsed} | {s.files_reused} "
            f"| {s.symbols} | {s.calls} | {s.resolution_share():.0%} "
            f"| {s.build_seconds} | {s.cache_bytes / 1024:.0f} KB |"
        )
    return "\n".join(rows)


def resolution_report(stats: BuildStats) -> dict[str, Any]:
    total = sum(stats.resolved_by.values())
    return {
        "calls": total,
        "by_method": dict(sorted(stats.resolved_by.items(), key=lambda kv: -kv[1])),
        "unresolved_plausible": stats.unresolved_plausible,
        "resolved_share": round(stats.resolution_share(), 4),
        "resolved_share_without_di": round(stats.resolution_share(exclude=("di",)), 4),
        "plausible_share": round(stats.resolution_share(plausible_only=True), 4),
        "plausible_share_without_di": round(
            stats.resolution_share(exclude=("di",), plausible_only=True), 4
        ),
    }
