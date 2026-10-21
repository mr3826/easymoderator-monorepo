#!/usr/bin/env python3
"""Redact simulator text and remove raster captures from Playwright evidence archives."""

from __future__ import annotations

import argparse
from collections import deque
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
import tempfile
import zipfile


SCRIPT_ROOT = Path(__file__).resolve().parent
SCANNER_PATH = SCRIPT_ROOT / "scan-artifact-privacy.py"
_SCANNER_SPEC = importlib.util.spec_from_file_location("artifact_privacy_scanner", SCANNER_PATH)
if _SCANNER_SPEC is None or _SCANNER_SPEC.loader is None:
    raise RuntimeError("Could not load the artifact privacy scanner.")
SCANNER = importlib.util.module_from_spec(_SCANNER_SPEC)
_SCANNER_SPEC.loader.exec_module(SCANNER)

EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])")
TEXT_EXTENSIONS = SCANNER.ARCHIVE_TEXT_EXTENSIONS | {".webmanifest"}
ZIP_SIGNATURES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


class TraceRedactor:
    """Replace exact simulator strings and common contact/profile patterns."""

    def __init__(self, exact_source_values: set[str], profile_names: set[str]) -> None:
        alternatives = {
            value.casefold() for value in exact_source_values
            if len(value) >= SCANNER.MINIMUM_CHARACTER_LENGTH
        }
        self.exact_patterns = MultiLiteralPattern(alternatives) if alternatives else None
        names = sorted({name for name in profile_names if len(name) >= 3}, key=len, reverse=True)
        self.profile_pattern = re.compile(
            r"(?<!\w)(?:" + "|".join(re.escape(name) for name in names) + r")(?!\w)",
            re.IGNORECASE,
        ) if names else None
        self.replacements = {
            "exactSourceText": 0,
            "contactPatterns": 0,
            "addresses": 0,
            "profileNames": 0,
            "emails": 0,
            "archiveMemberNames": 0,
        }

    @classmethod
    def from_csv(cls, source_csv: Path) -> "TraceRedactor":
        with source_csv.open("r", encoding="utf-8-sig", newline="") as source_file:
            rows = list(csv.DictReader(source_file))
        if not rows:
            raise ValueError("The simulator CSV contains no rows.")
        exact_source_values = {
            value for row in rows for value in row.values()
            if value and len(value) >= SCANNER.MINIMUM_CHARACTER_LENGTH
        }
        profile_names = {
            row.get("Customer_Profile", "").split(",", 1)[0].strip()
            for row in rows
            if row.get("Customer_Profile")
        }
        return cls(exact_source_values, profile_names)

    def redact(self, text: str) -> str:
        if self.exact_patterns:
            text, count = self.exact_patterns.replace(text, "[source text redacted]")
            self.replacements["exactSourceText"] += count
        text = self._sub("contactPatterns", SCANNER.BANGLADESH_CONTACT_PATTERN, text, "[contact redacted]")
        text = self._sub("addresses", SCANNER.ADDRESS_PATTERN, text, "[address redacted]")
        if self.profile_pattern:
            text = self._sub("profileNames", self.profile_pattern, text, "[profile redacted]")
        return self._sub("emails", EMAIL_PATTERN, text, "[email redacted]")

    def _sub(self, counter: str, pattern: re.Pattern[str], text: str, replacement: str) -> str:
        text, count = pattern.subn(replacement, text)
        self.replacements[counter] += count
        return text


