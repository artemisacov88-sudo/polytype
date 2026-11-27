from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


prepare = load_module("prepare_oanc", "scripts/corpus/prepare_oanc.py")
tatoeba = load_module("prepare_tatoeba", "scripts/corpus/prepare_tatoeba.py")
builder = load_module("build_ngrams", "scripts/training/build_ngrams.py")
independent_split = load_module("independent_split", "scripts/evaluation/create_independent_split.py")
evaluator = load_module("evaluate_model", "scripts/evaluation/evaluate_model.py")


class CorpusPreparationTests(unittest.TestCase):
    def test_runtime_tokenization_unicode_apostrophes_and_hyphens(self):
        self.assertEqual(prepare.tokenize_sentence("I’M can't state-of-the-art café Ελληνικά"),
                         ["i’m", "can't", "state-of-the-art", "caf"])

    def test_sentence_regions_and_sentence_boundary(self):
        text = "I like tea. You like coffee."
        with tempfile.TemporaryDirectory() as temp:
            annotation = Path(temp) / "doc-s.xml"
            # A compact stand-off GrAF fixture whose offsets select sentences.
            first = (0, 11)
            second = (12, len(text))
            annotation.write_text(f'''<graph xmlns="urn:test">
              <region id="r0" anchors="{first[0]} {first[1]}"/><node id="n0"><link targets="r0"/></node><a label="s" ref="n0"/>
              <region id="r1" anchors="{second[0]} {second[1]}"/><node id="n1"><link targets="r1"/></node><a label="s" ref="n1"/>
            </graph>''', encoding="utf-8")
            sentences, fallback = prepare.split_text(text, annotation)
        self.assertFalse(fallback)
        self.assertEqual(sentences, [["i", "like", "tea"], ["you", "like", "coffee"]])

    def test_document_split_is_deterministic(self):
        self.assertEqual(prepare.doc_split("a/b.txt"), prepare.doc_split("a/b.txt"))
        self.assertIn(prepare.doc_split("a/b.txt"), {"train", "validation", "test"})


class TatoebaPreparationTests(unittest.TestCase):
    def test_tsv_metadata_and_translation_groups(self):
        self.assertEqual(tatoeba.parse_detail_line(
            "42\tron\tȘtiință și limbă\tcontributor\t\\N\t2026-01-01".encode()),
            (42, "ron", "Știință și limbă", "contributor"))
        self.assertEqual(tatoeba.parse_base_line(b"42\t17"), (42, 17))
        self.assertEqual(tatoeba.translation_group_id(42, 17), 17)
        self.assertEqual(tatoeba.translation_group_id(17, 0), 17)
        self.assertEqual(tatoeba.translation_group_id(42, None), 42)

    def test_stable_split_keeps_translation_family_together(self):
        group = tatoeba.translation_group_id(100, 10)
        self.assertEqual(tatoeba.split_for_group(group), tatoeba.split_for_group(10))
        self.assertIn(tatoeba.split_for_group(group), {"train", "validation", "test"})

    def test_runtime_language_tokenization_and_normalization(self):
        self.assertEqual(tatoeba.tokenize("rus", "Ёлка растёт"), ["елка", "растет"])
        self.assertEqual(tatoeba.tokenize("deu", "Grüße schön Straße"), ["grüße", "schön", "straße"])
        self.assertEqual(tatoeba.tokenize("ron", "Ştiinţă și țară"), ["știință", "și", "țară"])
        self.assertEqual(tatoeba.tokenize("ron", "S\u0326tiin\u0163a"), ["știința"])


