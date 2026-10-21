from __future__ import annotations

import importlib.util
from io import BytesIO
from pathlib import Path
import struct
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("sanitize-playwright-traces.py")
SPEC = importlib.util.spec_from_file_location("playwright_trace_sanitizer", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
SANITIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SANITIZER)


def make_zip(members: dict[str, bytes | str]) -> bytes:
    payload = BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return payload.getvalue()


class TraceSanitizationTests(unittest.TestCase):
    def test_nested_trace_archives_redact_source_text_and_remove_raster_members(self):
        redactor = SANITIZER.TraceRedactor(
            {"synthetic customer question with details"},
            {"Test Persona"},
        )
        nested = make_zip({
            "resources/opaque-id": "synthetic customer question with details from Test Persona",
            "resources/capture.jpeg": b"not-a-real-image",
        })
        outer = make_zip({
            "test.trace": "step metadata with synthetic customer question with details",
            "resources/nested.zip": nested,
            "resources/capture.png": b"not-a-real-image",
        })

        sanitized, counts = SANITIZER.sanitize_archive_bytes(outer, redactor)

        with zipfile.ZipFile(BytesIO(sanitized)) as archive:
            self.assertEqual(archive.namelist(), ["test.trace", "resources/nested.zip"])
            self.assertNotIn("synthetic customer question with details", archive.read("test.trace").decode())
            with zipfile.ZipFile(BytesIO(archive.read("resources/nested.zip"))) as nested_archive:
                self.assertEqual(nested_archive.namelist(), ["resources/opaque-id"])
                nested_text = nested_archive.read("resources/opaque-id").decode()
                self.assertNotIn("synthetic customer question with details", nested_text)
                self.assertNotIn("Test Persona", nested_text)
        self.assertEqual(counts["archives"], 2)
        self.assertEqual(counts["rasterMembersRemoved"], 2)
        self.assertEqual(counts["textMembersRedacted"], 2)

    def test_archive_member_names_comments_and_extra_fields_are_sanitized(self):
        source_text = "synthetic customer question with details"
        redactor = SANITIZER.TraceRedactor({source_text}, set())
        payload = BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.comment = source_text.encode()
            member = zipfile.ZipInfo(f"resources/{source_text}.txt")
            member.comment = source_text.encode()
            member.extra = struct.pack("<HH", 0xCAFE, len(source_text)) + source_text.encode()
            archive.writestr(member, source_text)

        sanitized, _ = SANITIZER.sanitize_archive_bytes(payload.getvalue(), redactor)

        with zipfile.ZipFile(BytesIO(sanitized)) as archive:
            self.assertEqual(archive.comment, b"")
            member = archive.infolist()[0]
            self.assertNotIn(source_text, member.filename)
            self.assertEqual(member.comment, b"")
            self.assertEqual(member.extra, b"")
            self.assertNotIn(source_text, archive.read(member).decode())

    def test_redacted_member_name_collisions_get_distinct_safe_names(self):
        redactor = SANITIZER.TraceRedactor(set(), set())
        payload = make_zip({
            "resources/customer.one@example.com.txt": "first safe body",
            "resources/customer.two@example.com.txt": "second safe body",
        })

        sanitized, counts = SANITIZER.sanitize_archive_bytes(payload, redactor)

        with zipfile.ZipFile(BytesIO(sanitized)) as archive:
            names = archive.namelist()
            self.assertEqual(len(names), len(set(names)))
            self.assertEqual(len(names), 2)
            self.assertTrue(all("@" not in name and "example" not in name for name in names))
            self.assertEqual({archive.read(name).decode() for name in names}, {"first safe body", "second safe body"})
        self.assertEqual(counts["archiveMemberNameCollisionsResolved"], 1)


if __name__ == "__main__":
    unittest.main()
