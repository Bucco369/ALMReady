"""What-If analysis services.

This package contains the business logic for the What-If workbench:
- decomposer: Converts high-level instrument specs into motor positions
"""

from .decomposer import LoanSpec, decompose_loan  # noqa: F401
