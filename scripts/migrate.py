#!/usr/bin/env python3
"""Create and migrate MythicForge.db. The single owner of schema changes.

    python scripts/migrate.py              # create/migrate, print what changed
    python scripts/migrate.py --selfcheck  # run assertions, touch nothing real

server.js runs this before spawning Flask, and mcp_server.py calls ensure_db()
on first use, so there is exactly one implementation of every migration.

`setup.sql` is the source of truth for a *fresh* database. Because it uses
CREATE TABLE IF NOT EXISTS, it cannot alter a database that already exists --
that is what the MIGRATIONS list below is for. Adding a column or constraint to
setup.sql without adding a step here means existing installs never get it.
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Every process that opens the campaign DB honours this, so tests can point the
# whole stack at a scratch file.
FORGE_DB = Path(os.getenv("MYTHICFORGE_DB") or ROOT / "MythicForge.db")
SETUP_SQL = ROOT / "setup.sql"


def _columns(db, table):
	return {r[1] for r in db.execute(f"PRAGMA table_info({table})")}


def _table_sql(db, table):
	row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
	                 (table,)).fetchone()
	return row[0] if row else None


# --- migration steps ---------------------------------------------------------
# Each is (name, applies_to_db -> bool, apply -> None). Idempotent by construction:
# the predicate is what decides whether the step runs.

def _needs_inventory_reference(db):
	return "reference_id" not in _columns(db, "inventory")


def _add_inventory_reference(db):
	db.execute("ALTER TABLE inventory ADD COLUMN reference_id TEXT")


def _needs_password_columns(db):
	return "password_hash" not in _columns(db, "users")


def _add_password_columns(db):
	"""Move from a plaintext `password` column to salted scrypt hashes.

	Existing rows cannot be migrated -- a hash cannot be derived from a column
	that was never populated with anything trustworthy -- so they are marked
	with an empty hash, which verify() always rejects. Those accounts must reset.
	"""
	db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")
	db.execute("ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''")
	db.execute("ALTER TABLE users ADD COLUMN password_algo TEXT NOT NULL DEFAULT 'scrypt'")


def _needs_password_drop(db):
	return "password" in _columns(db, "users")


def _drop_plaintext_password(db):
	db.execute("ALTER TABLE users DROP COLUMN password")


def _needs_campaign_characters_pk(db):
	sql = _table_sql(db, "campaign_characters") or ""
	return "PRIMARY KEY" not in sql


def _rebuild_campaign_characters(db):
	"""SQLite cannot add a constraint via ALTER, so rebuild the table.

	Duplicate (campaign_id, character_id) pairs would violate the new primary
	key, so they are collapsed on the way across.
	"""
	db.execute("""
		CREATE TABLE campaign_characters_new (
			campaign_id INTEGER NOT NULL,
			character_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			PRIMARY KEY (campaign_id, character_id),
			FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id),
			FOREIGN KEY (character_id) REFERENCES characters(character_id)
		)""")
	db.execute("""
		INSERT INTO campaign_characters_new (campaign_id, character_id, user_id)
		SELECT campaign_id, character_id, MIN(user_id) FROM campaign_characters
		WHERE campaign_id NOTNULL AND character_id NOTNULL
		GROUP BY campaign_id, character_id""")
	db.execute("DROP TABLE campaign_characters")
	db.execute("ALTER TABLE campaign_characters_new RENAME TO campaign_characters")


def _needs_campaigns_fk(db):
	sql = _table_sql(db, "campaigns") or ""
	return "REFERENCES users" not in sql


def _rebuild_campaigns(db):
	db.execute("""
		CREATE TABLE campaigns_new (
			campaign_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES users(user_id),
			campaign_name TEXT NOT NULL,
			campaign_description TEXT,
			campaign_story TEXT,
			campaign_max_players INTEGER NOT NULL DEFAULT 4,
			campaign_start_level INTEGER NOT NULL DEFAULT 1,
			campaign_difficulty TEXT NOT NULL DEFAULT 'NORMAL',
			campaign_dm TEXT,
			campaign_setting TEXT,
			campaign_level_cap INTEGER NOT NULL DEFAULT 20,
			campaign_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			campaign_status TEXT NOT NULL DEFAULT 'INTRO'
		)""")
	cols = ", ".join(sorted(_columns(db, "campaigns") & _columns(db, "campaigns_new")))
	db.execute(f"INSERT INTO campaigns_new ({cols}) SELECT {cols} FROM campaigns")
	db.execute("DROP TABLE campaigns")
	db.execute("ALTER TABLE campaigns_new RENAME TO campaigns")


MIGRATIONS = [
	("inventory.reference_id", _needs_inventory_reference, _add_inventory_reference),
	("users password hash columns", _needs_password_columns, _add_password_columns),
	("drop users.password", _needs_password_drop, _drop_plaintext_password),
	("campaign_characters primary key", _needs_campaign_characters_pk,
	 _rebuild_campaign_characters),
	("campaigns.user_id foreign key", _needs_campaigns_fk, _rebuild_campaigns),
]


# --- driver ------------------------------------------------------------------

def ensure_db(path=None, verbose=False):
	"""Create the database if missing, then bring it up to date. Returns applied steps."""
	path = Path(path) if path else FORGE_DB
	db = sqlite3.connect(path)
	try:
		# WAL lets Node and Flask hold the file open at once; without it the
		# second writer gets 'database is locked'.
		db.execute("PRAGMA journal_mode = WAL")
		db.execute("PRAGMA busy_timeout = 5000")
		db.executescript(SETUP_SQL.read_text(encoding="utf8"))

		applied = []
		for name, needed, apply in MIGRATIONS:
			if not needed(db):
				continue
			# Rebuilds drop and recreate tables, which foreign_keys=ON would fight.
			db.execute("PRAGMA foreign_keys = OFF")
			with db:
				apply(db)
			applied.append(name)
			if verbose:
				print(f"  applied: {name}")

		db.execute("PRAGMA foreign_keys = ON")
		violations = db.execute("PRAGMA foreign_key_check").fetchall()
		if violations:
			print(f"  warning: {len(violations)} foreign key violations in existing rows",
			      file=sys.stderr)
		db.commit()
		return applied
	finally:
		db.close()


def selfcheck():
	import tempfile
	tmp = Path(tempfile.mkdtemp())

	# fresh database: setup.sql alone is already current, so nothing to migrate
	fresh = tmp / "fresh.db"
	assert ensure_db(fresh) == [], "a fresh DB should need no migrations"
	assert ensure_db(fresh) == [], "second run must be a no-op"
	db = sqlite3.connect(fresh)
	cols = _columns(db, "users")
	assert "password_hash" in cols and "password" not in cols, cols
	assert "PRIMARY KEY" in _table_sql(db, "campaign_characters")
	assert "REFERENCES users" in _table_sql(db, "campaigns")
	assert _table_sql(db, "sessions") is not None
	db.close()

	# a pre-F1 database, built the way the old setup.sql did it
	old = tmp / "old.db"
	db = sqlite3.connect(old)
	db.executescript("""
		CREATE TABLE users (user_id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE, password TEXT, email TEXT UNIQUE,
			allow_ai_use BOOLEAN NOT NULL DEFAULT 0, is_admin BOOLEAN NOT NULL DEFAULT 0);
		CREATE TABLE characters (character_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, name TEXT NOT NULL, race TEXT NOT NULL,
			class TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE inventory (item_id INTEGER PRIMARY KEY AUTOINCREMENT,
			character_id INTEGER, user_id INTEGER NOT NULL, item_name TEXT NOT NULL,
			quantity INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE campaigns (campaign_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, campaign_name TEXT NOT NULL,
			campaign_status TEXT NOT NULL DEFAULT 'INTRO');
		CREATE TABLE campaign_characters (campaign_id INTEGER, character_id INTEGER,
			user_id INTEGER NOT NULL);
	""")
	db.execute("INSERT INTO users (user_id, username, password) VALUES (1,'old','hunter2')")
	db.execute("INSERT INTO characters (character_id,user_id,name,race,class) "
	           "VALUES (1,1,'Thorin','Dwarf','Fighter')")
	db.execute("INSERT INTO campaigns (campaign_id,user_id,campaign_name) VALUES (1,1,'Old')")
	# the duplicate the missing primary key allowed
	db.execute("INSERT INTO campaign_characters VALUES (1,1,1)")
	db.execute("INSERT INTO campaign_characters VALUES (1,1,1)")
	db.commit(); db.close()

	applied = ensure_db(old)
	assert len(applied) == 5, applied

	db = sqlite3.connect(old)
	cols = _columns(db, "users")
	assert "password" not in cols, "plaintext column must be gone"
	assert {"password_hash", "password_salt", "password_algo"} <= cols, cols
	assert db.execute("SELECT password_hash FROM users WHERE user_id=1").fetchone()[0] == ""
	assert "reference_id" in _columns(db, "inventory")
	assert db.execute("SELECT count(*) FROM campaign_characters").fetchone()[0] == 1, \
		"duplicate rows must collapse under the new primary key"
	assert db.execute("SELECT count(*) FROM characters").fetchone()[0] == 1, "data preserved"
	assert db.execute("SELECT campaign_name FROM campaigns").fetchone()[0] == "Old"
	assert "REFERENCES users" in _table_sql(db, "campaigns")
	assert _table_sql(db, "sessions") is not None, "new tables arrive via setup.sql"
	db.close()

	assert ensure_db(old) == [], "migrated DB must then be a no-op"
	print("selfcheck OK")


if __name__ == "__main__":
	ap = argparse.ArgumentParser()
	ap.add_argument("--selfcheck", action="store_true")
	ap.add_argument("--db", help="path to the database (default MythicForge.db)")
	a = ap.parse_args()
	if a.selfcheck:
		selfcheck()
	else:
		applied = ensure_db(a.db, verbose=True)
		print(f"{FORGE_DB.name if not a.db else a.db}: "
		      f"{len(applied)} migration(s) applied" if applied else "database up to date")
