#!/usr/bin/env python3
"""The one implementation of every MythicForge operation.

    python scripts/forge_tools.py --selfcheck

Three surfaces import this module and none of them reimplement anything:

    forge_tools.py ──┬── mcp_server.py    external MCP clients (stdio)
                     ├── MythicForge.py   REST for the web UI
                     └── agent.py         the Phase 5 tool-use loop

Every campaign function takes `user_id` as its first argument and enforces
ownership itself, rather than trusting the caller to have filtered. A tool that
cannot be called for someone else's character is safe on all three surfaces at
once; one that relies on its caller is only as safe as the least careful of them.

The 5e reference functions take no user_id -- that database is shared, read-only
public data.

TOOLS at the bottom is the registry both MCP and REST enumerate. Adding a
function there exposes it everywhere; there is no per-surface list to update.
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import migrate

ROOT = Path(__file__).resolve().parent.parent
FORGE_DB = migrate.FORGE_DB
REF_DB = Path(os.getenv("MYTHICFORGE_REF_DB") or ROOT / "5etools.db")


class ToolError(Exception):
	"""Anything a caller did wrong. `status` maps straight onto HTTP."""

	def __init__(self, message, status=400):
		super().__init__(message)
		self.status = status


# --- db ----------------------------------------------------------------------

def forge():
	"""Campaign DB, created and migrated by scripts/migrate.py on first use."""
	migrate.ensure_db(FORGE_DB)
	db = sqlite3.connect(FORGE_DB)
	db.row_factory = sqlite3.Row
	# Node and Flask hold the same file open; wait rather than failing outright.
	db.execute("PRAGMA busy_timeout = 5000")
	db.execute("PRAGMA foreign_keys = ON")
	return db


def ref():
	"""5e reference DB, opened read-only."""
	if not REF_DB.exists():
		raise ToolError(
			f"{REF_DB.name} not found -- run `npm run build-data` first "
			"(it needs public/data/, which server.js downloads on first boot).",
			503)
	db = sqlite3.connect(f"file:{REF_DB}?mode=ro", uri=True)
	db.row_factory = sqlite3.Row
	return db


def rows(cur):
	return [dict(r) for r in cur.fetchall()]


def one(cur, what="record"):
	r = cur.fetchone()
	if r is None:
		raise ToolError(f"No such {what}", 404)
	return dict(r)


# --- ownership ---------------------------------------------------------------
# Each returns the row it verified, so callers get the lookup for free. A missing
# row and someone else's row both raise 404: whether a given id exists at all is
# not something one account should be able to probe for on another's behalf.

def _own_character(db, user_id, character_id):
	return one(db.execute(
		"SELECT * FROM characters WHERE character_id = ? AND user_id = ?",
		(character_id, user_id)), f"character {character_id}")


def _own_encounter(db, user_id, encounter_id):
	return one(db.execute(
		"SELECT * FROM encounters WHERE encounter_id = ? AND user_id = ?",
		(encounter_id, user_id)), f"encounter {encounter_id}")


def _own_combatant(db, user_id, combatant_id):
	"""A combatant is owned through the encounter it belongs to."""
	return one(db.execute(
		"SELECT c.* FROM encounter_combatants c "
		"JOIN encounters e ON e.encounter_id = c.encounter_id "
		"WHERE c.combatant_id = ? AND e.user_id = ?",
		(combatant_id, user_id)), f"combatant {combatant_id}")


def _own_inventory_item(db, user_id, item_id):
	return one(db.execute(
		"SELECT i.* FROM inventory i "
		"JOIN characters c ON c.character_id = i.character_id "
		"WHERE i.item_id = ? AND c.user_id = ?",
		(item_id, user_id)), f"inventory item {item_id}")


def _own_campaign(db, user_id, campaign_id):
	return one(db.execute(
		"SELECT * FROM campaigns WHERE campaign_id = ? AND user_id = ?",
		(campaign_id, user_id)), f"campaign {campaign_id}")


# --- 5e reference (shared, read-only) ----------------------------------------

def search_5e(query: str, kind: str | None = None, limit: int = 20) -> list[dict]:
	"""Full-text search the 5e reference, best matches first.

	Args:
		query: FTS5 query. Bare words are ANDed; "fire bolt" (quoted) is a phrase;
			supports NEAR, OR and a trailing * for prefix matching.
		kind: optional filter, e.g. 'spell', 'monster', 'item', 'feat', 'condition'.
		limit: maximum rows to return.
	"""
	sql = ("SELECT e.id, e.kind, e.name, e.source, e.page, "
	       "       substr(e.markdown, 1, 300) AS excerpt "
	       "FROM entity_fts f JOIN entity e ON e.id = f.id "
	       "WHERE entity_fts MATCH ?")
	args = [query]
	if kind:
		sql += " AND e.kind = ?"
		args.append(kind)
	# Columns are (id UNINDEXED, name, body); weight name heavily or a long note
	# that merely mentions the term outranks the note actually named for it.
	sql += " ORDER BY bm25(entity_fts, 0.0, 10.0, 1.0) LIMIT ?"
	args.append(max(1, min(limit, 100)))
	with ref() as db:
		try:
			return rows(db.execute(sql, args))
		except sqlite3.OperationalError as e:
			# Unbalanced quotes and stray operators are user error, not a fault.
			raise ToolError(f"Invalid search query: {e}", 400) from e


def get_5e_entity(entity_id: str, include_json: bool = False) -> dict:
	"""Fetch one 5e entry in full by its id, e.g. 'monster/MM/goblin'.

	Args:
		entity_id: the entity id, which is also its path in vault/ minus '.md'.
		include_json: also return the raw 5etools JSON (verbose; holds the
			structured statblock fields the markdown renders only as a JSON block).
	"""
	cols = "id, kind, name, source, page, markdown" + (", json" if include_json else "")
	with ref() as db:
		out = one(db.execute(f"SELECT {cols} FROM entity WHERE id = ?", (entity_id,)),
		          f"entity '{entity_id}'")
		if include_json:
			out["json"] = json.loads(out["json"])
		out["outgoing_links"] = [
			r["dst_id"] for r in db.execute(
				"SELECT DISTINCT dst_id FROM link WHERE src_id = ? AND dst_id NOTNULL",
				(entity_id,))
		]
	return out


def find_5e_by_name(name: str, kind: str | None = None) -> list[dict]:
	"""Look up 5e entries by exact or partial name, across every source book.

	Use this when you have a name from a statblock or player and need its id.

	Args:
		name: full or partial name, case-insensitive.
		kind: optional filter, e.g. 'monster'.
	"""
	sql = ("SELECT id, kind, name, source, page FROM entity "
	       "WHERE name LIKE ? COLLATE NOCASE")
	args = [f"%{name}%"]
	if kind:
		sql += " AND kind = ?"
		args.append(kind)
	sql += " ORDER BY (name = ? COLLATE NOCASE) DESC, length(name), name LIMIT 50"
	args.append(name)
	with ref() as db:
		return rows(db.execute(sql, args))


def backlinks_5e(entity_id: str, limit: int = 50) -> list[dict]:
	"""List 5e entries that reference this one.

	Answers questions like which monsters cast a given spell, or which
	adventures use a given creature.
	"""
	with ref() as db:
		return rows(db.execute(
			"SELECT DISTINCT e.id, e.kind, e.name, e.source FROM link l "
			"JOIN entity e ON e.id = l.src_id WHERE l.dst_id = ? "
			"ORDER BY e.kind, e.name LIMIT ?",
			(entity_id, max(1, min(limit, 200)))))


def list_5e_kinds() -> list[dict]:
	"""List every kind of 5e entry available, with counts. Call this first if
	you are unsure what the `kind` filter on the other tools accepts."""
	with ref() as db:
		return rows(db.execute(
			"SELECT kind, count(*) AS count FROM entity GROUP BY kind ORDER BY 2 DESC"))


# Challenge rating is stored either as a bare string ("5") or as an object
# ({"cr": "5", "lair": "6"}), and the low end is written as fractions. This
# resolves both shapes to a number so CR can be compared and sorted; anything
# unparseable ("Unknown") becomes NULL and drops out of range filters rather
# than silently sorting as zero.
_CR_TEXT = "COALESCE(json_extract(e.json,'$.cr.cr'), json_extract(e.json,'$.cr'))"
_CR_NUM = f"""CASE
	WHEN {_CR_TEXT} = '1/8' THEN 0.125
	WHEN {_CR_TEXT} = '1/4' THEN 0.25
	WHEN {_CR_TEXT} = '1/2' THEN 0.5
	WHEN {_CR_TEXT} GLOB '[0-9]*' THEN CAST({_CR_TEXT} AS REAL)
	ELSE NULL END"""


def list_5e(kind: str, source: str | None = None, name: str | None = None,
            cr_min: float | None = None, cr_max: float | None = None,
            level: int | None = None, limit: int = 100, offset: int = 0) -> dict:
	"""Browse 5e entries of one kind with filters and paging.

	Use this to populate a browser or pick monsters for an encounter, where
	search_5e is for free text. Returns `{total, limit, offset, items}`; `total`
	is the count before paging, so a UI can show how many more there are.

	Args:
		kind: required, e.g. 'monster', 'spell', 'item'. See list_5e_kinds.
		source: source book code, e.g. 'MM', 'PHB', 'XPHB'.
		name: partial name match, case-insensitive.
		cr_min: minimum challenge rating, monsters only. 0.25 means CR 1/4.
		cr_max: maximum challenge rating, monsters only.
		level: exact spell level, spells only. 0 is a cantrip.
		limit: page size, 1-500.
		offset: rows to skip, for paging.
	"""
	if not (kind or "").strip():
		raise ToolError("kind is required -- call list_5e_kinds to see the options")

	where, args = ["e.kind = ?"], [kind]
	if source:
		where.append("e.source = ?")
		args.append(source)
	if name:
		where.append("e.name LIKE ? COLLATE NOCASE")
		args.append(f"%{name}%")
	if level is not None:
		where.append("json_extract(e.json,'$.level') = ?")
		args.append(level)
	if cr_min is not None:
		where.append(f"({_CR_NUM}) >= ?")
		args.append(cr_min)
	if cr_max is not None:
		where.append(f"({_CR_NUM}) <= ?")
		args.append(cr_max)

	clause = " AND ".join(where)
	limit = max(1, min(int(limit), 500))
	offset = max(0, int(offset))

	with ref() as db:
		total = db.execute(
			f"SELECT count(*) FROM entity e WHERE {clause}", args).fetchone()[0]
		items = rows(db.execute(
			f"SELECT e.id, e.kind, e.name, e.source, e.page, "
			f"       {_CR_TEXT} AS cr, ({_CR_NUM}) AS cr_numeric, "
			f"       json_extract(e.json,'$.level') AS level "
			f"FROM entity e WHERE {clause} ORDER BY e.name, e.source LIMIT ? OFFSET ?",
			args + [limit, offset]))
	return {"total": total, "limit": limit, "offset": offset, "items": items}


# --- campaign reads ----------------------------------------------------------

def list_campaigns(user_id: int) -> list[dict]:
	"""List your campaigns."""
	with forge() as db:
		return rows(db.execute(
			"SELECT campaign_id, campaign_name, campaign_description, campaign_dm, "
			"campaign_setting, campaign_status, campaign_start_level "
			"FROM campaigns WHERE user_id = ? ORDER BY campaign_id", (user_id,)))


def list_characters(user_id: int, campaign_id: int | None = None,
                    include_npcs: bool = True) -> list[dict]:
	"""List characters, optionally only those in one campaign.

	Args:
		campaign_id: restrict to a campaign's roster.
		include_npcs: set false for player characters only.
	"""
	sql = ("SELECT c.character_id, c.name, c.race, c.class, c.level, c.isNPC, "
	       "       c.hit_points, c.max_hit_points, c.armor_class, c.alive "
	       "FROM characters c")
	where, args = ["c.user_id = ?"], [user_id]
	if campaign_id is not None:
		sql += " JOIN campaign_characters cc ON cc.character_id = c.character_id"
		where.append("cc.campaign_id = ?")
		args.append(campaign_id)
	if not include_npcs:
		where.append("c.isNPC = 0")
	with forge() as db:
		return rows(db.execute(f"{sql} WHERE {' AND '.join(where)} ORDER BY c.name", args))


def get_character(user_id: int, character_id: int) -> dict:
	"""Fetch one character in full: stats, skills, inventory, spells and conditions."""
	with forge() as db:
		out = _own_character(db, user_id, character_id)
		out.pop("avatar", None)  # blobs aren't JSON-serialisable and aren't useful here
		out.pop("token", None)
		for key, sql in (
			("stats", "SELECT stat_name, base_value, modifier FROM stats WHERE character_id = ?"),
			("skills", "SELECT skill_name, associated_stat, proficiency, bonus FROM skills WHERE character_id = ?"),
			("inventory", "SELECT item_id, item_name, item_type, quantity, weight, reference_id FROM inventory WHERE character_id = ?"),
			("equipment", "SELECT equipment_id, item_name, equipment_type, is_equipped, is_attuned, damage FROM equipment WHERE character_id = ?"),
			("spells", "SELECT spell_name, spell_level, prepared FROM spells WHERE character_id = ?"),
			("conditions", "SELECT condition_name, duration FROM conditions WHERE character_id = ?"),
		):
			out[key] = rows(db.execute(sql, (character_id,)))
	return out


def get_inventory(user_id: int, character_id: int) -> list[dict]:
	"""List one character's inventory. `reference_id`, where set, is a 5e item id
	you can pass to get_5e_entity for the full rules text."""
	with forge() as db:
		_own_character(db, user_id, character_id)
		return rows(db.execute(
			"SELECT item_id, item_name, item_type, quantity, weight, description, "
			"reference_id FROM inventory WHERE character_id = ? ORDER BY item_name",
			(character_id,)))


def list_encounters(user_id: int, campaign_id: int | None = None,
                    status: str | None = None) -> list[dict]:
	"""List encounters, newest first.

	Args:
		campaign_id: restrict to one campaign.
		status: 'PLANNED', 'ACTIVE' or 'COMPLETED'.
	"""
	where, args = ["user_id = ?"], [user_id]
	if campaign_id is not None:
		where.append("campaign_id = ?")
		args.append(campaign_id)
	if status:
		where.append("status = ?")
		args.append(status.upper())
	with forge() as db:
		return rows(db.execute(
			f"SELECT encounter_id, campaign_id, encounter_name, location, difficulty, "
			f"status, round FROM encounters WHERE {' AND '.join(where)} "
			f"ORDER BY encounter_id DESC", args))


def get_encounter(user_id: int, encounter_id: int) -> dict:
	"""Fetch an encounter with its combatants in initiative order.

	`whose_turn` names the combatant currently acting, or is null before
	initiative has been rolled.
	"""
	with forge() as db:
		out = _own_encounter(db, user_id, encounter_id)
		out["combatants"] = rows(db.execute(
			"SELECT * FROM encounter_combatants WHERE encounter_id = ? "
			"ORDER BY initiative IS NULL, initiative DESC, combatant_id",
			(encounter_id,)))
	order = [c for c in out["combatants"] if c["initiative"] is not None]
	out["whose_turn"] = (order[out["turn_index"] % len(order)]["display_name"]
	                     if order and out["status"] == "ACTIVE" else None)
	return out


# --- campaign writes ---------------------------------------------------------

def add_inventory_item(user_id: int, character_id: int, item_name: str, quantity: int = 1,
                       item_type: str | None = None, weight: float = 0.0,
                       description: str | None = None,
                       reference_id: str | None = None) -> dict:
	"""Give a character an item. If they already carry a matching item, its
	quantity increases instead of creating a duplicate row.

	Args:
		reference_id: optional 5e item id from find_5e_by_name, e.g.
			'item/DMG/bag-of-holding'. Set it when the item is a real 5e item so
			the rules text stays one lookup away.
	"""
	if quantity < 1:
		raise ToolError("quantity must be at least 1")
	if not (item_name or "").strip():
		raise ToolError("item_name is required")
	with forge() as db:
		_own_character(db, user_id, character_id)
		existing = db.execute(
			"SELECT item_id, quantity FROM inventory WHERE character_id = ? "
			"AND item_name = ? COLLATE NOCASE AND IFNULL(reference_id,'') = IFNULL(?,'')",
			(character_id, item_name, reference_id)).fetchone()
		if existing:
			db.execute("UPDATE inventory SET quantity = quantity + ? WHERE item_id = ?",
			           (quantity, existing["item_id"]))
			item_id, total = existing["item_id"], existing["quantity"] + quantity
		else:
			cur = db.execute(
				"INSERT INTO inventory (character_id, user_id, item_name, item_type, "
				"quantity, weight, description, reference_id) VALUES (?,?,?,?,?,?,?,?)",
				(character_id, user_id, item_name, item_type, quantity, weight,
				 description, reference_id))
			item_id, total = cur.lastrowid, quantity
		db.commit()
	return {"item_id": item_id, "item_name": item_name, "quantity": total}


def remove_inventory_item(user_id: int, item_id: int, quantity: int | None = None) -> dict:
	"""Remove an item, or some of a stack.

	Args:
		item_id: from get_inventory.
		quantity: how many to remove. Omit to remove the whole stack. Dropping to
			zero deletes the row.
	"""
	with forge() as db:
		row = _own_inventory_item(db, user_id, item_id)
		left = 0 if quantity is None else max(0, row["quantity"] - quantity)
		if left:
			db.execute("UPDATE inventory SET quantity = ? WHERE item_id = ?", (left, item_id))
		else:
			db.execute("DELETE FROM inventory WHERE item_id = ?", (item_id,))
		db.commit()
	return {"item_name": row["item_name"], "quantity": left, "removed": left == 0}


def update_hp(user_id: int, target: str, target_id: int, delta: int | None = None,
              set_to: int | None = None) -> dict:
	"""Apply damage or healing.

	Args:
		target: 'character' for a persistent character, 'combatant' for a row in
			an encounter's initiative order.
		target_id: character_id or combatant_id.
		delta: negative for damage, positive for healing. Clamped to
			[0, max_hit_points].
		set_to: set hit points outright instead. Give exactly one of delta/set_to.
	"""
	if (delta is None) == (set_to is None):
		raise ToolError("give exactly one of delta or set_to")
	if target not in ("character", "combatant"):
		raise ToolError("target must be 'character' or 'combatant'")

	with forge() as db:
		if target == "character":
			row = _own_character(db, user_id, target_id)
			table, key = "characters", "character_id"
		else:
			row = _own_combatant(db, user_id, target_id)
			table, key = "encounter_combatants", "combatant_id"

		new = row["hit_points"] + delta if delta is not None else set_to
		new = max(0, min(new, row["max_hit_points"] or new))
		db.execute(f"UPDATE {table} SET hit_points = ? WHERE {key} = ?", (new, target_id))
		if target == "character" and new == 0:
			db.execute("UPDATE characters SET alive = 0 WHERE character_id = ?", (target_id,))
		db.commit()
	return {"target": target, "id": target_id, "hit_points": new,
	        "max_hit_points": row["max_hit_points"], "was": row["hit_points"],
	        "downed": new == 0}


def log_event(user_id: int, campaign_id: int, event_name: str,
              event_summary: str | None = None, event_location: str | None = None,
              event_importance: str = "NORMAL") -> dict:
	"""Record something that happened, for campaign history and later recall.

	Args:
		event_importance: 'MINOR', 'NORMAL' or 'MAJOR'.
	"""
	with forge() as db:
		_own_campaign(db, user_id, campaign_id)
		cur = db.execute(
			"INSERT INTO event_history (campaign_id, user_id, event_name, event_summary, "
			"event_location, event_importance) VALUES (?,?,?,?,?,?)",
			(campaign_id, user_id, event_name, event_summary, event_location,
			 (event_importance or "NORMAL").upper()))
		db.commit()
	return {"event_id": cur.lastrowid, "event_name": event_name}


def create_encounter(user_id: int, encounter_name: str, campaign_id: int | None = None,
                     description: str | None = None, location: str | None = None,
                     difficulty: str = "MEDIUM") -> dict:
	"""Create an encounter. Add participants with add_combatant, then roll
	initiative with set_initiative and start it with advance_turn.

	Args:
		difficulty: 'EASY', 'MEDIUM', 'HARD' or 'DEADLY'.
	"""
	if not (encounter_name or "").strip():
		raise ToolError("encounter_name is required")
	with forge() as db:
		if campaign_id is not None:
			_own_campaign(db, user_id, campaign_id)
		cur = db.execute(
			"INSERT INTO encounters (campaign_id, user_id, encounter_name, description, "
			"location, difficulty) VALUES (?,?,?,?,?,?)",
			(campaign_id, user_id, encounter_name, description, location,
			 (difficulty or "MEDIUM").upper()))
		db.commit()
	return {"encounter_id": cur.lastrowid, "encounter_name": encounter_name,
	        "status": "PLANNED"}


def add_combatant(user_id: int, encounter_id: int, display_name: str,
                  character_id: int | None = None, reference_id: str | None = None,
                  max_hit_points: int = 0, armor_class: int = 10,
                  initiative: int | None = None, is_hostile: bool = True) -> dict:
	"""Add one participant to an encounter.

	Give either character_id (an existing character, whose HP and AC are copied
	if you leave them at their defaults) or reference_id (a 5e statblock id like
	'monster/MM/goblin'). For four goblins, call this four times with distinct
	display_names.
	"""
	if character_id is None and reference_id is None:
		raise ToolError("give either character_id or reference_id")
	with forge() as db:
		_own_encounter(db, user_id, encounter_id)
		if character_id is not None:
			src = _own_character(db, user_id, character_id)
			if not max_hit_points:
				max_hit_points = src["max_hit_points"]
				armor_class = armor_class if armor_class != 10 else src["armor_class"]
		cur = db.execute(
			"INSERT INTO encounter_combatants (encounter_id, character_id, reference_id, "
			"display_name, initiative, hit_points, max_hit_points, armor_class, is_hostile) "
			"VALUES (?,?,?,?,?,?,?,?,?)",
			(encounter_id, character_id, reference_id, display_name, initiative,
			 max_hit_points, max_hit_points, armor_class, int(is_hostile)))
		db.commit()
	return {"combatant_id": cur.lastrowid, "display_name": display_name,
	        "hit_points": max_hit_points}


def set_initiative(user_id: int, combatant_id: int, initiative: int) -> dict:
	"""Set one combatant's initiative. Combatants without initiative sort last
	and are skipped by advance_turn."""
	with forge() as db:
		_own_combatant(db, user_id, combatant_id)
		db.execute("UPDATE encounter_combatants SET initiative = ? WHERE combatant_id = ?",
		           (initiative, combatant_id))
		db.commit()
	return {"combatant_id": combatant_id, "initiative": initiative}


def set_conditions(user_id: int, combatant_id: int, conditions: list[str]) -> dict:
	"""Replace a combatant's conditions, e.g. ['prone', 'poisoned']. Pass an
	empty list to clear them. Condition names match 5e ids under kind
	'condition'."""
	if not isinstance(conditions, list):
		raise ToolError("conditions must be a list of strings")
	value = ",".join(str(c).strip().lower() for c in conditions if str(c).strip()) or None
	with forge() as db:
		_own_combatant(db, user_id, combatant_id)
		db.execute("UPDATE encounter_combatants SET conditions = ? WHERE combatant_id = ?",
		           (value, combatant_id))
		db.commit()
	return {"combatant_id": combatant_id, "conditions": value or ""}


def advance_turn(user_id: int, encounter_id: int) -> dict:
	"""Advance the initiative order by one, rolling into the next round at the
	end. Also flips a PLANNED encounter to ACTIVE and starts round 1."""
	with forge() as db:
		enc = _own_encounter(db, user_id, encounter_id)
		order = rows(db.execute(
			"SELECT combatant_id, display_name FROM encounter_combatants "
			"WHERE encounter_id = ? AND initiative NOTNULL "
			"ORDER BY initiative DESC, combatant_id", (encounter_id,)))
		if not order:
			raise ToolError("no combatant has initiative yet -- call set_initiative first")

		if enc["status"] != "ACTIVE":
			status, rnd, ix = "ACTIVE", 1, 0
		else:
			status = "ACTIVE"
			ix = enc["turn_index"] + 1
			rnd = enc["round"] + (1 if ix >= len(order) else 0)
			ix %= len(order)
		db.execute("UPDATE encounters SET status = ?, round = ?, turn_index = ? "
		           "WHERE encounter_id = ?", (status, rnd, ix, encounter_id))
		db.commit()
	return {"encounter_id": encounter_id, "round": rnd,
	        "whose_turn": order[ix]["display_name"],
	        "combatant_id": order[ix]["combatant_id"]}


def end_encounter(user_id: int, encounter_id: int, notes: str | None = None) -> dict:
	"""Mark an encounter COMPLETED. Combatants and their final state are kept."""
	with forge() as db:
		_own_encounter(db, user_id, encounter_id)
		db.execute("UPDATE encounters SET status = 'COMPLETED', notes = COALESCE(?, notes) "
		           "WHERE encounter_id = ?", (notes, encounter_id))
		db.commit()
	return {"encounter_id": encounter_id, "status": "COMPLETED"}


# --- registry ----------------------------------------------------------------
# The single list of what is callable. MCP and REST both enumerate this, so a
# function added here appears on both without touching either.

REFERENCE_TOOLS = [search_5e, get_5e_entity, find_5e_by_name, backlinks_5e,
                   list_5e_kinds, list_5e]

CAMPAIGN_TOOLS = [
	list_campaigns, list_characters, get_character, get_inventory,
	list_encounters, get_encounter,
	add_inventory_item, remove_inventory_item, update_hp, log_event,
	create_encounter, add_combatant, set_initiative, set_conditions,
	advance_turn, end_encounter,
]

# name -> (function, takes_user_id)
TOOLS = {fn.__name__: (fn, False) for fn in REFERENCE_TOOLS}
TOOLS.update({fn.__name__: (fn, True) for fn in CAMPAIGN_TOOLS})


def describe_arguments(fn, skip_user_id=True) -> list[dict]:
	"""Argument names, types and defaults for one tool, for UI and docs."""
	import inspect
	out = []
	for name, p in inspect.signature(fn).parameters.items():
		if skip_user_id and name == "user_id":
			continue
		annotation = p.annotation
		out.append({
			"name": name,
			"type": (getattr(annotation, "__name__", None) or str(annotation)
			         if annotation is not inspect.Parameter.empty else "any"),
			"required": p.default is inspect.Parameter.empty,
			"default": None if p.default is inspect.Parameter.empty else p.default,
		})
	return out


def call(name: str, user_id: int, arguments: dict):
	"""Invoke a registered tool by name. The entry point REST and the agent use.

	`user_id` comes from the authenticated session, never from `arguments` -- a
	caller cannot ask to act as someone else because the parameter is supplied
	here rather than parsed from the payload.
	"""
	entry = TOOLS.get(name)
	if entry is None:
		raise ToolError(f"No such tool '{name}'", 404)
	fn, takes_user = entry
	if not isinstance(arguments, dict):
		raise ToolError("arguments must be an object", 400)
	if "user_id" in arguments:
		raise ToolError("user_id is taken from your session, not the request", 400)
	try:
		return fn(user_id, **arguments) if takes_user else fn(**arguments)
	except TypeError as e:
		# Wrong or missing argument names are the caller's problem, not a crash.
		raise ToolError(f"Bad arguments for '{name}': {e}", 400) from e


# --- self-check --------------------------------------------------------------

def selfcheck():
	"""Every tool, including the ownership boundary between two users."""
	global FORGE_DB
	import tempfile
	FORGE_DB = Path(tempfile.mkdtemp()) / "MythicForge.db"

	ALICE, BOB = 1, 2
	with forge() as db:
		for uid, name in ((ALICE, "alice"), (BOB, "bob")):
			db.execute("INSERT INTO users (user_id, username, password_hash, password_salt) "
			           "VALUES (?,?,'','')", (uid, name))
			db.execute("INSERT INTO campaigns (campaign_id, user_id, campaign_name) "
			           "VALUES (?,?,?)", (uid, uid, f"{name}'s campaign"))
			db.execute("INSERT INTO characters (character_id, user_id, name, race, class, "
			           "hit_points, max_hit_points, armor_class) VALUES (?,?,?,'Dwarf','Fighter',24,24,18)",
			           (uid, uid, f"{name}-pc"))
		db.commit()

	def denied(fn, *a, **kw):
		"""Assert a cross-user call is refused rather than quietly succeeding."""
		try:
			fn(*a, **kw)
		except ToolError as e:
			assert e.status == 404, f"expected 404, got {e.status}"
			return
		raise AssertionError(f"{fn.__name__} allowed a cross-user call")

	# reads are scoped
	assert len(list_campaigns(ALICE)) == 1
	assert list_campaigns(ALICE)[0]["campaign_name"] == "alice's campaign"
	assert [c["name"] for c in list_characters(ALICE)] == ["alice-pc"]
	assert get_character(ALICE, ALICE)["name"] == "alice-pc"
	denied(get_character, ALICE, BOB)
	denied(get_inventory, ALICE, BOB)

	# inventory stacks, and only for characters you own
	a = add_inventory_item(ALICE, ALICE, "Torch", 5)
	b = add_inventory_item(ALICE, ALICE, "Torch", 3)
	assert a["item_id"] == b["item_id"] and b["quantity"] == 8, b
	assert len(get_inventory(ALICE, ALICE)) == 1
	denied(add_inventory_item, ALICE, BOB, "Contraband", 1)
	try:
		add_inventory_item(ALICE, ALICE, "Torch", 0)
		raise AssertionError("quantity 0 should be refused")
	except ToolError:
		pass

	bobs = add_inventory_item(BOB, BOB, "Bob's Sword", 1)
	denied(remove_inventory_item, ALICE, bobs["item_id"])
	assert remove_inventory_item(ALICE, b["item_id"], 3)["quantity"] == 5
	assert remove_inventory_item(ALICE, b["item_id"])["removed"] is True
	assert get_inventory(ALICE, ALICE) == []

	# a differing reference_id is a different stack
	add_inventory_item(ALICE, ALICE, "Longsword", 1)
	add_inventory_item(ALICE, ALICE, "Longsword", 1, reference_id="item/PHB/longsword")
	assert len(get_inventory(ALICE, ALICE)) == 2

	# hp clamps at both ends, flags the downed character, and respects ownership
	assert update_hp(ALICE, "character", ALICE, delta=-10)["hit_points"] == 14
	assert update_hp(ALICE, "character", ALICE, delta=999)["hit_points"] == 24, "clamped to max"
	r = update_hp(ALICE, "character", ALICE, delta=-500)
	assert r["hit_points"] == 0 and r["downed"] is True
	assert update_hp(ALICE, "character", ALICE, set_to=12)["hit_points"] == 12
	denied(update_hp, ALICE, "character", BOB, delta=-5)
	for bad in (dict(delta=1, set_to=1), dict()):
		try:
			update_hp(ALICE, "character", ALICE, **bad)
			raise AssertionError("must require exactly one of delta/set_to")
		except ToolError:
			pass

	# encounter lifecycle
	enc = create_encounter(ALICE, "Goblin Ambush", campaign_id=ALICE, difficulty="hard")
	eid = enc["encounter_id"]
	denied(create_encounter, ALICE, "Trespass", BOB)

	pc = add_combatant(ALICE, eid, "Thorin", character_id=ALICE)
	assert pc["hit_points"] == 24, "HP copied from the character"
	g1 = add_combatant(ALICE, eid, "Goblin 1", reference_id="monster/MM/goblin", max_hit_points=7)
	g2 = add_combatant(ALICE, eid, "Goblin 2", reference_id="monster/MM/goblin", max_hit_points=7)
	denied(add_combatant, BOB, eid, "Intruder", None, "monster/MM/goblin")
	denied(add_combatant, ALICE, eid, "Stolen PC", BOB)
	try:
		add_combatant(ALICE, eid, "Nobody")
		raise AssertionError("should require character_id or reference_id")
	except ToolError:
		pass

	assert get_encounter(ALICE, eid)["whose_turn"] is None, "not started yet"
	denied(get_encounter, BOB, eid)
	try:
		advance_turn(ALICE, eid)
		raise AssertionError("should refuse without initiative")
	except ToolError:
		pass

	set_initiative(ALICE, pc["combatant_id"], 18)
	set_initiative(ALICE, g1["combatant_id"], 12)
	set_initiative(ALICE, g2["combatant_id"], 20)
	denied(set_initiative, BOB, g1["combatant_id"], 99)
	denied(set_conditions, BOB, g1["combatant_id"], ["prone"])
	denied(update_hp, BOB, "combatant", g1["combatant_id"], -5)

	t = advance_turn(ALICE, eid)
	assert (t["round"], t["whose_turn"]) == (1, "Goblin 2"), t
	assert advance_turn(ALICE, eid)["whose_turn"] == "Thorin"
	assert advance_turn(ALICE, eid)["whose_turn"] == "Goblin 1"
	t = advance_turn(ALICE, eid)
	assert (t["round"], t["whose_turn"]) == (2, "Goblin 2"), "wrapped into round 2"
	assert get_encounter(ALICE, eid)["whose_turn"] == "Goblin 2"
	denied(advance_turn, BOB, eid)

	assert update_hp(ALICE, "combatant", g1["combatant_id"], delta=-99)["hit_points"] == 0
	assert set_conditions(ALICE, g2["combatant_id"], ["Prone", " poisoned "])["conditions"] \
		== "prone,poisoned"
	assert set_conditions(ALICE, g2["combatant_id"], [])["conditions"] == ""

	assert end_encounter(ALICE, eid, "TPK avoided")["status"] == "COMPLETED"
	denied(end_encounter, BOB, eid)
	assert list_encounters(ALICE, campaign_id=ALICE, status="completed")[0]["encounter_id"] == eid
	assert list_encounters(BOB) == [], "Bob sees none of Alice's encounters"

	assert log_event(ALICE, ALICE, "Ambushed on the road", "Two goblins")["event_id"] == 1
	denied(log_event, ALICE, BOB, "Forged history")

	# the dispatch entry point
	assert call("list_campaigns", ALICE, {})[0]["campaign_name"] == "alice's campaign"
	assert call("get_character", ALICE, {"character_id": ALICE})["name"] == "alice-pc"
	for name, args, why in (
		("no_such_tool", {}, "unknown tool"),
		("get_character", {"nope": 1}, "unexpected keyword"),
		("get_character", {}, "missing required argument"),
		("get_character", {"character_id": ALICE, "user_id": BOB}, "user_id from payload"),
	):
		try:
			call(name, ALICE, args)
			raise AssertionError(f"call() should reject: {why}")
		except ToolError:
			pass
	assert call("get_character", ALICE, {"character_id": ALICE})["name"] == "alice-pc"
	# private helpers are not reachable by name
	assert "_own_character" not in TOOLS and "forge" not in TOOLS

	# reference tools, only if that DB has been built
	if REF_DB.exists():
		assert search_5e("fireball", kind="spell", limit=3)[0]["name"] == "Fireball", \
			"a note named for the term must outrank one that merely mentions it"
		assert get_5e_entity("monster/MM/goblin")["name"] == "Goblin"
		assert len(backlinks_5e("condition/PHB/prone", limit=200)) > 50
		assert find_5e_by_name("goblin", kind="monster")[0]["id"] == "monster/MM/goblin"
		assert dict((k["kind"], k["count"]) for k in list_5e_kinds())["monster"] > 4000
		assert call("search_5e", ALICE, {"query": "goblin", "limit": 1}), "reference via call()"
		try:
			search_5e('unbalanced "quote')
			raise AssertionError("a malformed FTS query should be a ToolError")
		except ToolError as e:
			assert e.status == 400

		# list_5e: paging, filters and the two challenge-rating storage shapes
		page = list_5e("monster", limit=5)
		assert page["total"] > 4000 and len(page["items"]) == 5, page["total"]
		assert page["limit"] == 5 and page["offset"] == 0
		second = list_5e("monster", limit=5, offset=5)
		assert second["total"] == page["total"], "total is the count before paging"
		assert not ({i["id"] for i in page["items"]} & {i["id"] for i in second["items"]}), \
			"paging must not repeat rows"

		assert all(i["source"] == "MM" for i in list_5e("monster", source="MM")["items"])
		assert all("goblin" in i["name"].lower()
		           for i in list_5e("monster", name="goblin")["items"])

		cantrips = list_5e("spell", level=0, limit=500)
		assert cantrips["total"] > 40 and all(i["level"] == 0 for i in cantrips["items"])

		# fractional CRs sort below 1 rather than being read as 1/8 = 1
		low = list_5e("monster", cr_max=0.25, limit=500)
		assert low["total"] > 100, low["total"]
		assert all(i["cr_numeric"] <= 0.25 for i in low["items"])
		assert any(i["cr"] == "1/8" for i in low["items"]), "1/8 must parse as 0.125"
		assert not any(i["cr"] == "1" for i in low["items"]), "CR 1 is above the ceiling"

		band = list_5e("monster", cr_min=5, cr_max=5, limit=500)
		assert band["total"] > 50 and all(i["cr_numeric"] == 5 for i in band["items"])
		# night-hag stores cr as {"cr": "5", "coven": "7"}, so this only passes if
		# the object shape resolves to its base value rather than being skipped
		assert any(i["id"] == "monster/MM/night-hag" for i in band["items"]), \
			"object-shaped cr must resolve to its base value"

		assert list_5e("monster", cr_min=99)["total"] == 0, "empty result, not an error"
		try:
			list_5e("")
			raise AssertionError("kind is required")
		except ToolError:
			pass
	else:
		print("  (5etools.db absent -- skipped reference tool checks)")

	print(f"selfcheck OK ({len(TOOLS)} tools)")


if __name__ == "__main__":
	ap = argparse.ArgumentParser()
	ap.add_argument("--selfcheck", action="store_true")
	ap.add_argument("--list", action="store_true", help="print the tool registry")
	a = ap.parse_args()
	if a.selfcheck:
		selfcheck()
	elif a.list:
		for name, (fn, takes_user) in sorted(TOOLS.items()):
			scope = "user" if takes_user else "public"
			print(f"{name:24s} {scope:7s} {(fn.__doc__ or '').strip().splitlines()[0]}")
	else:
		ap.print_help()
