#!/usr/bin/env python3
"""Scan the local Product Engine evidence package for customer CSV text."""

from __future__ import annotations

import argparse
from collections import deque
import codecs
import csv
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sys
import zipfile


DENIED_KEYS = {
    "customermessage",
    "customerprofile",
    "expectedtruth",
    "expectedanswer",
    "simulatedattachment",
    "sourcehash",
    "sourceinputsha256",
    "responsepreview",
    "responsedigest",
}
MINIMUM_CHARACTER_LENGTH = 12
BANGLADESH_CONTACT_PATTERN = re.compile(
    r"(?:\+?880\s*|0|০)(?:1[3-9]|১[৩-৯])[\d০-৯Xx\s().-]{7,9}"
)
ADDRESS_PATTERN = re.compile(
    r"\b(?:house|road|street|lane|flat|apartment)\s*#?\s*[\w/-]+(?:,\s*(?:[\w#.-]+\s*){1,3})?",
    re.IGNORECASE,
)
RASTER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ARCHIVE_TEXT_EXTENSIONS = {".txt", ".json", ".html", ".trace", ".network", ".stacks", ".log", ".md", ".css", ".js"}
TEXT_EXTENSIONS = ARCHIVE_TEXT_EXTENSIONS - {".json"}
ARCHIVE_SCAN_CHUNK_BYTES = 1024 * 1024
ARCHIVE_SENSITIVE_OVERLAP_CHARS = 4096
ZIP_SIGNATURES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


class LiteralMatcher:
    """Aho-Corasick matcher for exact, case-sensitive source strings."""

    def __init__(self, patterns: set[str]) -> None:
        self.transitions: list[dict[str, int]] = [{}]
        self.failures: list[int] = [0]
        self.outputs: list[bool] = [False]

        for pattern in patterns:
            state = 0
            for character in pattern:
                next_state = self.transitions[state].get(character)
                if next_state is None:
                    next_state = len(self.transitions)
                    self.transitions[state][character] = next_state
                    self.transitions.append({})
                    self.failures.append(0)
                    self.outputs.append(False)
                state = next_state
            self.outputs[state] = True

        pending: deque[int] = deque()
        pending.extend(self.transitions[0].values())
        while pending:
            state = pending.popleft()
            for character, next_state in self.transitions[state].items():
                pending.append(next_state)
                fallback = self.failures[state]
                while fallback and character not in self.transitions[fallback]:
                    fallback = self.failures[fallback]
                self.failures[next_state] = self.transitions[fallback].get(character, 0)
                self.outputs[next_state] |= self.outputs[self.failures[next_state]]

    def scan(self, text: str, state: int = 0) -> tuple[bool, int]:
        for character in text:
            while state and character not in self.transitions[state]:
                state = self.failures[state]
            state = self.transitions[state].get(character, 0)
            if self.outputs[state]:
                return True, state
        return False, state

    def contains(self, text: str) -> bool:
        return self.scan(text)[0]


def archive_hash(path: Path) -> str:
    with path.open("rb") as archive_file:
        return hashlib.file_digest(archive_file, "sha256").hexdigest()


def normalize_contact_sequence(text: str) -> str:
    return "".join(
        character.upper() if character in "Xx" else character
        for character in text
        if character.isdecimal() or character in "Xx"
    )


def scan_archive_member(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
    exact_matcher: LiteralMatcher,
    source_contact_matcher: LiteralMatcher,
    profile_pattern: re.Pattern[str] | None,
) -> tuple[bool, bool, bool]:
    decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")
    exact_state = 0
    sensitive_tail = ""
    exact_match = False
    sensitive_match = False
    source_contact_match = False
    contact_state = 0
    with archive.open(member) as stream:
        while chunk := stream.read(ARCHIVE_SCAN_CHUNK_BYTES):
            decoded = decoder.decode(chunk)
            chunk_match, exact_state = exact_matcher.scan(decoded, exact_state)
            exact_match |= chunk_match
            contact_match, contact_state = source_contact_matcher.scan(
                normalize_contact_sequence(decoded), contact_state
            )
            source_contact_match |= contact_match
            combined = sensitive_tail + decoded
            sensitive_match |= bool(count_sensitive_pattern_matches(combined, profile_pattern))
            sensitive_tail = combined[-ARCHIVE_SENSITIVE_OVERLAP_CHARS:]
    final_text = decoder.decode(b"", final=True)
    chunk_match, _ = exact_matcher.scan(final_text, exact_state)
    exact_match |= chunk_match
    contact_match, _ = source_contact_matcher.scan(
        normalize_contact_sequence(final_text), contact_state
    )
    source_contact_match |= contact_match
    sensitive_match |= bool(count_sensitive_pattern_matches(sensitive_tail + final_text, profile_pattern))
    return exact_match, sensitive_match, source_contact_match


