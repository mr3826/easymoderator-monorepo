import importlib.util
from io import BytesIO
from pathlib import Path
import struct
import tempfile
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
                {"customerMessageRedacted": "synthetic customer question"},
                {"rawField": "synthetic customer question"},
            ],
            matcher,
            None,
        )

        self.assertEqual((unsafe, redacted), (1, 2))

    def test_contact_normalization_matches_source_number_across_formatting(self):
        matcher = SCANNER.LiteralMatcher({"01712345678"})

        self.assertTrue(matcher.contains(SCANNER.normalize_contact_sequence("Call 017-123-45678")))
        self.assertTrue(SCANNER.contains_source_contact("Call 017-123-45678", matcher))
        self.assertFalse(SCANNER.contains_source_contact("ticket 017 and item 12345678", matcher))

    def test_redacted_inputs_reject_email_addresses(self):
        matcher = SCANNER.LiteralMatcher({"synthetic customer question"})

        self.assertEqual(SCANNER.collect_source_text_matches(
            {"inputRedacted": "Email buyer@example.com about a synthetic customer question"},
            matcher,
            None,
        ), (1, 0))

    def test_only_safe_labeled_proof_example_lines_may_match_source_text(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            artifact_root = Path(temporary_directory)
            proof_path = artifact_root / "reports" / "product-engine-v1.3-proof.md"
            proof_path.parent.mkdir(parents=True)
            exact_source = "Long source question about a kurta size and current price"
            matcher = SCANNER.LiteralMatcher({exact_source})
            contacts = SCANNER.LiteralMatcher({"01712345678"})
            self.assertTrue(SCANNER.is_safe_redacted_proof_example_line(
                proof_path, artifact_root, f"Customer message (redacted): {exact_source}", matcher, contacts, None
            ))
            self.assertTrue(SCANNER.is_safe_redacted_proof_example_line(
                proof_path, artifact_root, f"Engine response (redacted): {exact_source}", matcher, contacts, None
            ))
            self.assertFalse(SCANNER.is_safe_redacted_proof_example_line(
                artifact_root / "other.md", artifact_root, f"Customer message (redacted): {exact_source}", matcher, contacts, None
            ))
            self.assertFalse(SCANNER.is_safe_redacted_proof_example_line(
                proof_path, artifact_root, f"Customer message: {exact_source}", matcher, contacts, None
            ))

    def test_redacted_proof_example_allowlist_rejects_contacts_addresses_and_profile_names(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            artifact_root = Path(temporary_directory)
            proof_path = artifact_root / "reports" / "product-engine-v1.3-proof.md"
            matcher = SCANNER.LiteralMatcher({"Long source question about product availability"})
            contacts = SCANNER.LiteralMatcher({"01712345678"})
            profile_pattern = SCANNER.re.compile(r"(?<!\w)Ayesha(?!\w)", SCANNER.re.IGNORECASE)
            unsafe_values = [
                "Call 01712345678 before visiting",
                "Email buyer@example.test for stock",
                "Delivery to Road 12, Dhanmondi",
                "Ayesha asks about delivery",
            ]
            for value in unsafe_values:
                with self.subTest(value_type=value.split()[0]):
                    self.assertFalse(SCANNER.is_safe_redacted_proof_example_line(
                        proof_path, artifact_root, f"Customer message (redacted): {value}", matcher, contacts, profile_pattern
                    ))

    def test_sensitive_text_scan_ignores_static_code_but_keeps_html_text(self):
        self.assertEqual(SCANNER.sensitive_text_for_scan(Path("bundle.js"), "const phone = /01712345678/;"), "")
        self.assertEqual(SCANNER.sensitive_text_for_scan(
            Path("report.html"), "<p>Visible 01712345678</p><script>01712345678</script>"
        ), "<p>Visible 01712345678</p> ")

    def test_sensitive_pattern_scan_does_not_treat_sha256_digest_as_contact(self):
        digest = "01312345678" + "a" * 53

        self.assertEqual(len(digest), 64)
        self.assertIsNotNone(SCANNER.BANGLADESH_CONTACT_PATTERN.search(digest))
        self.assertEqual(SCANNER.collect_sensitive_pattern_matches({"artifactSha256": digest}, None), 0)
        self.assertEqual(SCANNER.count_sensitive_pattern_matches(digest, None), 0)
        self.assertFalse(SCANNER.contains_source_contact(digest, SCANNER.LiteralMatcher({"01312345678"})))

    def test_sensitive_text_scan_ignores_markdown_table_cell_padding_after_usd_amounts(self):
        report_row = "| `V13_AGGREGATE_WORST_CASE_RESERVED_USD` | 3.638948014        |"
        scanned_text = SCANNER.sensitive_text_for_scan(Path("proof.md"), report_row)

        self.assertEqual(SCANNER.count_sensitive_pattern_matches(scanned_text, None), 0)

    def test_sensitive_text_scan_ignores_phone_shaped_digits_in_usd_table_cells(self):
        report_row = "| `V13_AGGREGATE_WORST_CASE_RESERVED_USD` | 3.0134567890 |"
        scanned_text = SCANNER.sensitive_text_for_scan(Path("proof.md"), report_row)

        self.assertEqual(SCANNER.count_sensitive_pattern_matches(scanned_text, None), 0)

    def test_sensitive_text_scan_keeps_phone_detection_for_phone_shaped_usd_cells(self):
        report_row = "| `UNLISTED_PROVIDER_USAGE_USD` | 01712345678 |"
        scanned_text = SCANNER.sensitive_text_for_scan(Path("proof.md"), report_row)

        self.assertGreater(SCANNER.count_sensitive_pattern_matches(scanned_text, None), 0)

    def test_sensitive_text_scan_keeps_phone_detection_for_10_digit_bd_usd_cells(self):
        report_row = "| `UNLISTED_PROVIDER_USAGE_USD` | 0171234567 |"
        scanned_text = SCANNER.sensitive_text_for_scan(Path("proof.md"), report_row)

        self.assertGreater(SCANNER.count_sensitive_pattern_matches(scanned_text, None), 0)

    def test_sensitive_text_scan_keeps_phone_detection_in_markdown_table_cells(self):
        report_row = "| Customer phone | 01712345678        |"
        scanned_text = SCANNER.sensitive_text_for_scan(Path("proof.md"), report_row)

        self.assertGreater(SCANNER.count_sensitive_pattern_matches(scanned_text, None), 0)

    def test_sensitive_pattern_scan_does_not_treat_uuid_as_contact(self):
        comparison_id = "14016518-7966-4d6a-baf6-4bdd3cf1c6bb"
        contact_matcher = SCANNER.LiteralMatcher({"0165187966"})

        self.assertIsNotNone(SCANNER.BANGLADESH_CONTACT_PATTERN.search(comparison_id))
        self.assertEqual(SCANNER.count_sensitive_pattern_matches(comparison_id, None), 0)
        self.assertFalse(SCANNER.contains_source_contact(comparison_id, contact_matcher))
        self.assertGreater(SCANNER.count_sensitive_pattern_matches("Customer phone 0165187966", None), 0)
        self.assertTrue(SCANNER.contains_source_contact("Customer phone 0165187966", contact_matcher))

    def test_playwright_archive_discovery_uses_the_artifact_root(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            artifact_root = Path(temporary_directory)
            playwright = artifact_root / "playwright" / "test-results"
            playwright.mkdir(parents=True)
            trace = playwright / "trace.zip"
            trace.write_bytes(b"trace")

            self.assertEqual(SCANNER.playwright_archive_files(artifact_root), [trace])

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