class MultiLiteralPattern:
    """Aho-Corasick replacement for many exact values without regex backtracking."""

    def __init__(self, patterns: set[str]) -> None:
        self.transitions: list[dict[str, int]] = [{}]
        self.failures: list[int] = [0]
        self.outputs: list[list[int]] = [[]]
        for pattern in patterns:
            state = 0
            for character in pattern.casefold():
                next_state = self.transitions[state].get(character)
                if next_state is None:
                    next_state = len(self.transitions)
                    self.transitions[state][character] = next_state
                    self.transitions.append({})
                    self.failures.append(0)
                    self.outputs.append([])
                state = next_state
            self.outputs[state].append(len(pattern))

        pending: deque[int] = deque(self.transitions[0].values())
        while pending:
            state = pending.popleft()
            for character, next_state in self.transitions[state].items():
                pending.append(next_state)
                fallback = self.failures[state]
                while fallback and character not in self.transitions[fallback]:
                    fallback = self.failures[fallback]
                self.failures[next_state] = self.transitions[fallback].get(character, 0)
                self.outputs[next_state].extend(self.outputs[self.failures[next_state]])

    def replace(self, text: str, replacement: str) -> tuple[str, int]:
        state = 0
        ranges: list[tuple[int, int]] = []
        folded = text.casefold()
        # casefold can expand some Unicode characters; trace text is indexed by
        # code point, so only use this fast path when folding preserves offsets.
        if len(folded) != len(text):
            return self._replace_preserving_casefold(text, replacement)
        for index, character in enumerate(folded):
            while state and character not in self.transitions[state]:
                state = self.failures[state]
            state = self.transitions[state].get(character, 0)
            if self.outputs[state]:
                length = max(self.outputs[state])
                ranges.append((index - length + 1, index + 1))
        if not ranges:
            return text, 0
        return self._apply_ranges(text, ranges, replacement)

    def _replace_preserving_casefold(self, text: str, replacement: str) -> tuple[str, int]:
        folded_parts: list[str] = []
        folded_to_original: list[int] = []
        for index, character in enumerate(text):
            folded_character = character.casefold()
            folded_parts.append(folded_character)
            folded_to_original.extend([index] * len(folded_character))
        folded = "".join(folded_parts)
        state = 0
        ranges: list[tuple[int, int]] = []
        for index, character in enumerate(folded):
            while state and character not in self.transitions[state]:
                state = self.failures[state]
            state = self.transitions[state].get(character, 0)
            if self.outputs[state]:
                length = max(self.outputs[state])
                start = folded_to_original[index - length + 1]
                end = folded_to_original[index] + 1
                ranges.append((start, end))
        if not ranges:
            return text, 0
        return self._apply_ranges(text, ranges, replacement)

    @staticmethod
    def _apply_ranges(text: str, ranges: list[tuple[int, int]], replacement: str) -> tuple[str, int]:
        ranges.sort(key=lambda match: (match[0], -(match[1] - match[0])))
        result: list[str] = []
        cursor = 0
        count = 0
        for start, end in ranges:
            if start < cursor:
                continue
            result.extend((text[cursor:start], replacement))
            cursor = end
            count += 1
        result.append(text[cursor:])
        return "".join(result), count


