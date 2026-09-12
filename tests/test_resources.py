import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import resources


class ModelLoadMemoryTests(unittest.TestCase):
    def _budget(self):
        self.assertTrue(
            hasattr(resources, "model_load_memory_budget"),
            "resources.model_load_memory_budget is not implemented",
        )
        return resources.model_load_memory_budget()

    def test_linux_budget_includes_free_swap(self):
        vm = SimpleNamespace(available=3_000_000_000)
        swap = SimpleNamespace(free=2_000_000_000)

        with (
            patch.object(sys, "platform", "linux"),
            patch.object(resources.psutil, "virtual_memory", return_value=vm),
            patch.object(resources.psutil, "swap_memory", return_value=swap),
        ):
            budget = self._budget()

        self.assertEqual(budget.ram_available, 3_000_000_000)
        self.assertEqual(budget.swap_available, 2_000_000_000)
        self.assertEqual(budget.total_available, 5_000_000_000)

    def test_non_linux_budget_remains_ram_only(self):
        vm = SimpleNamespace(available=3_000_000_000)
        swap = SimpleNamespace(free=2_000_000_000)

        with (
            patch.object(sys, "platform", "win32"),
            patch.object(resources.psutil, "virtual_memory", return_value=vm),
            patch.object(resources.psutil, "swap_memory", return_value=swap),
        ):
            budget = self._budget()

        self.assertEqual(budget.ram_available, 3_000_000_000)
        self.assertEqual(budget.swap_available, 0)
        self.assertEqual(budget.total_available, 3_000_000_000)

    def test_linux_reclaim_returns_unused_glibc_pages(self):
        self.assertTrue(
            hasattr(resources, "reclaim_unused_process_memory"),
            "resources.reclaim_unused_process_memory is not implemented",
        )
        malloc_trim = Mock(return_value=1)
        libc = SimpleNamespace(malloc_trim=malloc_trim)

        with (
            patch.object(sys, "platform", "linux"),
            patch.object(resources.gc, "collect") as collect,
            patch.object(resources.ctypes, "CDLL", return_value=libc),
        ):
            resources.reclaim_unused_process_memory()

        collect.assert_called_once_with()
        malloc_trim.assert_called_once_with(0)


if __name__ == "__main__":
    unittest.main()
