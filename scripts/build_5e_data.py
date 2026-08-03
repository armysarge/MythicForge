#!/usr/bin/env python3
"""Build the 5e reference database and Obsidian vault from the 5etools JSON.

    python scripts/build_5e_data.py             # 5etools.db + vault/
    python scripts/build_5e_data.py --only db   # or: vault
    python scripts/build_5e_data.py --selfcheck # run assertions, write nothing

Reads public/data/ (downloaded by server.js on first boot) and writes 5etools.db
plus vault/, both gitignored. Stdlib only.

The DB is one generic `entity` table (JSON1 for typed queries), an FTS5 index,
and a resolved `link` graph. The vault mirrors it as
vault/<kind>/<source>/<slug>.md with relative links -- Obsidian indexes those
for graph and backlinks the same as wikilinks, so there is only one format.

Nothing here touches MythicForge.db; campaign data lives there, reference data
lives here, and encounters cross-reference by `entity.id` string.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
# The vendored 5etools JS the frontend renders with -- keeping the tag map in
# step with it means links here resolve the same way the UI does.
JS_DIR = ROOT / "public" / "assets" / "plugins" / "5eTools"

# VTT plumbing / tooling, not content.
SKIP_PREFIXES = ("foundry-", "makebrew-", "gendata-")
SKIP_NAMES = {"converter.json", "changelog.json", "encounterbuilder.json", "makecards.json"}

# From js/parser.js Parser.PROP_TO_TAG / TAG_TO_PROPS.
PROP_TO_TAG = {
	"monster": "creature", "optionalfeature": "optfeature", "tableGroup": "table",
	"vehicleUpgrade": "vehupgrade", "baseitem": "item", "itemGroup": "item",
	"magicvariant": "item", "crochetPattern": "crochet",
}
TAG_TO_PROPS = {
	"creature": ["monster"], "optfeature": ["optionalfeature"],
	"table": ["table", "tableGroup"], "vehupgrade": ["vehicleUpgrade"],
	"item": ["item", "baseitem", "itemGroup", "magicvariant"],
}

TAG_RE = re.compile(r"{@(\w+)(?:\s+([^{}]*(?:{[^{}]*}[^{}]*)*))?}")
MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")


# --- tag metadata, lifted from the repo's own JS so defaults stay accurate ----

def load_tag_default_sources():
	"""tag name -> default source, scraped from the vendored render.js + parser.js."""
	parser_js = (JS_DIR / "parser.js").read_text(encoding="utf8")
	consts = dict(re.findall(r'^Parser\.(SRC_\w+)\s*=\s*"([^"]+)";', parser_js, re.M))
	render_js = (JS_DIR / "render.js").read_text(encoding="utf8")
	out = {}
	for tag, const in re.findall(
		r'tagName\s*=\s*"(\w+)";\s*\n\s*defaultSource\s*=\s*Parser\.(SRC_\w+);', render_js
	):
		if const in consts:
			out[tag] = consts[const]
	return out


# --- loading -----------------------------------------------------------------

def iter_json_files():
	for p in sorted(DATA.rglob("*.json")):
		if p.name in SKIP_NAMES or p.name.startswith(SKIP_PREFIXES):
			continue
		yield p


def load_entities():
	"""[{prop, name, source, data, file}] for every named record in data/."""
	ents = []
	for path in iter_json_files():
		rel = path.relative_to(ROOT).as_posix()
		try:
			doc = json.loads(path.read_text(encoding="utf8"))
		except Exception as e:  # noqa: BLE001 - report and keep going
			print(f"  ! unreadable {rel}: {e}", file=sys.stderr)
			continue
		if not isinstance(doc, dict):
			continue

		# adventure/ and book/ bodies are bare {"data": [chapters]}; the id is the filename.
		parent = path.parent.name
		if parent in ("adventure", "book") and set(doc) <= {"data"}:
			book_id = path.stem.split("-", 1)[-1].upper()
			for chap in doc.get("data", []):
				if isinstance(chap, dict) and chap.get("name"):
					ents.append(dict(prop=f"{parent}Chapter", name=chap["name"],
					                 source=book_id, data=chap, file=rel))
			continue

		for prop, val in doc.items():
			if prop.startswith("_") or not isinstance(val, list):
				continue
			for rec in val:
				if isinstance(rec, dict) and isinstance(rec.get("name"), str):
					# magicvariant keeps its source under `inherits`
					src = rec.get("source") or rec.get("inherits", {}).get("source")
					ents.append(dict(prop=prop, name=rec["name"],
					                 source=str(src or "NONE"), data=rec, file=rel))
	return ents


# --- _copy resolution --------------------------------------------------------

def _mod_apply(target, prop, mods):
	"""Apply one _mod entry list to target[prop]."""
	for mod in mods if isinstance(mods, list) else [mods]:
		if isinstance(mod, str):  # e.g. "*clearFluff"
			continue
		mode = mod.get("mode")
		items = mod.get("items")
		items = items if isinstance(items, list) else ([items] if items is not None else [])
		arr = target.get(prop)
		if mode == "prependArr":
			target[prop] = items + (arr or [])
		elif mode == "appendArr":
			target[prop] = (arr or []) + items
		elif mode == "appendIfNotExistsArr":
			arr = arr or []
			have = {json.dumps(x, sort_keys=True) for x in arr}
			target[prop] = arr + [i for i in items if json.dumps(i, sort_keys=True) not in have]
		elif mode == "insertArr":
			arr = arr or []
			ix = mod.get("index", len(arr))
			target[prop] = arr[:ix] + items + arr[ix:]
		elif mode in ("replaceArr", "removeArr"):
			if not isinstance(arr, list):
				continue
			names = mod.get("names")
			names = names if isinstance(names, list) else ([names] if names else [])
			key = mod.get("replace") if mode == "replaceArr" else None
			targets = names or ([key] if key else [])
			out, hit = [], False
			for el in arr:
				el_name = el.get("name") if isinstance(el, dict) else el
				if el_name in targets:
					hit = True
					if mode == "replaceArr":
						out.extend(items)
					continue
				out.append(el)
			if hit or mode == "removeArr":
				target[prop] = out
		elif mode == "setProp":
			node = target
			path = (mod.get("prop") or prop).split(".")
			for step in path[:-1]:
				node = node.setdefault(step, {})
			node[path[-1]] = mod.get("value")
		elif mode == "replaceTxt":
			pat, repl = mod.get("replace"), mod.get("with", "")
			if not pat:
				continue
			rx = re.compile(pat if mod.get("flags") else re.escape(str(pat)),
			                re.I if "i" in (mod.get("flags") or "") else 0)
			def sub(node):
				if isinstance(node, str):
					return rx.sub(repl, node)
				if isinstance(node, list):
					return [sub(x) for x in node]
				if isinstance(node, dict):
					return {k: (v if k in ("type", "source") else sub(v)) for k, v in node.items()}
				return node
			for k in (list(target) if prop == "*" else [prop]):
				target[k] = sub(target[k])
		# ponytail: replaceSpells/addSpells/addSkills unimplemented (~25 records,
		# monster-specific merge semantics). Add if those creatures come up short.


def resolve_copies(ents):
	"""Materialise `_copy` stubs in place. Returns (resolved, unresolved) counts."""
	index = {(e["prop"], e["name"].lower(), e["source"].lower()): e for e in ents}
	state = {}  # id(entity) -> "done" | "busy"
	ok = bad = 0

	def resolve(ent):
		nonlocal ok, bad
		key = id(ent)
		if state.get(key):
			return
		state[key] = "busy"
		cp = ent["data"].get("_copy")
		if isinstance(cp, dict) and cp.get("name"):
			src = index.get((ent["prop"], cp["name"].lower(),
			                 str(cp.get("source", "")).lower()))
			if src is None or state.get(id(src)) == "busy":
				bad += 1
			else:
				resolve(src)
				merged = json.loads(json.dumps(src["data"]))
				for k in ("name", "source", "page", "_copy", "otherSources", "reprintedAs"):
					merged.pop(k, None)
				mods = cp.get("_mod")
				if isinstance(mods, dict):
					for prop, m in mods.items():
						_mod_apply(merged, prop, m)
				merged.update({k: v for k, v in ent["data"].items() if k != "_copy"})
				merged["_copiedFrom"] = f"{cp['name']}|{cp.get('source', '')}"
				ent["data"] = merged
				ok += 1
		state[key] = "done"

	for e in ents:
		resolve(e)
	return ok, bad


# --- rendering ---------------------------------------------------------------

def slugify(s):
	s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
	return s or "unnamed"


def split_pipe(text):
	"""Split on | but not inside nested {@...} tags."""
	parts, depth, buf = [], 0, []
	for ch in text:
		if ch == "{":
			depth += 1
		elif ch == "}":
			depth -= 1
		if ch == "|" and depth == 0:
			parts.append("".join(buf)); buf = []
		else:
			buf.append(ch)
	parts.append("".join(buf))
	return parts


def attack_tag_to_full(tag_str, is_roll=False):
	"""Port of Renderer.attackTagToFull: "mw,rw" -> "Melee or Ranged Weapon Attack:"."""
	groups = [list(g.strip()) for g in tag_str.lower().split(",") if g.strip()]
	seen = set(groups[-1]) if groups else set()
	for i in range(len(groups) - 2, -1, -1):  # later groups win shared letters
		groups[i] = [c for c in groups[i] if not (c in seen or seen.add(c))]
	def one(tags):
		typ = ("Melee " if "m" in tags else "Ranged " if "r" in tags
		       else "Magical " if "g" in tags else "Area " if "a" in tags else "")
		method = ("Weapon " if "w" in tags else "Spell " if "s" in tags
		          else "Power " if "p" in tags else "")
		return typ + method
	pre = " or ".join(p for p in (one(g).strip() for g in groups) if p)
	return f"{pre} Attack{' Roll' if is_roll else ''}:".lstrip()


ENTRY_KEYS = ("entries", "entriesHigherLevel", "trait", "action", "bonus", "reaction",
              "legendary", "mythic", "legendaryActions", "lairActions", "regionalEffects",
              "fluff", "items", "footnotes", "instructions", "headerEntries")


class Renderer:
	"""Turns 5etools entry trees + {@tags} into Markdown."""

	def __init__(self, tag_sources, by_tag=None, self_path=None, links=None):
		self.tag_sources = tag_sources
		self.by_tag = by_tag or {}
		self.self_path = self_path
		self.links = links  # list to append (tag, name, source, dst_id) to

	# -- inline tags --
	def text(self, s):
		if not isinstance(s, str) or "{@" not in s:
			return s if isinstance(s, str) else str(s)
		prev = None
		while prev != s:  # nested tags: re-run until stable
			prev = s
			s = TAG_RE.sub(self._tag, s)
		return s

	def _tag(self, m):
		tag, body = m.group(1), (m.group(2) or "").strip()
		parts = split_pipe(body)
		p0 = parts[0].strip()

		if tag in ("b", "bold"):
			return f"**{self.text(p0)}**"
		if tag in ("i", "italic"):
			return f"*{self.text(p0)}*"
		if tag in ("s", "strike"):
			return f"~~{self.text(p0)}~~"
		if tag in ("u", "underline", "note", "tip", "highlight", "comic", "comicH1",
		           "comicH2", "comicH3", "comicH4", "comicNote", "code", "kbd"):
			return self.text(p0)
		if tag == "h":
			return "*Hit:* "
		if tag in ("atk", "atkr"):
			return f"*{attack_tag_to_full(p0, tag == 'atkr')}*"
		if tag == "hitYourSpellAttack":
			return p0 or "your spell attack modifier"
		if tag == "dc":
			return f"DC {p0}"
		if tag == "hit":
			try:
				return f"{int(p0):+d}"
			except ValueError:
				return p0
		if tag == "chance":
			return f"{p0} percent"
		if tag == "recharge":
			return f"(Recharge {p0 or '6'}–6)"
		if tag in ("dice", "damage", "d20", "d", "scaledice", "scaledamage", "autodice"):
			disp = parts[-1] if len(parts) > 1 and parts[-1].strip() else p0
			return disp.strip()
		if tag in ("color", "font"):
			return self.text(p0)
		if tag in ("filter", "5etools", "5etoolsImg", "link", "footnote", "area", "loader"):
			return self.text(parts[-1].strip() if len(parts) > 1 else p0)

		if tag in self.tag_sources:
			return self._link(tag, parts)
		return self.text(p0)

	# These tags carry routing (class, deck, pantheon) in the middle pipes; the
	# real source, if given, sits at a fixed later index. From js/render.js.
	# tag -> (source pipe index, display-text pipe index). Default (1, 2).
	PIPE_IX = {"classFeature": (4, 5), "subclassFeature": (6, 7), "subclass": (3, 4),
	           "card": (2, 3), "deity": (2, 3)}

	def _link(self, tag, parts):
		name = parts[0].strip()
		six, dix = self.PIPE_IX.get(tag, (1, 2))
		source = (parts[six].strip() if len(parts) > six and parts[six].strip()
		          else self.tag_sources[tag])
		label = (parts[dix].strip() if len(parts) > dix and parts[dix].strip() else name)
		label = self.text(label)
		dst = self.by_tag.get((tag, name.lower(), source.lower()))
		if self.links is not None:
			self.links.append((tag, name, source, dst["id"] if dst else None))
		if not dst or self.self_path is None:
			return label
		if dst["path"] == self.self_path:
			return label
		rel = os.path.relpath(dst["path"], os.path.dirname(self.self_path)).replace("\\", "/")
		return f"[{label}]({rel})"

	# -- block entries --
	def entries(self, node, depth=2):
		out = []
		self._render(node, out, depth)
		return "\n".join(out).strip()

	def _render(self, node, out, depth):
		if node is None:
			return
		if isinstance(node, (str, int, float, bool)):
			out.append(self.text(str(node)) + "\n")
			return
		if isinstance(node, list):
			for n in node:
				self._render(n, out, depth)
			return
		if not isinstance(node, dict):
			return

		typ = node.get("type", "entries")
		name = node.get("name")

		if typ == "list":
			for it in node.get("items", []):
				if isinstance(it, dict) and it.get("name"):
					body = self.entries(it.get("entries") or it.get("entry") or "", depth)
					out.append(f"- **{self.text(it['name'])}** {body}".rstrip() + "\n")
				else:
					body = self.entries(it, depth).replace("\n", " ").strip()
					out.append(f"- {body}\n")
			out.append("")
			return

		if typ == "table":
			self._table(node, out)
			return

		if typ in ("cell", "row"):
			self._render(node.get("entry") or node.get("entries") or node.get("roll", ""), out, depth)
			return

		if typ == "quote":
			body = self.entries(node.get("entries", []), depth)
			by = node.get("by")
			out.append("\n".join(f"> {ln}" for ln in body.splitlines()))
			if by:
				out.append(f">\n> — {self.text(by)}")
			out.append("")
			return

		if typ == "image":
			href = node.get("href", {})
			path = href.get("path") or href.get("url") or ""
			# Alt text can't contain links -- a tag in a caption would nest brackets
			# and break the image out of its own syntax.
			title = MD_LINK_RE.sub(r"\1", self.text(node.get("title") or "image"))
			if path and not path.startswith("http"):
				path = f"https://5e.tools/{path}"
			out.append(f"![{title}]({path})\n" if path else "")
			return

		if typ in ("inset", "insetReadaloud", "statblockInline"):
			if name:
				out.append(f"> **{self.text(name)}**\n>")
			body = self.entries(node.get("entries", []), depth)
			out.append("\n".join(f"> {ln}" for ln in body.splitlines()) + "\n")
			return

		if typ in ("link", "abilityDc", "abilityAttackMod", "abilityGeneric", "refClassFeature",
		           "refSubclassFeature", "refOptionalfeature", "statblock", "gallery",
		           "flowchart", "ingredient", "dataCreature", "dataSpell", "dataItem"):
			txt = node.get("text") or node.get("entry") or node.get("name") or ""
			if txt:
				out.append(self.text(str(txt)) + "\n")
			if typ == "gallery":
				self._render(node.get("images", []), out, depth)
			return

		if typ == "spellcasting":
			if name:
				out.append(f"{'#' * min(depth, 6)} {self.text(name)}\n")
			self._render(node.get("headerEntries", []), out, depth + 1)
			for grp in ("will", "daily", "rest", "weekly", "yearly", "ritual", "spells"):
				val = node.get(grp)
				if isinstance(val, dict):
					for k, v in val.items():
						label = f"{grp} ({k})" if grp != "spells" else f"level {k}"
						spells = v.get("spells") if isinstance(v, dict) else v
						out.append(f"- **{label}:** " +
						           ", ".join(self.text(s) for s in (spells or [])) + "\n")
			self._render(node.get("footerEntries", []), out, depth + 1)
			return

		# entries / section / chapter / variant / options / everything else
		if name:
			out.append(f"{'#' * min(depth, 6)} {self.text(name)}\n")
		self._render(node.get("entries", node.get("entry", "")), out, depth + 1)
		if "items" in node:
			self._render(node["items"], out, depth + 1)

	def _table(self, node, out):
		if node.get("caption"):
			out.append(f"**{self.text(node['caption'])}**\n")
		head = [self.text(str(h)) for h in (node.get("colLabels") or [])]
		rows = []
		for row in node.get("rows", []):
			cells = row.get("row", []) if isinstance(row, dict) else row
			rows.append([self.entries(c, 6).replace("\n", " ").strip() or " "
			             for c in (cells if isinstance(cells, list) else [cells])])
		width = max([len(head)] + [len(r) for r in rows] or [0]) or 1
		head = (head + [" "] * width)[:width]
		out.append("| " + " | ".join(head) + " |")
		out.append("|" + "---|" * width)
		for r in rows:
			r = (r + [" "] * width)[:width]
			out.append("| " + " | ".join(c.replace("|", "\\|") for c in r) + " |")
		out.append("")


# --- assembly ----------------------------------------------------------------

def build(want_sqlite=True, want_md=True):
	if not DATA.is_dir():
		sys.exit(f"{DATA} not found -- start the server once (npm start) to download "
		         f"the 5etools data, then re-run this.")
	print(f"loading {DATA.relative_to(ROOT).as_posix()}/ ...")
	ents = load_entities()
	print(f"  {len(ents)} records")

	ok, bad = resolve_copies(ents)
	print(f"resolved {ok} _copy stubs ({bad} unresolvable)")

	# assign ids + markdown paths (dedupe within kind/source)
	seen = set()
	for e in ents:
		base = eid = f"{e['prop']}/{e['source']}/{slugify(e['name'])}"
		n = 1
		while eid in seen:
			n += 1
			eid = f"{base}-{n}"
		seen.add(eid)
		e["id"] = eid
		e["path"] = f"{eid}.md"

	by_tag = {}
	for e in ents:
		tag = PROP_TO_TAG.get(e["prop"], e["prop"])
		by_tag.setdefault((tag, e["name"].lower(), e["source"].lower()), e)

	tag_sources = load_tag_default_sources()
	print(f"  {len(tag_sources)} linkable tag types from the vendored 5etools JS")

	all_links = []
	rendered = {}

	print("rendering ...")
	for e in ents:
		links = []
		r = Renderer(tag_sources, by_tag, e["path"] if want_md else None, links)
		rendered[e["id"]] = render_entity(e, r)
		all_links.extend((e["id"], *l) for l in links)

	resolved = sum(1 for l in all_links if l[4])
	print(f"  {len(all_links)} tag references, {resolved} resolved "
	      f"({100 * resolved // max(len(all_links), 1)}%)")

	if want_sqlite:
		write_sqlite(ROOT / "5etools.db", ents, rendered, all_links)
	if want_md:
		write_vault(ROOT / "vault", ents, rendered)
	return ents, all_links


VAULT_README = """---
tags: [moc]
---
# 5e Reference Vault