def looks_like_utf8_text(filename: str, payload: bytes) -> bool:
    if not payload or b"\x00" in payload[:8192]:
        return False
    extension = Path(filename).suffix.casefold()
    if extension in TEXT_EXTENSIONS:
        try:
            payload.decode("utf-8")
            return True
        except UnicodeDecodeError:
            return False
    sample = payload[:8192]
    try:
        decoded = sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    controls = sum(
        ord(character) < 32 and character not in "\n\r\t\f\b" for character in decoded
    )
    return controls <= max(1, len(decoded) // 100)


def sanitize_archive_bytes(
    payload: bytes,
    redactor: TraceRedactor,
    depth: int = 0,
    redact_text: bool = True,
) -> tuple[bytes, dict[str, int]]:
    """Rewrite an archive recursively, removing raster and other opaque payloads."""
    if depth > 4:
        return b"", {
            "archives": 0,
            "rasterMembersRemoved": 0,
            "opaqueMembersRemoved": 1,
            "textMembersRedacted": 0,
            "archiveMemberNameCollisionsResolved": 0,
        }
    source_buffer = io.BytesIO(payload)
    output_buffer = io.BytesIO()
    totals = {
        "archives": 1,
        "rasterMembersRemoved": 0,
        "opaqueMembersRemoved": 0,
        "textMembersRedacted": 0,
        "archiveMemberNameCollisionsResolved": 0,
    }
    with zipfile.ZipFile(source_buffer, "r") as source_archive:
        with zipfile.ZipFile(output_buffer, "w", compression=zipfile.ZIP_DEFLATED) as target_archive:
            target_archive.comment = b""
            used_names: set[str] = set()
            for member in source_archive.infolist():
                safe_name = redactor.redact(member.filename)
                if safe_name != member.filename:
                    redactor.replacements["archiveMemberNames"] += 1
                if safe_name in used_names:
                    member_path = PurePosixPath(safe_name)
                    suffix = member_path.suffix
                    stem = member_path.name[:-len(suffix)] if suffix else member_path.name
                    index = 1
                    while True:
                        candidate = str(member_path.with_name(f"{stem}__sanitized_{index}{suffix}"))
                        if candidate not in used_names:
                            safe_name = candidate
                            totals["archiveMemberNameCollisionsResolved"] += 1
                            break
                        index += 1
                used_names.add(safe_name)
                safe_member = zipfile.ZipInfo(safe_name, member.date_time)
                safe_member.compress_type = zipfile.ZIP_DEFLATED
                safe_member.create_system = member.create_system
                safe_member.external_attr = member.external_attr
                safe_member.internal_attr = member.internal_attr
                if member.is_dir():
                    target_archive.writestr(safe_member, b"")
                    continue
                data = source_archive.read(member)
                extension = Path(member.filename).suffix.casefold()
                if extension in SCANNER.RASTER_EXTENSIONS:
                    totals["rasterMembersRemoved"] += 1
                    continue
                if extension == ".zip" or data.startswith(ZIP_SIGNATURES):
                    try:
                        data, nested = sanitize_archive_bytes(data, redactor, depth + 1, redact_text)
                    except (OSError, zipfile.BadZipFile, RuntimeError):
                        totals["opaqueMembersRemoved"] += 1
                        continue
                    if not data:
                        totals["opaqueMembersRemoved"] += 1
                        continue
                    for key, value in nested.items():
                        totals[key] += value
                elif looks_like_utf8_text(member.filename, data):
                    if redact_text:
                        text = data.decode("utf-8")
                        cleaned = redactor.redact(text)
                        if cleaned != text:
                            totals["textMembersRedacted"] += 1
                        data = cleaned.encode("utf-8")
                else:
                    totals["opaqueMembersRemoved"] += 1
                    continue
                target_archive.writestr(safe_member, data)
    return output_buffer.getvalue(), totals


def replace_file_atomically(path: Path, payload: bytes) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as temporary_file:
            temporary_file.write(payload)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def sanitize_playwright_artifacts(
    artifact_root: Path,
    redactor: TraceRedactor,
    redact_text: bool = True,
) -> dict[str, object]:
    totals = {
        "archives": 0,
        "rasterMembersRemoved": 0,
        "opaqueMembersRemoved": 0,
        "textMembersRedacted": 0,
        "archiveMemberNameCollisionsResolved": 0,
    }
    archives = sorted(path for path in artifact_root.rglob("*.zip") if path.is_file())
    for archive_path in archives:
        sanitized, counts = sanitize_archive_bytes(archive_path.read_bytes(), redactor, redact_text=redact_text)
        replace_file_atomically(archive_path, sanitized)
        for key, value in counts.items():
            totals[key] += value

    loose_text_files = sorted(
        path for path in artifact_root.rglob("*")
        if path.is_file() and path.suffix.casefold() in {".md", ".html"}
    ) if redact_text else []
    for text_path in loose_text_files:
        try:
            original = text_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        cleaned = redactor.redact(original)
        if cleaned != original:
            replace_file_atomically(text_path, cleaned.encode("utf-8"))
            totals["textMembersRedacted"] += 1

    return {
        "schemaVersion": 1,
        "archivesRewritten": len(archives),
        **totals,
        "redactionCounts": redactor.replacements,
        "rasterImagesPreserved": False,
        "opaqueBinaryMembersPreserved": False,
    }


def main() -> int:
    backend_root = SCRIPT_ROOT.parents[1]
    repo_root = backend_root.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=repo_root.parent / "customer-simulator.csv")
    parser.add_argument(
        "--artifacts",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-3/artifacts/playwright",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-3/artifacts/final-qa/playwright-trace-sanitization.json",
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="Retain already-redacted text payloads while stripping ZIP metadata and nested raster members.",
    )
    args = parser.parse_args()
    artifacts = args.artifacts.resolve(strict=True)
    source_csv = args.csv.resolve(strict=True)
    output_path = args.output.resolve()
    previous_report = None
    if args.metadata_only and output_path.is_file():
        try:
            previous_report = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            previous_report = None
    report = sanitize_playwright_artifacts(
        artifacts,
        TraceRedactor.from_csv(source_csv),
        redact_text=not args.metadata_only,
    )
    if previous_report:
        for key in (
            "rasterMembersRemoved",
            "opaqueMembersRemoved",
            "textMembersRedacted",
            "archiveMemberNameCollisionsResolved",
        ):
            report[key] += int(previous_report.get(key, 0))
        old_redactions = previous_report.get("redactionCounts", {})
        for key, value in old_redactions.items():
            report["redactionCounts"][key] = report["redactionCounts"].get(key, 0) + int(value)
    report["textPayloadsRedactedThisPass"] = not args.metadata_only
    report["zipCommentsDropped"] = True
    report["zipExtraFieldsDropped"] = True
    report["archiveMemberNamesRedacted"] = report["redactionCounts"].get("archiveMemberNames", 0)
    report["sourceCsvSha256"] = __import__("hashlib").sha256(source_csv.read_bytes()).hexdigest()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