def scan_archive_members(
    archive: zipfile.ZipFile,
    exact_matcher: LiteralMatcher,
    source_contact_matcher: LiteralMatcher,
    profile_pattern: re.Pattern[str] | None,
    depth: int = 0,
) -> tuple[bool, bool, bool, int]:
    """Scan every text member and aggregate signals without retaining matched text."""
    if depth > 4:
        raise ValueError("Nested Playwright archive depth exceeds the privacy scanner limit.")
    exact_match = False
    sensitive_match = False
    source_contact_match = False
    raster_members = 0
    archive_comment = archive.comment.decode("utf-8", errors="ignore")
    exact_match |= exact_matcher.contains(archive_comment)
    source_contact_match |= source_contact_matcher.contains(normalize_contact_sequence(archive_comment))
    sensitive_match |= bool(count_sensitive_pattern_matches(archive_comment, profile_pattern))
    for member in archive.infolist():
        metadata_text = "\n".join((
            member.filename,
            member.comment.decode("utf-8", errors="ignore"),
            member.extra.decode("utf-8", errors="ignore"),
        ))
        exact_match |= exact_matcher.contains(metadata_text)
        source_contact_match |= source_contact_matcher.contains(normalize_contact_sequence(metadata_text))
        sensitive_match |= bool(count_sensitive_pattern_matches(metadata_text, profile_pattern))
        if member.is_dir():
            continue
        member_extension = Path(member.filename).suffix.casefold()
        if member_extension in RASTER_EXTENSIONS:
            raster_members += 1
            continue
        with archive.open(member) as stream:
            archive_prefix = stream.read(4)
        if member_extension == ".zip" or archive_prefix.startswith(ZIP_SIGNATURES):
            with zipfile.ZipFile(BytesIO(archive.read(member))) as nested_archive:
                nested_exact, nested_sensitive, nested_contact, nested_rasters = scan_archive_members(
                    nested_archive,
                    exact_matcher,
                    source_contact_matcher,
                    profile_pattern,
                    depth + 1,
                )
            exact_match |= nested_exact
            sensitive_match |= nested_sensitive
            source_contact_match |= nested_contact
            raster_members += nested_rasters
            continue
        if member_extension not in ARCHIVE_TEXT_EXTENSIONS and not archive_member_is_utf8_text(
            archive, member
        ):
            continue
        member_exact, member_sensitive, member_contact = scan_archive_member(
            archive, member, exact_matcher, source_contact_matcher, profile_pattern
        )
        exact_match |= member_exact
        sensitive_match |= member_sensitive
        source_contact_match |= member_contact
    return exact_match, sensitive_match, source_contact_match, raster_members


