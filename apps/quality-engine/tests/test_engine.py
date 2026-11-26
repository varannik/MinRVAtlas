"""Checks, detectors, decisions and words, on small datasets built in the test (no AWS)."""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from quality_engine import checks, detectors, text  # noqa: E402
from quality_engine.data import Cell, Dataset, add_days, day_range, finish, from_mrv_json  # noqa: E402
from quality_engine.findings import BLOCKS, LOOK, verdict  # noqa: E402
from quality_engine.intraday import fold_day  # noqa: E402
from quality_engine.judge import judge, summary  # noqa: E402
from quality_engine.rules import DEFAULT_RULES as RULES  # noqa: E402


def cell(value, count=1, spread=0.0, total=None, first=None):
    return Cell(
        sum=total if total is not None else value * count,
        mean=value,
        min=value - spread,
        max=value + spread,
        last=value,
        count=count,
        first=first,
    )


def dataset(days, fixed=()):
    return finish(Dataset(source="seeded", days=days, fixed=list(fixed)))


def steady(start, count, metric="CAPTURE_POWER_kW", value=800.0, spread=20.0, readings=720, vary=None):
    """`count` days of a steady meter, optionally varied per day by vary(i)."""
    days = {}
    for i, day in enumerate(day_range(start, add_days(start, count - 1))):
        level = value + (vary(i) if vary else (i % 5) * 2.0)
        days[day] = {metric: cell(level, readings, spread)}
    return days


def friday_dip(i):
    """Days from 1 Jun 2026: 200 kW lower on Fridays, a little variation otherwise."""
    return -200.0 if date.fromisoformat(add_days("2026-06-01", i)).weekday() == 4 else (i % 5) * 2.0


def csv(rows):
    return "timestamp_utc,metric,value,unit,quality\n" + "\n".join(",".join(map(str, row)) for row in rows)


class IntradayTest(unittest.TestCase):
    def test_a_clean_day_folds_like_the_web(self):
        rows = [(f"2026-08-01T{h:02d}:{m:02d}:00Z", "CAPTURE_POWER_kW", 800 + (m % 7), "kW", "ok") for h in range(24) for m in range(0, 60, 2)]
        cells, notes = fold_day("2026-08-01", csv(rows))
        self.assertEqual(cells["CAPTURE_POWER_kW"]["count"], 720)
        self.assertEqual(notes, [])

    def test_gap_short_day_and_missing_rows(self):
        rows = [(f"2026-08-01T{h:02d}:{m:02d}:00Z", "CAPTURE_POWER_kW", 800 + (m % 7), "kW", "ok") for h in range(24) for m in range(0, 60, 2) if not 6 <= h < 12]
        rows.append(("2026-08-01T23:59:00Z", "CAPTURE_POWER_kW", "", "kW", "missing"))
        cells, notes = fold_day("2026-08-01", csv(rows))
        kinds = {note["kind"] for note in notes}
        self.assertEqual(kinds, {"incomplete_day", "gap", "bad_readings"})
        gap = next(note for note in notes if note["kind"] == "gap")
        self.assertEqual(gap["observed"]["from"], "2026-08-01T05:58:00Z")
        self.assertEqual(gap["observed"]["minutes"], 362)
        self.assertEqual(cells["CAPTURE_POWER_kW"]["count"], 540)

    def test_stuck_meter_and_wild_reading(self):
        rows = []
        for h in range(24):
            for m in range(0, 60, 2):
                value = 812.5 if 3 <= h < 6 else 800 + (m % 7)
                rows.append((f"2026-08-01T{h:02d}:{m:02d}:00Z", "CAPTURE_POWER_kW", value, "kW", "ok"))
        rows[600] = (rows[600][0], "CAPTURE_POWER_kW", 9000, "kW", "ok")
        _, notes = fold_day("2026-08-01", csv(rows))
        flat = next(note for note in notes if note["kind"] == "flatline")
        self.assertEqual(flat["observed"]["value"], 812.5)
        self.assertEqual(flat["observed"]["minutes"], 178)
        spike = next(note for note in notes if note["kind"] == "reading_spike")
        self.assertEqual(spike["observed"]["worst"], 9000)
        self.assertEqual(spike["at"], "2026-08-01T20:00:00Z")

    def test_duplicates_and_order(self):
        rows = [
            ("2026-08-01T10:00:00Z", "LCO2_DELIVERED_t", 22.1, "t", "ok"),
            ("2026-08-01T10:00:00Z", "LCO2_DELIVERED_t", 22.1, "t", "ok"),
            ("2026-08-01T09:00:00Z", "LCO2_DELIVERED_t", 21.0, "t", "ok"),
        ]
        cells, notes = fold_day("2026-08-01", csv(rows))
        self.assertEqual({note["kind"] for note in notes}, {"duplicates", "out_of_order"})
        self.assertAlmostEqual(cells["LCO2_DELIVERED_t"]["sum"], 65.2)


