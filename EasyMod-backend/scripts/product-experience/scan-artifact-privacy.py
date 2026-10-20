#!/usr/bin/env python3
"""Scan the local Product Engine evidence package for customer CSV text."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
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
    "responsepreview",
    "responsedigest",
}
MINIMUM_CHARACTER_LENGTH = 12


def collect_denied_keys(value: object) -> int:
    if isinstance(value, dict):
        matches = sum(str(key).casefold() in DENIED_KEYS for key in value)
        return matches + sum(collect_denied_keys(item) for item in value.values())
    if isinstance(value, list):
        return sum(collect_denied_keys(item) for item in value)
    return 0


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
        default=repo_root / "docs/ai/product-experience-v1-1",
        help="Evidence package root to scan.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-1/artifacts/final-qa/privacy-scan.json",
        help="Summary JSON path. Only aggregate counts and the CSV hash are written.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root / "docs/ai/product-experience-v1-1/artifacts/final-qa/SHA256SUMS.txt",
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
    if "Persona_ID" not in rows[0]:
        raise ValueError("The source CSV is missing its Persona_ID column.")

    exact_pattern = re.compile("|".join(re.escape(value) for value in sorted(long_cells, key=len, reverse=True)))
    json_files = sorted(path for path in artifacts_root.rglob("*.json") if path.is_file())
    parse_errors = 0
    denied_property_keys = 0
    json_text_matches = 0
    for path in json_files:
        try:
            text = path.read_text(encoding="utf-8")
            parsed = json.loads(text)
        except (OSError, UnicodeError, json.JSONDecodeError):
            parse_errors += 1
            continue
        denied_property_keys += collect_denied_keys(parsed)
        json_text_matches += bool(exact_pattern.search(text))

    zip_files = sorted(path for path in (artifacts_root / "artifacts/playwright").rglob("*.zip") if path.is_file())
    zip_text_matches = 0
    for path in zip_files:
        matched = False
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                payload = archive.read(member)
                decoded = payload.decode("utf-8", errors="ignore")
                if exact_pattern.search(decoded):
                    matched = True
                    break
        zip_text_matches += matched

    report = {
        "schemaVersion": 1,
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
        "playwrightZipArchives": len(zip_files),
        "exactSourceTextMatchesInPlaywrightArchives": zip_text_matches,
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

    if parse_errors or denied_property_keys or json_text_matches or zip_text_matches:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Keep failures useful without displaying source text.
        print(f"privacy scan failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(2)
