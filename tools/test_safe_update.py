import contextlib
import io
import os
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SCRIPT = (Path(__file__).resolve().parents[1] / "scripts" / "safe_update.sh").read_text()
SNIPPETS = re.findall(r"shell -v 0 -c '(\n.*?)\n'", SCRIPT, re.DOTALL)
FORWARD_CODE = next(code for code in SNIPPETS if 'COGFLOW_MIGRATION_APP' in code)
CREDIT_CODE = next(code for code in SNIPPETS if 'target = ("runs", "0004_' in code)
TARGET = ("runs", "0004_runsession_sona_credit_url_encrypted")


class AddField:
    model_name = "runsession"
    name = "sona_credit_url_encrypted"


class SafeUpdateTests(unittest.TestCase):
    def setUp(self):
        self.call_command = Mock()
        self.column = SimpleNamespace(name="sona_credit_url_encrypted", type_code=25, null_ok=False)
        self.connection = Mock()
        self.connection.cursor.return_value = contextlib.nullcontext(Mock())
        self.connection.introspection.get_table_description.return_value = [self.column]
        self.connection.introspection.get_field_type.return_value = "TextField"
        self.operation = AddField()
        self.migration = SimpleNamespace(app_label=TARGET[0], name=TARGET[1], operations=[self.operation])
        self.loader = Mock()
        self.loader.applied_migrations = set()
        self.loader.get_migration.return_value = self.migration
        self.loader.project_state.return_value.apps.get_model.return_value._meta.get_field.return_value = SimpleNamespace(column=self.column.name, null=False)
        self.executor = Mock(loader=self.loader)
        self.executor.migration_plan.return_value = [(self.migration, False)]
        self.modules = {}
        for name in ["django", "django.core", "django.core.management", "django.db", "django.db.migrations", "django.db.migrations.loader", "django.db.migrations.executor"]:
            self.modules[name] = ModuleType(name)
        self.modules["django.core.management"].call_command = self.call_command
        self.modules["django.db"].connection = self.connection
        self.modules["django.db"].migrations = self.modules["django.db.migrations"]
        self.modules["django.db.migrations"].AddField = AddField
        self.modules["django.db.migrations.loader"].MigrationLoader = lambda connection: self.loader
        self.modules["django.db.migrations.executor"].MigrationExecutor = lambda connection: self.executor

    def execute(self, code, fake=False):
        output = io.StringIO()
        environment = {
            "COGFLOW_MIGRATION_APP": TARGET[0],
            "COGFLOW_MIGRATION_NAME": TARGET[1],
            "COGFLOW_MIGRATION_FAKE": "--fake" if fake else "",
        }
        with patch.dict(sys.modules, self.modules), patch.dict(os.environ, environment), contextlib.redirect_stdout(output):
            exec(compile(code, "safe_update.sh", "exec"), {})
        return output.getvalue().strip()

    def test_existing_credit_column_is_recognized_without_modifying_data(self):
        self.assertEqual(self.execute(CREDIT_CODE), "column_exists")
        self.call_command.assert_not_called()

    def test_missing_credit_column_requires_normal_migration(self):
        self.connection.introspection.get_table_description.return_value = []
        self.assertEqual(self.execute(CREDIT_CODE), "column_missing")

    def test_applied_credit_migration_is_skipped(self):
        self.loader.applied_migrations.add(TARGET)
        self.assertEqual(self.execute(CREDIT_CODE), "already_applied")

    def test_incompatible_credit_column_is_rejected(self):
        self.connection.introspection.get_field_type.return_value = "IntegerField"
        with self.assertRaises(SystemExit):
            self.execute(CREDIT_CODE)

    def test_nullable_credit_column_is_rejected(self):
        self.column.null_ok = True
        with self.assertRaises(SystemExit):
            self.execute(CREDIT_CODE)

    def test_changed_migration_is_not_faked(self):
        self.migration.operations.append(AddField())
        with self.assertRaises(SystemExit):
            self.execute(CREDIT_CODE)

    def test_already_applied_target_never_plans_a_rollback(self):
        self.loader.applied_migrations.add(TARGET)
        self.execute(FORWARD_CODE, fake=True)
        self.executor.migration_plan.assert_not_called()
        self.call_command.assert_not_called()

    def test_fake_records_only_the_checked_migration(self):
        self.execute(FORWARD_CODE, fake=True)
        self.call_command.assert_called_once_with("migrate", *TARGET, fake=True, interactive=False)

    def test_fake_refuses_pending_dependencies(self):
        dependency = SimpleNamespace(app_label="runs", name="0003_runsession_flow_variant_fields")
        self.executor.migration_plan.return_value.insert(0, (dependency, False))
        with self.assertRaises(SystemExit):
            self.execute(FORWARD_CODE, fake=True)
        self.call_command.assert_not_called()

    def test_backward_plan_is_rejected(self):
        self.executor.migration_plan.return_value = [(self.migration, True)]
        with self.assertRaises(SystemExit):
            self.execute(FORWARD_CODE)
        self.call_command.assert_not_called()

    def test_missing_migration_is_applied_normally(self):
        self.execute(FORWARD_CODE)
        self.call_command.assert_called_once_with("migrate", *TARGET, fake=False, interactive=False)


if __name__ == "__main__":
    unittest.main()