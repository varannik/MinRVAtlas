"""
DataSentinel — Test Data Generator v3
Generates TWO pairs of files for each DQA stream:

  PASS files  → Clean data; all rules pass; readiness ≥ 90%; gate PASSED
  FAIL files  → Violates every non-hard-gate rule across all 8 dimensions;
                timestamps are CLEAN so I-03 hard gate does NOT block other checks,
                allowing the engine to run through all dimensions and report
                violations for evaluation.

Stream 1 (Pipelines / DQA-STR1-TDD-001) — 2-hour batch, 2-min freq, 60 rows:
  STR1_PASS_2024-03-15.csv
  STR1_FAIL_2024-03-15.csv

Stream 2 (MinRV / DQA-STR2-TDD-001) — 1-hour submission, 1-min freq, 60 rows:
  STR2_PASS_2024-03-14.csv
  STR2_FAIL_2024-03-14.csv

Usage:  python generate_test_data.py
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os, warnings
warnings.filterwarnings('ignore')

np.random.seed(99)
os.makedirs('sample_data', exist_ok=True)

def smooth(mean, std, n, trend=0):
    noise = np.random.normal(0, std, n)
    s = np.convolve(noise, np.ones(6)/6, mode='same')
    return mean + s + trend * np.arange(n)

# ─────────────────────────────────────────────────────────────────────────────
# STREAM 1 — DQA-STR1-TDD-001
# ─────────────────────────────────────────────────────────────────────────────
BATCH_START = datetime(2024, 3, 15, 6, 0, 0)
FREQ_MIN    = 2
N1          = 60

def str1_timestamps_clean(n=N1):
    return [BATCH_START + timedelta(minutes=i * FREQ_MIN) for i in range(n)]

# ── STR1 PASS ────────────────────────────────────────────────────────────────
def make_str1_pass():
    ts   = str1_timestamps_clean()
    # Very tight smooth signals — no spikes possible
    whp_a = np.clip(smooth(142, 1.5, N1, -0.02), 100, 200)
    whp_b = np.clip(whp_a + np.random.normal(0, 0.5, N1), 100, 200)
    ann_p = np.clip(whp_a * 0.85 + np.random.normal(0, 0.8, N1), 80, 180)
    ft01  = np.clip(smooth(87, 1.0, N1), 60, 120)
    ft02  = np.clip(ft01 + np.random.normal(0, 0.5, N1), 60, 120)
    calc  = np.cumsum(ft01 * (FREQ_MIN / 60))
    sens  = calc * 1.003                     # 0.3% drift — within 2%
    t1    = np.clip(smooth(22.5, 0.6, N1), 18, 28)
    t2    = np.clip(smooth(22.8, 0.6, N1), 18, 28)
    trc   = np.clip(smooth(45.2, 1.5, N1), 20, 100)
    wtr   = np.clip(smooth(12.3, 0.4, N1), 8, 20)
    eng   = np.clip(smooth(178,  3.0, N1), 160, 200)
    lat   = np.clip(np.random.exponential(15, N1), 2, 120)
    op    = ['active_injection'] * N1
    return pd.DataFrame({
        'timestamp_utc':          [t.strftime('%Y-%m-%d %H:%M:%S') for t in ts],
        'batch_id':               'STR1-PASS-2024-03-15',
        'operational_state':      op,
        'WHP_WELL_A_bar':         np.round(whp_a, 3),
        'WHP_WELL_B_bar':         np.round(whp_b, 3),
        'ANNULUS_PRESS_bar':      np.round(ann_p, 3),
        'INJ_RATE_FT01_m3h':      np.round(ft01,  3),
        'INJ_RATE_FT02_m3h':      np.round(ft02,  3),
        'CO2_TOTAL_SENSOR_m3':    np.round(sens,  3),
        'CO2_TOTAL_CALC_m3':      np.round(calc,  3),
        'TEMP_SURF_01_degC':      np.round(t1,    3),
        'TEMP_SURF_02_degC':      np.round(t2,    3),
        'CO2_TRACER_01_ppm':      np.round(trc,   3),
        'WATER_FLOW_m3h':         np.round(wtr,   3),
        'ENERGY_PER_TONNE_kWht':  np.round(eng,   3),
        'INGESTION_LATENCY_sec':  np.round(lat,   1),
    })

# ── STR1 FAIL ────────────────────────────────────────────────────────────────
# Timestamps: CLEAN (I-03 hard gate must not block other checks)
# C-01  — skipped (would create missing timestamps → same as hard gate)
# C-02  — CO2_TRACER_01 nulled rows 5,6,7  (null values)
# C-04  — batch_id says 60 rows but actual clean; flagged via row count note
#          Instead: we deliver exactly 60 rows so C-04 doesn't block,
#          but inject C-04 by reducing to 50 rows in a separate note subset.
#          For testability we keep 60 rows and document which rows violate.
# I-01  — TEMP_SURF_02 flatline rows 20-30
# I-02  — WHP_WELL_A = 355 bar row 8 (>300 max)
# I-04  — INJ_RATE_FT01 spike row 15 (×9 normal)
# T-01  — INGESTION_LATENCY = 480s row 10, 410s row 25
# U-01  — rows 35 and 36 share same timestamp
# U-02  — repeated op-state idle at rows 40-41
# A-01  — CO2_TOTAL_SENSOR 6% above calculated
# CON-01 — WHP_WELL_B diverges 28 bar from WHP_WELL_A rows 22-30
# CON-02 — totaliser step-jump of +180 m³ at row 22
# CON-03 — ENERGY_PER_TONNE 322 kWh/t at rows 38,39 (>3σ)
# CON-04 — WATER_FLOW/CO2 ratio = 3.8 at rows 45-52 (max 0.6)
# CON-05 — TEMP_SURF_01 anti-correlated with WHP_WELL_A
# CON-06 — INJ_RATE_FT01 anti-correlated with WHP for rows 30-50
# CON-07 — multiple rolling z-score outliers in ENERGY
# REL-01 — 6 maintenance rows (0,1,2,50,51,52)
# REL-03 — immediate active_injection after maintenance at row 3
# READ-02 — triggered by critical violations (I-02, A-01)
# READ-03 — coverage < 85% from combined violations

def make_str1_fail():
    ts = str1_timestamps_clean(N1)
    # U-01: make rows 35 and 36 share same timestamp
    ts = list(ts)
    ts[36] = ts[35]

    # Base signals
    whp_a = smooth(142, 2.0, N1, -0.03)
    # I-02: range violation at row 8
    whp_a[8] = 355.0

    # CON-05: TEMP anti-correlated with WHP
    temp1 = 50.0 - (whp_a - np.mean(whp_a)) * 0.3 + np.random.normal(0, 1.5, N1)

    # CON-01: WHP_B diverges rows 22-30
    whp_b = whp_a + np.random.normal(0, 0.8, N1)
    whp_b[22:31] -= 28.0

    ann_p = whp_a * 0.85 + np.random.normal(0, 2, N1)

    ft01 = smooth(87, 1.5, N1)
    # I-04: spike at row 15
    ft01[15] = float(np.median(ft01)) * 9.0
    # CON-06: anti-correlate injection rate with pressure for rows 30-50
    ft01[30:51] = 200.0 - ft01[30:51] + np.random.normal(0, 3, 21)
    ft01 = np.clip(ft01, 0, 600)

    ft02 = ft01 + np.random.normal(0, 1.0, N1)

    calc = np.cumsum(ft01 * (FREQ_MIN / 60))
    # A-01: sensor totaliser 6% above calculated
    sens = calc * 1.06
    # CON-02: step-jump at row 22 not matched by rate
    sens[22:] += 180.0

    # I-01: TEMP_SURF_02 flatline rows 20-30
    temp2 = smooth(22.8, 0.7, N1)
    flat_val = float(temp2[20])
    temp2[20:31] = flat_val

    # C-02: CO2_TRACER nulled rows 5-7
    trc = smooth(45.2, 2.0, N1).astype(object)
    trc[5] = None; trc[6] = None; trc[7] = None

    # CON-04: water/CO2 ratio rows 45-52
    wtr = smooth(12.3, 0.6, N1)
    wtr[45:53] = wtr[45:53] * 7.5     # ratio >> 0.6 max

    # CON-03 + CON-07: energy outliers
    eng = smooth(178, 5, N1)
    eng[38] = 322.0; eng[39] = 318.0  # CON-03
    eng[12] = 319.0; eng[28] = 315.0  # CON-07

    # T-01: ingestion latency breaches
    lat = np.clip(np.random.exponential(18, N1), 2, 150)
    lat[10] = 480.0; lat[25] = 410.0

    # REL-01: maintenance rows
    op = ['active_injection'] * N1
    op[0] = 'maintenance'; op[1] = 'maintenance'; op[2] = 'maintenance'
    op[3] = 'active_injection'   # REL-03: no stabilisation gap
    op[50] = 'maintenance'; op[51] = 'maintenance'; op[52] = 'idle'
    # U-02: repeated idle
    op[40] = 'idle'; op[41] = 'idle'

    return pd.DataFrame({
        'timestamp_utc':          [t.strftime('%Y-%m-%d %H:%M:%S') for t in ts],
        'batch_id':               'STR1-FAIL-2024-03-15',
        'operational_state':      op,
        'WHP_WELL_A_bar':         np.round(whp_a,  3),
        'WHP_WELL_B_bar':         np.round(whp_b,  3),
        'ANNULUS_PRESS_bar':      np.round(ann_p,  3),
        'INJ_RATE_FT01_m3h':      np.round(ft01,   3),
        'INJ_RATE_FT02_m3h':      np.round(ft02,   3),
        'CO2_TOTAL_SENSOR_m3':    np.round(sens,   3),
        'CO2_TOTAL_CALC_m3':      np.round(calc,   3),
        'TEMP_SURF_01_degC':      np.round(temp1,  3),
        'TEMP_SURF_02_degC':      np.round(temp2,  3),
        'CO2_TRACER_01_ppm':      trc,
        'WATER_FLOW_m3h':         np.round(wtr,    3),
        'ENERGY_PER_TONNE_kWht':  np.round(eng,    3),
        'INGESTION_LATENCY_sec':  np.round(lat,    1),
    })


# ─────────────────────────────────────────────────────────────────────────────
# STREAM 2 — DQA-STR2-TDD-001
# ─────────────────────────────────────────────────────────────────────────────
SUB_START = datetime(2024, 3, 14, 8, 0, 0)
N2        = 60

def str2_timestamps_clean(n=N2):
    return [SUB_START + timedelta(minutes=i) for i in range(n)]

# ── STR2 PASS ────────────────────────────────────────────────────────────────
def make_str2_pass():
    ts   = str2_timestamps_clean()
    fl1  = np.clip(smooth(87, 1.0, N2), 60, 120)
    fl2  = np.clip(smooth(43, 0.8, N2), 25, 65)
    fl3  = np.clip(smooth(22, 0.6, N2), 14, 32)
    tot1c = np.cumsum(fl1 * (1/60))
    tot2c = np.cumsum(fl2 * (1/60))
    tot3c = np.cumsum(fl3 * (1/60))
    # Sensor totalisers within 1%
    s1 = tot1c * 1.006; s2 = tot2c * 1.008; s3 = tot3c * 0.996
    wp1 = np.clip(smooth(138, 1.5, N2), 100, 180)
    wp2 = np.clip(smooth(115, 1.5, N2), 85,  155)
    ratio = fl2 / (fl1 + 1e-3)    # ≈ 0.49 — within bounds
    op = ['active_injection'] * N2
    return pd.DataFrame({
        'timestamp_utc':           [t.strftime('%Y-%m-%d %H:%M:%S') for t in ts],
        'operational_state':       op,
        'FLOWRATE_1_m3h':          np.round(fl1,  3),
        'FLOWRATE_2_m3h':          np.round(fl2,  3),
        'FLOWRATE_3_m3h':          np.round(fl3,  3),
        'TOTALISER_1_SENSOR_m3':   np.round(s1,   3),
        'TOTALISER_2_SENSOR_m3':   np.round(s2,   3),
        'TOTALISER_3_SENSOR_m3':   np.round(s3,   3),
        'TOTALISER_1_CALC_m3':     np.round(tot1c,3),
        'TOTALISER_2_CALC_m3':     np.round(tot2c,3),
        'TOTALISER_3_CALC_m3':     np.round(tot3c,3),
        'WELL_PRESSURE_A_bar':     np.round(wp1,  3),
        'WELL_PRESSURE_B_bar':     np.round(wp2,  3),
        'WATER_CO2_RATIO':         np.round(ratio,4),
    })

# ── STR2 FAIL ────────────────────────────────────────────────────────────────
# Timestamps: CLEAN (I-03 hard gate must not block)
# C-02  — FLOWRATE_2 nulled rows 8-10
# C-03  — TOTALISER_3 columns absent (critical missing column)
# I-01  — WELL_PRESSURE_B flatline rows 20-32
# I-02  — FLOWRATE_1 = 660 m³/h at row 5 (max 500)
# I-04  — FLOWRATE_3 spike at row 12 (×12 normal)
# U-01  — row 30 and 31 share timestamp
# A-01  — TOTALISER_1_SENSOR 7% above calculated
# A-02  — FLOWRATE_3 drops to <5% of inlet (mass balance fails rows 22-30)
# CON-01 — totaliser step-jump +220 m³ at row 25 not matched by rate
# CON-02 — WATER_CO2_RATIO = 3.1 at rows 35-42 (max 0.6)
# CON-03 — WELL_PRESSURE_A anti-correlated with FLOWRATE_1
# CON-04 — FLOWRATE_1 historical outlier (×2.8 normal) rows 45-54
# REL-01 — 9 maintenance/idle rows
# READ-02 — triggered by critical violations (I-02, C-03, A-01)
# READ-03 — coverage < 85%

def make_str2_fail():
    ts = str2_timestamps_clean(N2)
    ts = list(ts)
    # U-01: duplicate timestamp
    ts[31] = ts[30]

    fl1 = smooth(87, 1.5, N2)
    # I-02: range violation
    fl1[5] = 660.0
    # CON-04: historical outlier
    fl1[45:55] = fl1[45:55] * 2.8
    fl1 = np.clip(fl1, 0, 800)

    # CON-03: pressure anti-correlated with flow
    wp1 = 200.0 - (fl1 - np.median(fl1)) * 0.4 + np.random.normal(0, 3, N2)
    wp1 = np.clip(wp1, 50, 250)
    wp2 = smooth(115, 1.5, N2)

    # I-01: flatline at wp2 rows 20-32
    flat_wp2 = float(wp2[20])
    wp2[20:33] = flat_wp2

    fl2 = smooth(43, 1.5, N2).astype(object)
    # C-02: nulls
    fl2[8] = None; fl2[9] = None; fl2[10] = None

    fl3 = smooth(22, 1.0, N2)
    # I-04: spike
    fl3_median = float(np.median(fl3))
    fl3[12] = fl3_median * 12.0
    # A-02: mass balance failure
    fl3[22:31] = fl3[22:31] * 0.04

    fl1_arr = fl1.copy()
    fl2_arr = np.array([float(x) if x is not None else 0 for x in fl2])
    fl3_arr = fl3.copy()

    tot1c = np.cumsum(fl1_arr * (1/60))
    tot2c = np.cumsum(fl2_arr * (1/60))

    # A-01: sensor 7% above calculated
    s1 = tot1c * 1.07
    # CON-01: step-jump
    s1[25:] += 220.0
    s2 = tot2c * 1.005

    # CON-02: water/CO2 ratio violation
    ratio = fl2_arr / (fl1_arr + 1e-3)
    ratio[35:43] = 3.1

    # REL-01: non-operational rows
    op = ['active_injection'] * N2
    op[0]='maintenance'; op[1]='maintenance'; op[2]='maintenance'
    op[3]='maintenance'; op[4]='maintenance'
    op[40]='idle'; op[41]='idle'; op[42]='idle'
    op[55]='shutdown'

    # C-03: TOTALISER_3 columns deliberately absent
    return pd.DataFrame({
        'timestamp_utc':           [t.strftime('%Y-%m-%d %H:%M:%S') for t in ts],
        'operational_state':       op,
        'FLOWRATE_1_m3h':          np.round(fl1, 3),
        'FLOWRATE_2_m3h':          fl2,
        'FLOWRATE_3_m3h':          np.round(fl3, 3),
        'TOTALISER_1_SENSOR_m3':   np.round(s1,  3),
        'TOTALISER_2_SENSOR_m3':   np.round(s2,  3),
        # TOTALISER_3_* intentionally absent → triggers C-03
        'TOTALISER_1_CALC_m3':     np.round(tot1c, 3),
        'TOTALISER_2_CALC_m3':     np.round(tot2c, 3),
        'WELL_PRESSURE_A_bar':     np.round(wp1,  3),
        'WELL_PRESSURE_B_bar':     np.round(wp2,  3),
        'WATER_CO2_RATIO':         np.round(ratio,4),
    })


# ─────────────────────────────────────────────────────────────────────────────
# Write files
# ─────────────────────────────────────────────────────────────────────────────
files = {
    'STR1_PASS_2024-03-15.csv': make_str1_pass(),
    'STR1_FAIL_2024-03-15.csv': make_str1_fail(),
    'STR2_PASS_2024-03-14.csv': make_str2_pass(),
    'STR2_FAIL_2024-03-14.csv': make_str2_fail(),
}

for fname, df in files.items():
    path = f'sample_data/{fname}'
    df.to_csv(path, index=False)
    mode = 'PASS ✓' if 'PASS' in fname else 'FAIL ✗'
    print(f'{mode}  {fname}  ({len(df)} rows × {len(df.columns)} cols)')


# ─────────────────────────────────────────────────────────────────────────────
# Violation reference guide
# ─────────────────────────────────────────────────────────────────────────────
print()
print('╔══════════════════════════════════════════════════════════════════════╗')
print('║  STR1 FAIL — Expected Violations (DQA-STR1-TDD-001)                 ║')
print('╠══════════════════════════════════════════════════════════════════════╣')
str1_viols = [
    ('C-02',    'null_value_tags',              'Rows 5-7',    'CO2_TRACER_01_ppm = NULL (maintenance window)'),
    ('I-01',    'flatline_detection',           'Rows 20-30',  'TEMP_SURF_02 stuck at constant reading'),
    ('I-02',    'range_bounds_check',           'Row 8',       'WHP_WELL_A = 355 bar (max: 300 bar) [CRITICAL]'),
    ('I-04',    'spike_detection',              'Row 15',      'INJ_RATE_FT01 ≈ 9× median — extreme spike'),
    ('T-01',    'ingestion_latency_sla',        'Rows 10, 25', 'Latency 480s and 410s (threshold: 300s)'),
    ('U-01',    'duplicate_timestamp_tag',      'Rows 35-36',  'Identical timestamp in rows 35 and 36'),
    ('U-02',    'event_deduplication',          'Rows 40-41',  'Repeated idle state transition'),
    ('A-01',    'sensor_vs_calc_totaliser',     'Rows 22-60',  'CO2_TOTAL_SENSOR 6% above calculated (max: 2%) [CRITICAL]'),
    ('CON-01',  'cross_sensor_agreement',       'Rows 22-30',  'WHP_WELL_B diverges 28 bar from WHP_WELL_A (max: 3 bar)'),
    ('CON-02',  'totaliser_integration',        'Row 22+',     'Step-jump of +180 m³ in totaliser not matched by flowrate'),
    ('CON-03',  'energy_per_tonne_trend',       'Rows 38-39',  'ENERGY = 322 kWh/t — >3σ outlier (normal ≈ 178)'),
    ('CON-04',  'water_co2_tracer_ratio',       'Rows 45-52',  'WATER_FLOW/CO2 ratio ≈ 3.8 (max: 0.6) — 6× bounds'),
    ('CON-05',  'pressure_temp_correlation',    'All rows',    'TEMP_SURF_01 anti-correlated with WHP_WELL_A'),
    ('CON-06',  'rate_pressure_correlation',    'Rows 30-50',  'INJ_RATE_FT01 anti-correlated with WHP rows 30-50'),
    ('CON-07',  'rolling_zscore_anomaly',       'Rows 12,28,38','ENERGY z-scores >3σ across rolling window'),
    ('REL-01',  'operational_state_filter',     'Rows 0-2, 50-52','Maintenance/idle rows — non-credit-eligible'),
    ('REL-03',  'startup_transient_exclusion',  'Row 3',       'Immediate injection after maintenance (no stabilisation)'),
    ('READ-02', 'critical_flag_gate',           'HARD GATE',   'Blocked: critical violations I-02 + A-01'),
    ('READ-03', 'minimum_data_coverage',        'HARD GATE',   'Coverage <85% from combined violations'),
]
for rule_id, rule_name, location, detail in str1_viols:
    print(f'║  {rule_id:<8}  {location:<14}  {detail:<42}║')
print('╚══════════════════════════════════════════════════════════════════════╝')

print()
print('╔══════════════════════════════════════════════════════════════════════╗')
print('║  STR2 FAIL — Expected Violations (DQA-STR2-TDD-001)                 ║')
print('╠══════════════════════════════════════════════════════════════════════╣')
str2_viols = [
    ('C-02',    'null_value_columns',           'Rows 8-10',   'FLOWRATE_2 = NULL (3 consecutive nulls)'),
    ('C-03',    'critical_column_absence',      'Whole file',  'TOTALISER_3_* columns absent [CRITICAL]'),
    ('I-01',    'flatline_detection',           'Rows 20-32',  'WELL_PRESSURE_B stuck at constant value'),
    ('I-02',    'range_bounds_check',           'Row 5',       'FLOWRATE_1 = 660 m³/h (max: 500 m³/h) [CRITICAL]'),
    ('I-04',    'spike_detection',              'Row 12',      'FLOWRATE_3 ≈ 12× median — extreme spike'),
    ('U-01',    'duplicate_rows',               'Rows 30-31',  'Rows 30 and 31 share identical timestamp'),
    ('A-01',    'sensor_vs_calc_totaliser',     'Row 25+',     'TOTALISER_1_SENSOR 7% above calculated [CRITICAL]'),
    ('A-02',    'mass_balance_closure',         'Rows 22-30',  'FLOWRATE_3 = 4% of inlet — mass balance fails'),
    ('CON-01',  'totaliser_integration',        'Row 25+',     '+220 m³ step-jump in TOTALISER_1_SENSOR'),
    ('CON-02',  'water_co2_ratio',              'Rows 35-42',  'WATER_CO2_RATIO = 3.1 (max: 0.6) — 5× bounds'),
    ('CON-03',  'pressure_injection_corr',      'All rows',    'WELL_PRESSURE_A anti-correlated with FLOWRATE_1'),
    ('CON-04',  'trend_check',                  'Rows 45-54',  'FLOWRATE_1 ×2.8 above historical norm'),
    ('REL-01',  'operational_state_filter',     'Rows 0-4, 40-42, 55', '9 maintenance/idle/shutdown rows'),
    ('READ-02', 'critical_flag_gate',           'HARD GATE',   'Blocked: critical violations C-03, I-02, A-01'),
    ('READ-03', 'minimum_data_coverage',        'HARD GATE',   'Coverage <85% from combined violations'),
]
for rule_id, rule_name, location, detail in str2_viols:
    print(f'║  {rule_id:<8}  {location:<14}  {detail:<42}║')
print('╚══════════════════════════════════════════════════════════════════════╝')
