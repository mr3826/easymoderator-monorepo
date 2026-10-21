import importlib.util
from io import BytesIO
from pathlib import Path
import struct
import unittest
import zipfile


SCANNER_PATH = Path(__file__).with_name("scan-artifact-privacy.py")
SPEC = importlib.util.spec_from_file_location("scan_artifact_privacy", SCANNER_PATH)
SCANNER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SCANNER)


class LiteralMatcherTests(unittest.TestCase):
    def test_matches_literal_values_without_case_folding(self):
        matcher = SCANNER.LiteralMatcher({"customer asks about color", "বাংলা প্রশ্ন"})

        self.assertTrue(matcher.contains("prefix customer asks about color suffix"))
        self.assertTrue(matcher.contains("prefix বাংলা প্রশ্ন suffix"))
        self.assertFalse(matcher.contains("Customer asks about color"))
        self.assertFalse(matcher.contains("unrelated text"))

    def test_match_can_cross_stream_chunk_boundary(self):
        matcher = SCANNER.LiteralMatcher({"synthetic phrase boundary"})
        first_found, state = matcher.scan("prefix synthetic phrase bou")
        second_found, _ = matcher.scan("ndary suffix", state)

        self.assertFalse(first_found)
        self.assertTrue(second_found)

    def test_handles_overlapping_and_duplicate_literals(self):
        matcher = SCANNER.LiteralMatcher({"aba", "bab", "aba"})

        self.assertTrue(matcher.contains("zzbabzz"))
        self.assertFalse(matcher.contains("zzabbzz"))

    def test_source_text_traversal_keeps_only_redacted_input_matches(self):
        matcher = SCANNER.LiteralMatcher({"synthetic customer question"})
        unsafe, redacted = SCANNER.collect_source_text_matches(
            [
                {"inputRedacted": "synthetic customer question"},
                {"rawField": "synthetic customer question"},
            ],
            matcher,
            None,
        )

        self.assertEqual((unsafe, redacted), (1, 1))

    def test_contact_normalization_matches_source_number_across_formatting(self):
        matcher = SCANNER.LiteralMatcher({"01712345678"})

        self.assertTrue(matcher.contains(SCANNER.normalize_contact_sequence("Call 017-123-45678")))

    def test_sensitive_text_scan_ignores_static_code_but_keeps_html_text(self):
        self.assertEqual(SCANNER.sensitive_text_for_scan(Path("bundle.js"), "const phone = /01712345678/;"), "")
        self.assertEqual(SCANNER.sensitive_text_for_scan(
            Path("report.html"), "<p>Visible 01712345678</p><script>01712345678</script>"
        ), "<p>Visible 01712345678</p> ")

    def test_archive_scan_checks_members_after_an_exact_match(self):
        payload = BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("first.txt", "synthetic exact source phrase")
            archive.writestr("later.txt", "Call 017-123-45678")
            archive.writestr("screenshot.png", b"synthetic raster")

        with zipfile.ZipFile(BytesIO(payload.getvalue())) as archive:
            exact, sensitive, contact, raster_count = SCANNER.scan_archive_members(
                archive,
                SCANNER.LiteralMatcher({"synthetic exact source phrase"}),
                SCANNER.LiteralMatcher({"01712345678"}),
                None,
            )

        self.assertTrue(exact)
        self.assertTrue(contact)
        self.assertTrue(sensitive)
        self.assertEqual(raster_count, 1)

    def test_archive_scan_checks_utf8_resources_without_a_filename_extension(self):
        payload = BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("resources/opaque-id", "synthetic exact source phrase")

        with zipfile.ZipFile(BytesIO(payload.getvalue())) as archive:
            exact, sensitive, contact, raster_count = SCANNER.scan_archive_members(
                archive,
                SCANNER.LiteralMatcher({"synthetic exact source phrase"}),
                SCANNER.LiteralMatcher(set()),
                None,
            )

        self.assertTrue(exact)
        self.assertFalse(sensitive)
        self.assertFalse(contact)
        self.assertEqual(raster_count, 0)

    def test_archive_scan_recurses_into_nested_trace_archives(self):
        nested_payload = BytesIO()
        with zipfile.ZipFile(nested_payload, "w") as nested:
            nested.writestr("resources/opaque-id", "synthetic exact source phrase")
            nested.writestr("resources/capture.jpeg", b"synthetic raster")
        outer_payload = BytesIO()
        with zipfile.ZipFile(outer_payload, "w") as outer:
            outer.writestr("attachment.bin", nested_payload.getvalue())

        with zipfile.ZipFile(BytesIO(outer_payload.getvalue())) as archive:
            exact, sensitive, contact, raster_count = SCANNER.scan_archive_members(
                archive,
                SCANNER.LiteralMatcher({"synthetic exact source phrase"}),
                SCANNER.LiteralMatcher(set()),
                None,
            )

        self.assertTrue(exact)
        self.assertFalse(sensitive)
        self.assertFalse(contact)
        self.assertEqual(raster_count, 1)

    def test_archive_scan_checks_member_names_comments_and_extra_fields(self):
        phrase = "synthetic exact source phrase"
        payload = BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.comment = b"Call 01712345678"
            member = zipfile.ZipInfo(f"resources/{phrase}.txt")
            member.comment = phrase.encode()
            member.extra = struct.pack("<HH", 0xCAFE, len(phrase)) + phrase.encode()
            archive.writestr(member, "safe body")

        with zipfile.ZipFile(BytesIO(payload.getvalue())) as archive:
            exact, sensitive, contact, raster_count = SCANNER.scan_archive_members(
                archive,
                SCANNER.LiteralMatcher({phrase}),
                SCANNER.LiteralMatcher({"01712345678"}),
                None,
            )

        self.assertTrue(exact)
        self.assertTrue(contact)
        self.assertTrue(sensitive)
        self.assertEqual(raster_count, 0)


if __name__ == "__main__":
    unittest.main()
