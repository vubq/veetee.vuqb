from __future__ import annotations

import pytest

from backup_postgres import _temporary_database_url


def test_temporary_database_url_preserves_connection_options_without_database_name() -> None:
    value = _temporary_database_url("postgresql://veetee@127.0.0.1:55432/veetee_vubq?sslmode=disable", "veetee_restore_test")
    assert value == "postgresql://veetee@127.0.0.1:55432/veetee_restore_test?sslmode=disable"


def test_temporary_database_url_rejects_non_uri_dsn() -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL URI"):
        _temporary_database_url("host=127.0.0.1 dbname=veetee_vubq", "restore")
