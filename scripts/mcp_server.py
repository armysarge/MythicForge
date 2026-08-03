#!/usr/bin/env python3
"""MCP transport for the MythicForge tools.

    python scripts/mcp_server.py              # stdio, for a local MCP client
    python scripts/mcp_server.py --selfcheck  # verify every tool registers

Every tool body lives in scripts/forge_tools.py; this file only exposes them
over MCP. Adding a tool to forge_tools.TOOLS makes it appear here with no change
to this file.

Reference tools read 5etools.db, which is opened read-only. Campaign tools read
and write MythicForge.db, always scoped to one user, and there is no
arbitrary-SQL tool -- a model cannot invent a statement that empties a campaign.
"""

import argparse
import functools
import inspect
import os
import sys
from pathlib import Path

from mcp.server import MCPServer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import forge_tools

# A stdio MCP server has no session, so it acts as one fixed account -- fine for
# running it yourself against your own machine. Now that the web app is
# multi-user, sharing this with players needs the HTTP transport and real auth;
# see "MCP client auth" in PLAN.md.
USER_ID = int(os.getenv("MYTHICFORGE_USER_ID", "1"))

server = MCPServer(
	name="mythicforge",
	version="0.2.0",
	instructions=(
		"D&D 5e campaign tools. `search_5e` and `get_5e_entity` read the 5e "
		"reference (spells, monsters, items, rules). The campaign tools read and "
		"write the user's own characters, inventory and encounters. Entity ids "
		"look like 'monster/MM/goblin' and are shared between both databases."
	),
)


def _register(fn, takes_user_id):
	"""Expose a forge_tools function as an MCP tool.

	Campaign functions take user_id first, but an MCP client must not choose who
	it acts as, so that parameter is bound to this process's USER_ID and removed
	from the advertised schema. Overriding __signature__ and __annotations__ is
	what keeps the generated schema honest about the remaining arguments.
	"""
	if not takes_user_id:
		return server.tool()(fn)

	signature = inspect.signature(fn)
	visible = [p for name, p in signature.parameters.items() if name != "user_id"]

	@functools.wraps(fn)
	def wrapper(*args, **kwargs):
		return fn(USER_ID, *args, **kwargs)

	wrapper.__signature__ = signature.replace(parameters=visible)
	wrapper.__annotations__ = {k: v for k, v in fn.__annotations__.items()
	                           if k != "user_id"}
	return server.tool()(wrapper)


for _fn, _takes_user in forge_tools.TOOLS.values():
	_register(_fn, _takes_user)


def selfcheck():
	"""Confirm every registered tool is advertised, and that user_id never is."""
	import asyncio

	async def check():
		tools = await server.list_tools()
		names = {t.name for t in tools}
		assert names == set(forge_tools.TOOLS), (
			f"registry and MCP disagree: {names ^ set(forge_tools.TOOLS)}")

		for tool in tools:
			properties = (tool.input_schema or {}).get("properties", {})
			assert "user_id" not in properties, (
				f"{tool.name} exposes user_id; a client could act as another account")
			assert tool.description, f"{tool.name} has no description"

		# a campaign tool keeps its own arguments after user_id is bound away
		schema = next(t for t in tools if t.name == "get_character").input_schema
		assert "character_id" in schema["properties"], schema
		assert schema["required"] == ["character_id"], schema

		# and a reference tool is untouched
		schema = next(t for t in tools if t.name == "search_5e").input_schema
		assert set(schema["properties"]) == {"query", "kind", "limit"}, schema

		print(f"selfcheck OK ({len(tools)} tools registered)")

	asyncio.run(check())


if __name__ == "__main__":
	ap = argparse.ArgumentParser()
	ap.add_argument("--selfcheck", action="store_true")
	a = ap.parse_args()
	if a.selfcheck:
		selfcheck()
	else:
		server.run("stdio")