Open this folder as an Obsidian vault. Every note is generated -- edits are lost
on the next `npm run build-data`, so keep campaign notes in a separate vault and
link across.

{index}

## How it fits together

Notes live at `<kind>/<source>/<slug>.md`. Links are relative markdown links,
which Obsidian indexes for graph view and the backlinks pane exactly like
wikilinks, so there is only one link format to reason about.

Each note's `id` in frontmatter is its path minus `.md` -- the same string used
as `entity.id` in `5etools.db` and as `reference_id` on encounter combatants in
`MythicForge.db`. That id is the join key across all three.

## Known gaps

- Magic-item variants (`+1 dagger` = a `magicvariant` applied to a `baseitem`)
  are not expanded, so ~600 item links render as plain text.
- `_mod` modes `replaceSpells` / `addSpells` / `addSkills` are unimplemented
  (~25 records), as are monster `_templates` (187).
- Note layout is generic across all 84 kinds: entry-like fields render as prose,
  everything else lands in a `## Data` JSON block. No per-kind statblocks.
"""

USAGE = """`entity(id, kind, name, source, page, file, markdown, json)` -- `id` is also the
vault path minus `.md`. `link(src_id, tag, target_name, target_source, dst_id)`
is the cross-reference graph; `dst_id IS NULL` means the target isn't an entity
(book quickrefs, magic-item variants). `entity_fts` is FTS5 over name + body.