class CheckTest(unittest.TestCase):
    def test_missing_days_block_from_three_in_a_row(self):
        days = steady("2026-07-01", 40)
        for day in ("2026-07-10", "2026-07-20", "2026-07-21", "2026-07-22"):
            del days[day]
        found = checks.missing_days(dataset(days), RULES)
        self.assertEqual([(f.start, f.end, f.severity) for f in found], [("2026-07-10", "2026-07-10", LOOK), ("2026-07-20", "2026-07-22", BLOCKS)])

    def test_a_daily_meter_missing_while_others_report(self):
        days = steady("2026-07-01", 10)
        for i, day in enumerate(sorted(days)):
            if i not in (4, 5):
                days[day]["CO2_VENTED_SITE_kg"] = cell(20)
        found = checks.metric_gaps(dataset(days), RULES)
        self.assertEqual([(f.metric, f.start, f.end) for f in found], [("CO2_VENTED_SITE_kg", "2026-07-05", "2026-07-06")])

    def test_impossible_readings_carry_their_tonnes(self):
        days = steady("2026-07-01", 5)
        days["2026-07-03"]["LCO2_DELIVERED_t"] = cell(60, count=2, spread=50, total=120)
        found = checks.out_of_range(dataset(days), RULES)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].observed["worst"], 110)
        self.assertEqual(found[0].impact, {"t_co2": 120.0})

    def test_stuck_at_zero_and_flat_all_day(self):
        days = steady("2026-07-01", 10)
        for day in day_range("2026-07-04", "2026-07-07"):
            days[day]["CAPTURE_POWER_kW"] = cell(0, 720)
        days["2026-07-09"]["CAPTURE_POWER_kW"] = cell(812.5, 720)
        found = checks.stuck(dataset(days), RULES)
        self.assertEqual([(f.kind, f.start, f.end) for f in found], [("stuck_zero", "2026-07-04", "2026-07-07"), ("stuck_day", "2026-07-09", "2026-07-09")])

    def test_a_zero_that_is_normal_is_not_stuck(self):
        days = steady("2026-07-01", 10)
        for day in days:
            days[day]["CO2_REVERSAL_t"] = cell(0)
        self.assertEqual(checks.stuck(dataset(days), RULES), [])

    def test_totaliser_reset_says_what_counting_from_the_reset_misses(self):
        # The Fujairah capture totaliser, 17 Jul 2026: 8,704 → 11,584 kg, reset, 0 → …
        note = {"kind": "counter_reset", "metric": "FT_0209_Totalizer", "day": "2026-07-17", "at": "2026-07-17T13:03:00Z", "observed": {"before": 11584, "after": 0}}
        days = {"2026-07-17": {"FT_0209_Totalizer": cell(5000, 300, first=8704)}}
        found = checks.counter_resets(dataset(days), [note], RULES)
        self.assertEqual(found[0].observed["rise_before_reset"], 2880)
        words = text.word(found[0], "Asia/Dubai")
        self.assertIn("17 Jul 2026 at 17:03 site time (13:03 UTC)", words["headline"])
        self.assertIn("11,584", words["saw"])
        self.assertIn("leaves out the 2,880", words["matters"])

    def test_losses_against_deliveries(self):
        days = steady("2026-07-01", 3)
        days["2026-07-01"].update({"LCO2_DELIVERED_t": cell(22, 3, total=66), "CO2_TRANSIT_LOSS_kg": cell(5000, total=5000)})
        days["2026-07-02"].update({"LCO2_DELIVERED_t": cell(1, 1), "CO2_VENTED_SITE_kg": cell(2000)})
        found = checks.losses(dataset(days), RULES)
        self.assertEqual({(f.kind, f.start) for f in found}, {("loss_share", "2026-07-01"), ("losses_exceed", "2026-07-02")})

    def test_meters_that_should_agree(self):
        days = steady("2026-07-01", 4)
        for i, day in enumerate(sorted(days)):
            days[day]["FT_05"] = cell(100)
            days[day]["FT_14"] = cell(95.4 if i == 2 else 99.5)
        found = checks.agreement(dataset(days), RULES, pairs=[("FT_05", "FT_14")])
        self.assertEqual([(f.start, round(f.observed["share"], 3)) for f in found], [("2026-07-03", 0.046)])

    def test_days_no_lab_result_covers(self):
        days = steady("2026-09-20", 20)
        fixed = [{"key": "BIOGENIC_FRACTION_pct", "value": 38, "validFrom": "2026-09-01", "validTo": "2026-09-30", "source": "lab"}]
        found = checks.fixed_coverage(dataset(days, fixed), RULES)
        self.assertEqual([(f.fixed_key, f.start, f.end) for f in found], [("BIOGENIC_FRACTION_pct", "2026-10-01", "2026-10-09")])
        words = text.word(found[0])
        self.assertEqual(words["headline"], "No C-14 biogenic share (lab result) covers 1–9 Oct 2026.")
        self.assertEqual(words["saw"], "The latest one on file is valid to 30 Sep 2026, and monitoring runs to 9 Oct 2026.")

    def test_notes_on_consecutive_days_become_one_finding(self):
        days = steady("2026-07-01", 6)
        notes = [
            {"kind": "incomplete_day", "metric": "CAPTURE_POWER_kW", "day": d, "observed": {"readings": 500, "expected": 720}}
            for d in ("2026-07-02", "2026-07-03", "2026-07-06")
        ]
        found = checks.from_notes(dataset(days), notes, RULES)
        # The newest day is still being written, so 6 Jul is not reported.
        self.assertEqual([(f.start, f.end, f.observed["readings"]) for f in found], [("2026-07-02", "2026-07-03", 1000)])