class NGramBuildTests(unittest.TestCase):
    def test_sentence_local_counts_and_export_parity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "train.jsonl"
            source.write_text("".join(json.dumps({"document": "d", "tokens": words}) + "\n" for words in
                               (["i", "would", "like", "tea"], ["you", "like", "coffee"])), encoding="utf-8")
            db = root / "counts.sqlite3"
            report = builder.train(source, db, batch_size=2)
            self.assertEqual(report["training_sentences"], 2)
            sql = __import__("sqlite3").connect(db)
            self.assertEqual(sql.execute("SELECT count FROM ngrams WHERE order_n=2 AND context='i' AND next_word='would'").fetchone()[0], 1)
            self.assertIsNone(sql.execute("SELECT count FROM ngrams WHERE order_n=2 AND context='tea' AND next_word='you'").fetchone())
            sql.close()
            exported = builder.export_config(db, "compact", 1, 1, root)
            dictionary = json.loads((root / "compact/words.json").read_text(encoding="utf-8"))
            self.assertEqual({entry["word"] for entry in dictionary}, {"coffee", "i", "like", "tea", "would", "you"})
            self.assertTrue(all(entry["pos"] == "X" for entry in dictionary))
            # A successor cap must never truncate the unigram vocabulary/prior.
            self.assertEqual(exported["record_counts"]["1"], 6)
            stats_path = root / "compact/binary/context-stats.ptgs"
            self.assertTrue(stats_path.is_file())
            stats = stats_path.read_bytes()
            self.assertEqual(stats[:4], b"PTGS")
            self.assertEqual(exported["context_statistics_context_counts"], {"1": 4, "2": 3, "3": 1})
            self.assertEqual(exported["context_statistics_bytes"], len(stats))
            self.assertEqual(exported["context_statistics_sha256"], hashlib.sha256(stats).hexdigest())
            self.assertEqual(len(stats), 24 + 6 * 4 + 4 * 12 + 3 * 16 + 1 * 20)
            result = subprocess.run(["node", str(ROOT / "scripts/evaluation/benchmark_formats.mjs"),
                                     str(root / "compact")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            benchmark = json.loads(result.stdout)
            self.assertTrue(benchmark["equivalent_index_hash"], benchmark)
            self.assertTrue(benchmark["equivalent_lookup_hash"], benchmark)
            self.assertEqual(benchmark["json"]["record_count"], benchmark["binary"]["record_count"])
            repeated = builder.export_config(db, "compact-repeat", 1, 1, root)
            self.assertEqual(exported["json_sha256"], repeated["json_sha256"])
            self.assertEqual(exported["binary_sha256"], repeated["binary_sha256"])

            pruned = builder.export_config(db, "pruned", 2, 1, root)
            model = json.loads((root / "pruned/json/model.json").read_text(encoding="utf-8"))
            groups = {}
            for record in model["records"]:
                order, *values = record
                count = values[-1]
                self.assertGreaterEqual(count, 2)
                if order > 1:
                    context = tuple(values[:order-1])
                    groups[(order, context)] = groups.get((order, context), 0) + 1
            self.assertTrue(all(n <= 1 for n in groups.values()))
            self.assertEqual(pruned["record_counts"]["1"], 1)

            binary = root / "compact/binary/model.ptng"
            (root / "bad/binary").mkdir(parents=True)
            corrupted = root / "bad/binary/model.ptng"
            data = bytearray(binary.read_bytes())
            data[0] = 0
            corrupted.write_bytes(data)
            manifest = json.loads((root / "compact/manifest.json").read_text(encoding="utf-8"))
            (root / "bad/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            bad_hash = subprocess.run(["node", str(ROOT / "scripts/evaluation/benchmark_formats.mjs"),
                                       "--child", str(corrupted), "binary"], capture_output=True, text=True)
            self.assertNotEqual(bad_hash.returncode, 0)
            self.assertIn("Integrity check failed", bad_hash.stderr)
            manifest["binary_sha256"] = hashlib.sha256(data).hexdigest()
            (root / "bad/manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            bad = subprocess.run(["node", str(ROOT / "scripts/evaluation/benchmark_formats.mjs"),
                                  "--child", str(corrupted), "binary"], capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)

            incompatible = root / "bad/binary/incompatible.ptng"
            data = bytearray(binary.read_bytes())
            data[4] = 2
            incompatible.write_bytes(data)
            manifest["binary_sha256"] = hashlib.sha256(data).hexdigest()
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            bad_version = subprocess.run(["node", str(ROOT / "scripts/evaluation/benchmark_formats.mjs"),
                                          "--child", str(incompatible), "binary"], capture_output=True, text=True)
            self.assertNotEqual(bad_version.returncode, 0)


class IndependentEvaluationSplitTests(unittest.TestCase):
    def test_evaluation_metric_definitions(self):
        metrics = defaultdict(float)
        evaluator.update(metrics, "target", ["other"], ["target", "other"])
        result = evaluator.finish(metrics)
        self.assertEqual(result["coverage"], 1.0, "coverage measures whether a ranked result exists")
        self.assertEqual(result["top5_accuracy"], 0.0, "Top-5 accuracy requires the target in the result list")
        self.assertEqual(result["candidate_recall"], 1.0,
                         "candidate recall measures target presence before ranking")

        empty = defaultdict(float)
        evaluator.update(empty, "target", [], ["other"])
        empty_result = evaluator.finish(empty)
        self.assertEqual(empty_result["coverage"], 0.0)
        self.assertEqual(empty_result["top5_accuracy"], 0.0)
        self.assertEqual(empty_result["candidate_recall"], 0.0)

    def test_report_database_path_is_resolved(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "counts.sqlite3"
            self.assertEqual(evaluator.resolved_database_path(path), str(path.resolve()))

    def test_report_split_path_is_resolved(self):
        with tempfile.TemporaryDirectory() as temp:
            prepared = Path(temp) / "prepared"
            self.assertEqual(evaluator.resolved_split_path(prepared, "validation"),
                             str((prepared / "validation.jsonl").resolve()))

    def test_tuning_is_validation_only(self):
        evaluator.validate_tuning_split("validation", True)
        evaluator.validate_tuning_split("test", False)
        with self.assertRaisesRegex(ValueError, "restricted to the validation split"):
            evaluator.validate_tuning_split("test", True)

    def test_nonstandard_transcript_contraction_is_filtered(self):
        self.assertFalse(evaluator.is_valid_candidate("them's"))
        self.assertFalse(evaluator.is_valid_candidate("them’s"))
        self.assertTrue(evaluator.is_valid_candidate("they's"))

    def test_document_holdout_is_deterministic_and_disjoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.jsonl"
            docs = [f"written_2/technical/biomed/doc-{i}.txt" for i in range(50)]
            docs += [f"written_2/technical/plos/doc-{i}.txt" for i in range(20)]
            docs += [f"written_2/journal/doc-{i}.txt" for i in range(10)]
            source.write_text("".join(json.dumps({"document": doc, "tokens": ["test"]}) + "\n"
                                         for doc in docs), encoding="utf-8")
            first, second = root / "first", root / "second"
            manifest = independent_split.create_split(source, first)
            repeated = independent_split.create_split(source, second)
            self.assertEqual(manifest["splits"], repeated["splits"])
            assigned = {}
            for split in ("train", "validation", "test"):
                records = [json.loads(line) for line in (first / f"{split}.jsonl").read_text().splitlines()]
                for record in records:
                    self.assertNotIn(record["document"], assigned)
                    assigned[record["document"]] = split
            self.assertEqual(set(assigned), set(docs))
            for split in ("validation", "test"):
                self.assertTrue(all(doc.startswith(independent_split.EXCLUDED_RESOURCE_PREFIXES)
                                    for doc, value in assigned.items() if value == split))


if __name__ == "__main__":
    unittest.main()