def archive_member_is_utf8_text(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> bool:
    """Recognize extensionless trace resources without decoding binary blobs as text."""
    with archive.open(member) as stream:
        sample = stream.read(8192)
    if not sample or b"\x00" in sample:
        return False
    try:
        decoded = sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    control_characters = sum(
        ord(character) < 32 and character not in "\n\r\t\f\b" for character in decoded
    )
    return control_characters <= max(1, len(decoded) // 100)


def collect_denied_keys(value: object) -> int:
    if isinstance(value, dict):
        matches = sum(str(key).casefold() in DENIED_KEYS for key in value)
        return matches + sum(collect_denied_keys(item) for item in value.values())
    if isinstance(value, list):
        return sum(collect_denied_keys(item) for item in value)
    return 0


def collect_source_text_matches(
    value: object,
    exact_matcher: LiteralMatcher,
    profile_pattern: re.Pattern[str] | None,
) -> tuple[int, int]:
    """Count source text outside redacted inputs and safe matches in redacted inputs."""
    if isinstance(value, dict):
        unsafe_matches = 0
        redacted_input_matches = 0
        for key, item in value.items():
            if str(key).casefold() == "inputredacted":
                if not isinstance(item, str):
                    unsafe_matches += 1
                    continue
                contains_profile_name = bool(profile_pattern and profile_pattern.search(item))
                contains_contact = bool(
                    BANGLADESH_CONTACT_PATTERN.search(item)
                    or ADDRESS_PATTERN.search(item)
                    or contains_profile_name
                )
                if contains_contact:
                    unsafe_matches += 1
                elif exact_matcher.contains(item):
                    redacted_input_matches += 1
                continue
            unsafe, redacted = collect_source_text_matches(item, exact_matcher, profile_pattern)
            unsafe_matches += unsafe
            redacted_input_matches += redacted
        return unsafe_matches, redacted_input_matches
    if isinstance(value, list):
        matches = [collect_source_text_matches(item, exact_matcher, profile_pattern) for item in value]
        return sum(item[0] for item in matches), sum(item[1] for item in matches)
    if isinstance(value, str):
        return int(exact_matcher.contains(value)), 0
    return 0, 0


def count_sensitive_pattern_matches(text: str, profile_pattern: re.Pattern[str] | None) -> int:
    matches = len(BANGLADESH_CONTACT_PATTERN.findall(text))
    matches += len(ADDRESS_PATTERN.findall(text))
    if profile_pattern:
        matches += len(profile_pattern.findall(text))
    return matches


def collect_sensitive_pattern_matches(value: object, profile_pattern: re.Pattern[str] | None) -> int:
    if isinstance(value, dict):
        return sum(collect_sensitive_pattern_matches(item, profile_pattern) for item in value.values())
    if isinstance(value, list):
        return sum(collect_sensitive_pattern_matches(item, profile_pattern) for item in value)
    if isinstance(value, str):
        return count_sensitive_pattern_matches(value, profile_pattern)
    return 0


def collect_source_contact_matches(value: object, source_contact_matcher: LiteralMatcher) -> int:
    if isinstance(value, dict):
        return sum(collect_source_contact_matches(item, source_contact_matcher) for item in value.values())
    if isinstance(value, list):
        return sum(collect_source_contact_matches(item, source_contact_matcher) for item in value)
    if isinstance(value, str):
        return int(source_contact_matcher.contains(normalize_contact_sequence(value)))
    return 0


def strip_embedded_code(text: str) -> str:
    return re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", " ", text, flags=re.IGNORECASE | re.DOTALL)


def sensitive_text_for_scan(path: Path, text: str) -> str:
    if path.suffix.casefold() in {".js", ".css", ".trace", ".network", ".stacks"}:
        return ""
    if path.suffix.casefold() == ".html":
        return strip_embedded_code(text)
    if path.name.endswith(".transcripts.redacted.md"):
        labels = (
            "**Customer (redacted):** ",
            "**Candidate (redacted):** ",
            "**Validated (redacted):** ",
        )
        return "\n".join(line for line in text.splitlines() if line.startswith(labels))
    return text


def main() -> int:
    backend_root = Path(__file__).resolve().parents[2]
    repo_root = backend_root.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=repo_root.parent / "customer-simulator.csv",
        help="Simulator input CSV (defaults to the supplied workspace file).",
    )
    parser.add_argument(
        "--artifacts",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-2",
        help="Evidence package root to scan.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-2/artifacts/final-qa/privacy-scan.json",
        help="Summary JSON path. Only aggregate counts and the CSV hash are written.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-2/artifacts/final-qa/SHA256SUMS.txt",
        help="Checksum manifest path; the manifest itself is omitted.",
    )
    args = parser.parse_args()

    csv_path = args.csv.resolve(strict=True)
    artifacts_root = args.artifacts.resolve(strict=True)
    output_path = args.output.resolve()
    manifest_path = args.manifest.resolve()
    csv_bytes = csv_path.read_bytes()
    with csv_path.open("r", encoding="utf-8-sig", newline="") as source_file:
        rows = list(csv.DictReader(source_file))
    if not rows:
        raise ValueError("The source CSV contains no data rows.")

    long_cells = {
        value
        for row in rows
        for value in row.values()
        if value and len(value) >= MINIMUM_CHARACTER_LENGTH
    }
    message_and_truth_values = {
        row.get(column, "")
        for row in rows
        for column in ("Customer_Message", "Expected_AI_Truth")
        if row.get(column) and len(row[column]) >= MINIMUM_CHARACTER_LENGTH
    }
    profile_names = {
        row.get("Customer_Profile", "").split(",", 1)[0].strip()
        for row in rows
        if len(row.get("Customer_Profile", "").split(",", 1)[0].strip()) >= 3
    }
    profile_pattern = (
        re.compile(r"(?<!\w)(?:" + "|".join(re.escape(name) for name in sorted(profile_names, key=len, reverse=True)) + r")(?!\w)", re.IGNORECASE)
        if profile_names else None
    )
    if "Persona_ID" not in rows[0]:
        raise ValueError("The source CSV is missing its Persona_ID column.")

    exact_matcher = LiteralMatcher(long_cells)
    source_contact_values = {
        normalize_contact_sequence(match.group())
        for row in rows
        for value in row.values()
        if value
        for match in BANGLADESH_CONTACT_PATTERN.finditer(value)
    }
    source_contact_matcher = LiteralMatcher(source_contact_values)
    json_files = sorted(path for path in artifacts_root.rglob("*.json") if path.is_file())
    parse_errors = 0
    denied_property_keys = 0
    json_text_matches = 0
    redacted_input_text_matches = 0
    json_sensitive_pattern_matches = 0
    json_source_contact_matches = 0
    for path in json_files:
        try:
            text = path.read_text(encoding="utf-8")
            parsed = json.loads(text)
        except (OSError, UnicodeError, json.JSONDecodeError):
            parse_errors += 1
            continue
        denied_property_keys += collect_denied_keys(parsed)
        json_sensitive_pattern_matches += collect_sensitive_pattern_matches(parsed, profile_pattern)
        json_source_contact_matches += collect_source_contact_matches(parsed, source_contact_matcher)
        unsafe_matches, redacted_matches = collect_source_text_matches(
            parsed, exact_matcher, profile_pattern
        )
        json_text_matches += unsafe_matches
        redacted_input_text_matches += redacted_matches

    text_files = sorted(
        path for path in artifacts_root.rglob("*")
        if path.is_file() and path.suffix.casefold() in TEXT_EXTENSIONS
    )
    text_parse_errors = 0
    text_source_matches = 0
    redacted_transcript_source_matches = 0
    text_sensitive_pattern_matches = 0
    text_source_contact_matches = 0
    for path in text_files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            text_parse_errors += 1
            continue
        text_source_contact_matches += source_contact_matcher.contains(normalize_contact_sequence(text))
        sensitive_text = sensitive_text_for_scan(path, text)
        for line in sensitive_text.splitlines():
            text_sensitive_pattern_matches += count_sensitive_pattern_matches(line, profile_pattern)
        for line in text.splitlines():
            if not exact_matcher.contains(line):
                continue
            is_redacted_customer_line = (
                path.name.endswith(".transcripts.redacted.md")
                and line.startswith("**Customer (redacted):** ")
            )
            if is_redacted_customer_line and not count_sensitive_pattern_matches(line, profile_pattern):
                redacted_transcript_source_matches += 1
            else:
                text_source_matches += 1

    zip_files = sorted(path for path in (artifacts_root / "artifacts/playwright").rglob("*.zip") if path.is_file())
    zip_text_matches = 0
    zip_sensitive_pattern_matches = 0
    zip_source_contact_matches = 0
    archive_raster_members = 0
    unique_zip_archives_scanned = 0
    duplicate_zip_archives_skipped = 0
    seen_archive_hashes: set[str] = set()
    for path in zip_files:
        digest = archive_hash(path)
        if digest in seen_archive_hashes:
            with zipfile.ZipFile(path) as archive:
                archive_raster_members += sum(
                    Path(member.filename).suffix.casefold() in RASTER_EXTENSIONS
                    for member in archive.infolist()
                    if not member.is_dir()
                )
            duplicate_zip_archives_skipped += 1
            continue
        seen_archive_hashes.add(digest)
        unique_zip_archives_scanned += 1
        with zipfile.ZipFile(path) as archive:
            matched, archive_sensitive_match, archive_source_contact_match, raster_count = (
                scan_archive_members(
                    archive, exact_matcher, source_contact_matcher, profile_pattern
                )
            )
            archive_raster_members += raster_count
        zip_text_matches += matched
        zip_sensitive_pattern_matches += archive_sensitive_match
        zip_source_contact_matches += archive_source_contact_match

    raster_files = sorted(
        path for path in artifacts_root.rglob("*")
        if path.is_file() and path.suffix.casefold() in RASTER_EXTENSIONS
    )

    report = {
        "schemaVersion": 2,
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "datasetSha256": hashlib.sha256(csv_bytes).hexdigest(),
        "sourceRows": len(rows),
        "uniquePersonas": len({row["Persona_ID"] for row in rows}),
        "distinctSimulatorMessageAndTruthValuesChecked": len(message_and_truth_values),
        "distinctLongCsvCellValuesChecked": len(long_cells),
        "minimumCharacterLength": MINIMUM_CHARACTER_LENGTH,
        "jsonArtifacts": len(json_files),
        "jsonParseErrors": parse_errors,
        "deniedPropertyKeys": denied_property_keys,
        "exactSourceTextMatchesInJson": json_text_matches,
        "exactSourceTextMatchesInRedactedInputs": redacted_input_text_matches,
        "jsonSensitivePatternMatches": json_sensitive_pattern_matches,
        "sourceContactMatchesInJson": json_source_contact_matches,
        "textArtifacts": len(text_files),
        "textParseErrors": text_parse_errors,
        "exactSourceTextMatchesInTextArtifacts": text_source_matches,
        "exactSourceTextMatchesInRedactedTranscriptCustomerLines": redacted_transcript_source_matches,
        "textHeuristicSensitivePatternMatches": text_sensitive_pattern_matches,
        "sourceContactMatchesInTextArtifacts": text_source_contact_matches,
        "playwrightZipArchives": len(zip_files),
        "playwrightUniqueZipArchivesScanned": unique_zip_archives_scanned,
        "playwrightDuplicateZipArchivesSkipped": duplicate_zip_archives_skipped,
        "exactSourceTextMatchesInPlaywrightArchives": zip_text_matches,
        "playwrightArchivesWithHeuristicSensitivePatternMatches": zip_sensitive_pattern_matches,
        "playwrightArchivesWithSourceContactMatches": zip_source_contact_matches,
        "rasterArtifactsNotOcrScanned": len(raster_files),
        "playwrightArchiveRasterMembersNotOcrScanned": archive_raster_members,
        "privacyGateStatus": "PASS" if not (
            parse_errors or text_parse_errors or denied_property_keys or json_text_matches
            or json_sensitive_pattern_matches or text_source_matches
            or json_source_contact_matches or text_source_contact_matches
            or text_sensitive_pattern_matches or zip_text_matches
            or zip_sensitive_pattern_matches or zip_source_contact_matches
        ) else "FAIL",
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")

    package_files = sorted(path for path in artifacts_root.rglob("*") if path.is_file() and path.resolve() != manifest_path)
    manifest_files = set(package_files)
    manifest_files.add(csv_path)
    manifest_lines = []
    for path in sorted(manifest_files, key=lambda item: os.path.relpath(item, repo_root).replace("\\", "/")):
        relative_path = os.path.relpath(path, repo_root).replace("\\", "/")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest_lines.append(f"{digest}  {relative_path}")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")

    print(json.dumps(report, indent=2))
    print(f"Checksum entries written: {len(manifest_lines)}")

    if (parse_errors or text_parse_errors or denied_property_keys or json_text_matches
            or json_sensitive_pattern_matches or text_source_matches
            or json_source_contact_matches or text_source_contact_matches
            or text_sensitive_pattern_matches or zip_text_matches
            or zip_sensitive_pattern_matches or zip_source_contact_matches):
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Keep failures useful without displaying source text.
        print(f"privacy scan failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(2)