class DetectorTest(unittest.TestCase):
    def test_an_unusual_day_and_the_same_weekday(self):
        # Every Friday runs at 600 kW, other days about 800: Fridays are normal.
        days = steady("2026-06-01", 70, vary=friday_dip)
        days["2026-07-29"]["CAPTURE_POWER_kW"] = cell(400, 720, 20)  # a Wednesday
        found = detectors.spikes(dataset(days), RULES)
        self.assertEqual([(f.start, f.observed["value"]) for f in found], [("2026-07-29", 400)])
        self.assertTrue(found[0].advisory)

    def test_a_dismissed_day_leaves_the_baseline(self):
        days = steady("2026-06-01", 60)
        days["2026-07-20"]["CAPTURE_POWER_kW"] = cell(300, 720, 20)
        excluded = {"CAPTURE_POWER_kW": {"2026-07-20"}}
        self.assertEqual(len(detectors.spikes(dataset(days), RULES)), 1)
        found = detectors.spikes(dataset(days), RULES, excluded)
        # The dismissed day itself is still judged, but it no longer feeds anyone's baseline.
        self.assertEqual(len(found), 1)

    def test_a_plant_that_stops(self):
        days = steady("2026-06-01", 60)
        for day in day_range("2026-07-20", "2026-07-30"):
            days[day]["CAPTURE_POWER_kW"] = cell(4, 720, 1)
        found = detectors.level_shifts(dataset(days), RULES)
        self.assertEqual(found[0].start, "2026-07-20")
        self.assertIn("fell to near zero on 20 Jul 2026 and stayed there", text.word(found[0])["headline"])


class JudgeTest(unittest.TestCase):
    def setUp(self):
        days = steady("2026-07-01", 40)
        for day in day_range("2026-07-10", "2026-07-12"):
            del days[day]
        self.data = dataset(days)

    def test_verdict_and_counts(self):
        found = judge(self.data)
        result = summary(self.data, found)
        self.assertEqual(result["verdict"], "blocked")
        self.assertEqual(result["counts"]["blocks"], 1)
        self.assertEqual(verdict(found, "2026-07-20", "2026-07-31"), "clear")

    def test_a_dismissal_carries_over_by_id(self):
        first = judge(self.data)[0]
        review = {"finding_id": first.id, "decision": "dismissed", "reason": "Planned shutdown", "by": "u1", "at": "2026-11-24T10:00:00Z"}
        again = judge(self.data, reviews=[review])
        self.assertEqual(again[0].id, first.id)
        self.assertEqual(again[0].status, "dismissed")
        self.assertEqual(summary(self.data, again)["verdict"], "clear")

    def test_every_finding_is_worded(self):
        for finding in judge(self.data):
            for part in ("headline", "saw", "matters", "todo", "how"):
                self.assertTrue(finding.text[part], (finding.kind, part))
            self.assertNotIn("robust", finding.text["headline"] + finding.text["saw"] + finding.text["matters"])