```sql
-- typed fields live in the JSON column
SELECT name, source FROM entity
WHERE kind='spell' AND json_extract(json,'$.level')=3 AND json_extract(json,'$.school')='V';

SELECT name, json_extract(json,'$.cr') cr FROM entity
WHERE kind='monster' AND cr IN ('1/4','1/2') ORDER BY name;

-- full text, best matches first
SELECT id FROM entity_fts WHERE entity_fts MATCH 'necrotic NEAR undead' ORDER BY rank LIMIT 20;

-- what references this monster?
SELECT DISTINCT src_id FROM link WHERE dst_id='monster/MM/goblin';

-- most-referenced entities
SELECT dst_id, count(*) c FROM link WHERE dst_id NOTNULL GROUP BY 1 ORDER BY c DESC LIMIT 20;
```
"""


def render_entity(e, r):
	"""(frontmatter dict, markdown body) for one entity."""
	data = e["data"]
	fm = {"id": e["id"], "kind": e["prop"], "name": e["name"], "source": e["source"],
	      "tags": [f"kind/{slugify(e['prop'])}", f"source/{slugify(e['source'])}"]}
	body, extra = [], {}

	for k, v in data.items():
		if k in ("name", "source"):
			continue
		if isinstance(v, (str, int, float, bool)) and k not in ENTRY_KEYS:
			fm[k] = r.text(v) if isinstance(v, str) else v
		elif k in ENTRY_KEYS and isinstance(v, (list, dict, str)):
			title = re.sub(r"(?<!^)([A-Z])", r" \1", k).title()
			body.append(f"## {title}\n\n{r.entries(v, 3)}\n")
		else:
			extra[k] = v

	if extra:
		body.append("## Data\n\n```json\n"
		            + json.dumps(extra, indent=2, ensure_ascii=False) + "\n```\n")
	# ponytail: generic layout for all 90+ kinds. Per-kind statblocks (monsters,
	# items) would mean a renderer each -- add one only for kinds you actually read.
	return fm, "\n".join(body).strip()


def write_sqlite(path, ents, rendered, links):
	if path.exists():
		path.unlink()
	db = sqlite3.connect(path)
	db.executescript("""
		PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
		CREATE TABLE entity (
			id TEXT PRIMARY KEY, kind TEXT, name TEXT, source TEXT,
			page INTEGER, file TEXT, markdown TEXT, json TEXT);
		CREATE INDEX ix_entity_kind ON entity(kind);
		CREATE INDEX ix_entity_name ON entity(name COLLATE NOCASE);
		CREATE INDEX ix_entity_source ON entity(source);
		CREATE TABLE link (
			src_id TEXT, tag TEXT, target_name TEXT, target_source TEXT, dst_id TEXT);
		CREATE INDEX ix_link_src ON link(src_id);
		CREATE INDEX ix_link_dst ON link(dst_id);
		CREATE VIRTUAL TABLE entity_fts USING fts5(id UNINDEXED, name, body);
	""")
	rows = []
	for e in ents:
		fm, body = rendered[e["id"]]
		page = e["data"].get("page")
		rows.append((e["id"], e["prop"], e["name"], e["source"],
		             page if isinstance(page, int) else None, e["file"], body,
		             json.dumps(e["data"], ensure_ascii=False)))
	db.executemany("INSERT INTO entity VALUES (?,?,?,?,?,?,?,?)", rows)
	db.executemany("INSERT INTO entity_fts VALUES (?,?,?)",
	               [(r[0], r[2], r[6]) for r in rows])
	db.executemany("INSERT INTO link VALUES (?,?,?,?,?)", links)
	db.commit()
	db.execute("VACUUM")
	db.close()
	print(f"wrote {path} ({path.stat().st_size / 1e6:.0f} MB)")


def _fm_dump(fm):
	lines = ["---"]
	for k, v in fm.items():
		if isinstance(v, list):  # Obsidian tag list
			v = "[" + ", ".join(str(x) for x in v) + "]"
		elif isinstance(v, bool):
			v = "true" if v else "false"
		elif isinstance(v, str):
			v = json.dumps(v, ensure_ascii=False)
		lines.append(f"{k}: {v}")
	lines.append("---\n")
	return "\n".join(lines)


def write_vault(vault, ents, rendered):
	by_kind = defaultdict(list)
	for e in ents:
		by_kind[e["prop"]].append(e)

	for e in ents:
		fm, body = rendered[e["id"]]
		p = vault / e["path"]
		p.parent.mkdir(parents=True, exist_ok=True)
		p.write_text(f"{_fm_dump(fm)}# {e['name']}\n\n{body}\n", encoding="utf8")

	# One map-of-content note per kind, grouped by source book.
	for kind, group in by_kind.items():
		by_source = defaultdict(list)
		for e in group:
			by_source[e["source"]].append(e)
		lines = [_fm_dump({"kind": "index", "of": kind, "tags": ["moc", f"kind/{slugify(kind)}"]}),
		         f"# {kind} ({len(group)})\n",
		         "[All kinds](../README.md)\n"]
		for source in sorted(by_source):
			lines.append(f"## {source} ({len(by_source[source])})\n")
			lines.append("| Name | Page |")
			lines.append("|---|---|")
			for e in sorted(by_source[source], key=lambda x: x["name"].lower()):
				rel = os.path.relpath(vault / e["path"], vault / kind).replace("\\", "/")
				lines.append(f"| [{e['name']}]({rel}) | {e['data'].get('page', '')} |")
			lines.append("")
		(vault / kind / "README.md").write_text("\n".join(lines) + "\n", encoding="utf8")

	index = ["| Kind | Notes |", "|---|---|"]
	for kind in sorted(by_kind, key=lambda k: -len(by_kind[k])):
		index.append(f"| [{kind}]({kind}/README.md) | {len(by_kind[kind])} |")
	index.append(f"\n**{len(ents)} notes across {len(by_kind)} kinds.**")
	(vault / "README.md").write_text(
		VAULT_README.format(index="\n".join(index)), encoding="utf8")
	print(f"wrote {len(ents)} notes + {len(by_kind) + 1} indexes to {vault}")


# --- self-check --------------------------------------------------------------

def selfcheck():
	r = Renderer({"spell": "PHB", "creature": "MM"},
	             by_tag={("spell", "fireball", "phb"): {"id": "spell/PHB/fireball",
	                                                    "path": "spell/PHB/fireball.md"}},
	             self_path="monster/MM/goblin.md", links=[])

	assert r.text("cast {@spell fireball}") == "cast [fireball](../../spell/PHB/fireball.md)"
	assert r.text("{@spell fireball|PHB|a fireball}") == "[a fireball](../../spell/PHB/fireball.md)"
	assert r.text("{@spell fireball|XPHB}") == "fireball", "unknown source -> plain text"
	assert r.text("{@creature goblin}") == "goblin", "unresolved -> plain text"
	assert r.text("{@b bold {@i deep}}") == "**bold *deep***", "nested tags"
	assert r.text("{@damage 2d6}") == "2d6" and r.text("{@dc 15}") == "DC 15"
	assert r.text("{@hit 5}") == "+5" and r.text("{@hit -1}") == "-1"
	assert r.links[0] == ("spell", "fireball", "PHB", "spell/PHB/fireball"), r.links[0]

	assert attack_tag_to_full("mw") == "Melee Weapon Attack:"
	assert attack_tag_to_full("mw,rw") == "Melee or Ranged Weapon Attack:"
	assert attack_tag_to_full("rs", True) == "Ranged Spell Attack Roll:"
	assert r.text("{@atk mw} {@hit 4} to hit") == "*Melee Weapon Attack:* +4 to hit"

	assert split_pipe("a|b{@x c|d}|e") == ["a", "b{@x c|d}", "e"]
	assert slugify("Bag of Holding (+1)") == "bag-of-holding-1"

	# _mod ops
	t = {"entries": ["a", "b"]}
	_mod_apply(t, "entries", {"mode": "prependArr", "items": "z"})
	assert t["entries"] == ["z", "a", "b"]
	_mod_apply(t, "entries", {"mode": "appendArr", "items": ["y"]})
	assert t["entries"] == ["z", "a", "b", "y"]
	_mod_apply(t, "entries", {"mode": "insertArr", "index": 1, "items": ["q"]})
	assert t["entries"] == ["z", "q", "a", "b", "y"]
	t2 = {"trait": [{"name": "Keen", "entries": ["x"]}, {"name": "Pack"}]}
	_mod_apply(t2, "trait", {"mode": "removeArr", "names": "Pack"})
	assert [x["name"] for x in t2["trait"]] == ["Keen"]
	_mod_apply(t2, "trait", {"mode": "replaceArr", "replace": "Keen",
	                         "items": {"name": "Blind"}})
	assert [x["name"] for x in t2["trait"]] == ["Blind"]
	t3 = {"entries": ["the goblin flees"], "type": "x"}
	_mod_apply(t3, "entries", {"mode": "replaceTxt", "replace": "goblin", "with": "orc"})
	assert t3["entries"] == ["the orc flees"]
	t4 = {}
	_mod_apply(t4, "hp", {"mode": "setProp", "prop": "hp.average", "value": 10})
	assert t4["hp"]["average"] == 10

	# table + list rendering
	tbl = r.entries({"type": "table", "colLabels": ["d6", "Result"],
	                 "rows": [[1, "nothing"]]})
	assert "| d6 | Result |" in tbl and "| 1 | nothing |" in tbl
	lst = r.entries({"type": "list", "items": [{"name": "One", "entries": ["first"]}]})
	assert lst.startswith("- **One** first")

	# a tag in an image caption must not nest brackets inside the alt text
	img = r.entries({"type": "image", "title": "The {@spell fireball}",
	                 "href": {"url": "http://x/y.png"}})
	assert img == "![The fireball](http://x/y.png)", img

	# the vendored 5etools JS is committed, so this always runs
	if JS_DIR.is_dir():
		ts = load_tag_default_sources()
		assert ts.get("spell") == "PHB" and ts.get("creature") == "MM", ts.get("spell")
		assert ts.get("item") == "DMG" and ts.get("variantrule") == "DMG"
		assert len(ts) >= 40, f"only {len(ts)} tags -- vendored render.js may have changed"

	# class/subclass tags put the source at a later pipe index
	r2 = Renderer({"classFeature": "PHB"},
	              by_tag={("classFeature", "rage", "phb"): {"id": "cf", "path": "x/rage.md"}},
	              self_path="x/other.md")
	assert r2.text("{@classFeature Rage|Barbarian||1}") == "[Rage](rage.md)"

	print("selfcheck OK")


if __name__ == "__main__":
	ap = argparse.ArgumentParser(description=__doc__,
	                             formatter_class=argparse.RawDescriptionHelpFormatter)
	ap.add_argument("--only", choices=["db", "vault"], help="skip the other output")
	ap.add_argument("--selfcheck", action="store_true", help="run assertions, write nothing")
	a = ap.parse_args()
	if a.selfcheck:
		selfcheck()
	else:
		build(a.only != "vault", a.only != "db")
