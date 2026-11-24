"""MinRV data quality engine.

Checks a project's monitoring data (the stream metrics the calculation tree
reads), explains every finding in plain English, and records a verdict that
the same data and the same rule version always reproduce. Standard library
only, so it runs as a plain Lambda asset and in unit tests without AWS.
"""

ENGINE_VERSION = "0.1.0"