class SeedTest(unittest.TestCase):
    """The seeded Fujairah history: what a run on the demo data finds."""

    def test_fujairah_demo_history(self):
        import json

        path = os.path.join(os.path.dirname(__file__), "..", "..", "web", "seed", "mrv", "fourfourone", "puro", "fujairah-mineral.json")
        if not os.path.exists(path):
            self.skipTest("seed not present")
        with open(path) as handle:
            data = from_mrv_json(json.load(handle))
        found = judge(data, site_tz="Asia/Dubai")
        kinds = {f.kind for f in found}
        self.assertIn("missing_days", kinds)
        self.assertIn("fixed_coverage", kinds)
        lab = next(f for f in found if f.kind == "fixed_coverage")
        self.assertEqual(lab.start, "2026-10-01")

class SiteDailyTotalsTest(unittest.TestCase):
    def test_a_daily_total_from_the_site_sheet_gets_no_intraday_notes(self):
        text = "timestamp_utc,metric,value,unit,quality,source\n2026-07-17T00:00:00Z,CO2_CAPTURED_t,52.1,t,ok,u1\n2026-07-17T00:00:00Z,ENERGY_CAPTURE_kWh,1830,kWh,ok,u1\n"
        cells, notes = fold_day("2026-07-17", text, RULES)
        self.assertEqual(notes, [])
        self.assertEqual(cells["CO2_CAPTURED_t"]["sum"], 52.1)

    def test_the_chain_meters_name_their_journey_tasks(self):
        from quality_engine.catalog import task_for

        self.assertEqual(task_for("CO2_INJECTED_t"), "monitor.injected")
        self.assertEqual(task_for("ENERGY_LIQUEFACTION_kWh"), "monitor.energy")
        self.assertEqual(task_for("WATER_INJECTED_t"), "monitor.storage")


class TaskAndSummaryTest(unittest.TestCase):
    def test_a_finding_names_the_journey_task_its_records_are_filed_on(self):
        from quality_engine.findings import Finding

        delivered = Finding("out_of_range", "blocks", {}, "2026-08-01", "2026-08-01", metric="LCO2_DELIVERED_t")
        lab = Finding("fixed_coverage", "blocks", {}, "2026-10-01", "2026-11-21", fixed_key="BIOGENIC_FRACTION_pct")
        whole_days = Finding("missing_days", "blocks", {}, "2026-08-03", "2026-08-05")
        self.assertEqual((delivered.task, lab.task, whole_days.task), ("monitor.chain", "monitor.biogenic", ""))
        self.assertEqual(delivered.to_json()["task"], "monitor.chain")
        self.assertEqual(lab.link()["fixed_key"], "BIOGENIC_FRACTION_pct")

    def test_claude_reads_open_findings_most_severe_first(self):
        from quality_engine import run_summary

        findings = [
            {"id": "F-b", "severity": "look", "status": "open", "start": "2026-01-02", "text": {"headline": "Unusual day"}},
            {"id": "F-a", "severity": "blocks", "status": "open", "start": "2026-03-01", "text": {"headline": "Three days missing"}},
            {"id": "F-c", "severity": "blocks", "status": "dismissed", "start": "2026-01-01"},
        ]
        asked = run_summary.facts("blocked", findings)
        self.assertEqual([f["id"] for f in asked["findings"]], ["F-a", "F-b"])
        self.assertIn("blocked", run_summary.prompt(asked))
        self.assertTrue(run_summary.needs_summary(findings))
        self.assertFalse(run_summary.needs_summary([findings[2]]))

    def test_an_answer_without_an_overview_is_not_kept(self):
        from quality_engine import run_summary

        self.assertIsNone(run_summary.checked({"overview": " ", "groups": [], "first": {}}, {"F-a"}))
        kept = run_summary.checked({"overview": "One gap.", "groups": [{"title": "Gap", "cause": "", "finding_ids": ["F-x"]}], "first": {"finding_ids": ["F-a", "F-a"], "why": "It blocks."}}, {"F-a"})
        self.assertEqual(kept, {"overview": "One gap.", "groups": [], "first": {"finding_ids": ["F-a"], "why": "It blocks."}})


if __name__ == "__main__":
    unittest.main()
