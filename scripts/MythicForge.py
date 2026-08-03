import os,requests,tempfile,shutil
import hmac
import json,time,sqlite3,sys
from flask import Flask, jsonify, request, g
from pathlib import Path
from typing import List, Dict
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import migrate
import forge_tools

####################################################################################
############################# CHECK ENVIRONMENT VARIABLES ##########################
####################################################################################

# Load .env from parent directory
env_path = Path(__file__).parent.parent / '.env'

# Create .env file if it doesn't exist
if not env_path.exists():
    with open(env_path, 'w') as f:
        f.write('AI_PROVIDER=none\n')

load_dotenv(env_path)

# Get environment variables with validation
DEBUG_MODE = os.getenv('DEBUG_MODE', 'false').lower() == 'true'
AI_PROVIDER = os.getenv('AI_PROVIDER', 'none')  # Set default to 'none'
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Validate required environment variables
if AI_PROVIDER not in ['openai', 'gemini', 'local', 'none']:
    raise ValueError("AI_PROVIDER must be 'openai', 'gemini', or 'local'")

# Set provider to 'none' if API key is missing
if AI_PROVIDER == 'openai' and not OPENAI_API_KEY:
    AI_PROVIDER = 'none'

if AI_PROVIDER == 'gemini' and not GEMINI_API_KEY:
    AI_PROVIDER = 'none'

# Shared secret for the internal hop from the Node server, which generates it at
# boot and passes it in the environment. Authentication happens in Express; this
# process only needs to know the call really came from it, and who it is for.
INTERNAL_SECRET = os.getenv('MYTHICFORGE_INTERNAL_SECRET')
if not INTERNAL_SECRET:
    print("MYTHICFORGE_INTERNAL_SECRET is not set. Start this via `npm start`, "
          "which generates one; running it directly leaves it unable to serve "
          "any request.", file=sys.stderr)

####################################################################################
############################# MYTHIC FORGE CLASS ###################################
####################################################################################

class MythicForge:
    def __init__(self, app):
        self.app = app
        self.db_path = str(migrate.FORGE_DB)

        # scripts/migrate.py owns the schema; it is idempotent and safe to call.
        migrate.ensure_db(self.db_path)

    def get_db(self):
        if 'main_db' not in g:
            g.main_db = sqlite3.connect(self.db_path)
            g.main_db.row_factory = sqlite3.Row
            # Node holds the same file open, so wait rather than failing outright.
            g.main_db.execute('PRAGMA busy_timeout = 5000')
            g.main_db.execute('PRAGMA foreign_keys = ON')
        return g.main_db


    def close_db(self, e=None):
        main_db = g.pop('main_db', None)
        if main_db is not None:
            main_db.close()

app = Flask(__name__)
mythicforge = MythicForge(app)

# Register close_db function to run after each request
app.teardown_appcontext(mythicforge.close_db)

@app.route('/data', methods=['GET'])
def get_data():
    user_id, error = guard(request)
    if error:
        return error

    # Get query parameters
    data_type = request.args.get('type')
    query = request.args.get('q')

    db = mythicforge.get_db()
    cursor = db.cursor()

    # Every query is scoped to the caller. Without the user_id predicate these
    # endpoints return every user's rows.
    if data_type == 'characters':
        cursor.execute('SELECT character_id, name, gender, race, class, level, avatar '
                       'FROM characters WHERE user_id = ?', (user_id,))
    elif data_type == 'character':
        cursor.execute('SELECT * FROM characters WHERE character_id = ? AND user_id = ?',
                       (query, user_id))
    elif data_type == 'campaigns':
        cursor.execute('SELECT * FROM campaigns WHERE user_id = ?', (user_id,))
    else:
        return jsonify({"error": f"Unknown data type '{data_type}'"}), 400

    rows = cursor.fetchall()
    return jsonify([dict(row) for row in rows])

def aiAllowed(user_id):
    """Whether this account may spend the shared API key.

    Express checks this too. It is repeated here because the flag guards real
    spending, and this process should not depend on a caller having been careful.
    """
    row = mythicforge.get_db().execute(
        'SELECT allow_ai_use FROM users WHERE user_id = ?', (user_id,)).fetchone()
    return bool(row and row['allow_ai_use'])


@app.route('/story', methods=['POST'])
def create_story():

    user_id, error = guard(request)
    if error:
        return error
    if not aiAllowed(user_id):
        return jsonify({"error": "AI features are not enabled for this account"}), 403

    StringProperty = ""
    #get post json data of a monster, use Google gemini AI to create a story and return it
    if AI_PROVIDER == 'gemini':
        payload = {
            "system_instruction": {
            "parts":
            {
                "text": "You are a story teller and you are telling a DND fantasy story about a monster. You will receive json data about the monster, use it to tell a interesting short summarized back story about it. Give it a name, a plot, a setting, and a conflict as needed. Use proper HTML formatting. The story should be around 100-200 words. Use \"<div class='property-line'><h4>Heading</h4><p></p></div>\" to format any properties, <div class='sections'><h3>section name</h3><div class='property-block'><h4>Property name </h4><p></p></div></div> for sections and properties. No ``` or code blocks are needed and no css style tags."}},
                "contents": [
                {
                    "parts": [
                        {
                            "text": json.dumps(request.json).replace('\n', '')
                        }
                    ]
                }
            ]
        }
        response = geminiPostRequest(payload)

        for candidate in response.json()["candidates"]:
            candidate_content = candidate["content"]
            text_parts = " ".join(part["text"] for part in candidate_content["parts"])
            StringProperty += f"{text_parts}"

    elif AI_PROVIDER == 'openai':
        payload = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "user",
                    "content": f"You are a story teller and you are telling a DND fantasy story about a monster. You will receive json data about the monster, use it to tell a interesting short summarized back story about it. Give it a name, a plot, a setting, and a conflict as needed. Use proper HTML formatting. The story should be around 100-200 words. Use \"<div class='property-line'><h4>Heading</h4><p></p></div>\" to format any properties, <div class='sections'><h3>section name</h3><div class='property-block'><h4>Property name </h4><p></p></div></div> for sections and properties. No ``` or code blocks are needed and no css style tags: {json.dumps(request.json)}"
                }
            ],
            "temperature": 1,
            "top_p": 1,
            "n": 1,
            "stream": False,
            "max_tokens": 500,
            "presence_penalty": 0,
            "frequency_penalty": 0
        }
        response = openaiPostRequest(payload)
        StringProperty = response.json()["choices"][0]["message"]["content"]
    else:
        return jsonify({"error": "Invalid AI provider configuration"})

    return jsonify({"story": StringProperty})

@app.route('/prop', methods=['POST'])
def explain_prop():

    user_id, error = guard(request)
    if error:
        return error
    if not aiAllowed(user_id):
        return jsonify({"error": "AI features are not enabled for this account"}), 403

    ThePrompt ="Better explain a DND property on the specific topic, maybe also include an example/ or where/when this might take place. Response in html format but no ``` or code blocks are needed and no css style tags. dont repeat the item details from the prompt any dice notation should be wrapped like {@dice 1d20} as an example following roll20 notation format."
    TheItem = json.dumps(request.json).replace('\n', '')

    #get post json data of a property nad explain it better
    StringProperty = ""
    if AI_PROVIDER == 'gemini':
        payload = {
            "system_instruction": {
            "parts":
            {
                "text": f"{ThePrompt}"}},
                "contents": [
                {
                    "parts": [
                        {
                            "text": TheItem
                        }
                    ]
                }
            ]
        }
        response = geminiPostRequest(payload)
        for candidate in response.json()["candidates"]:
            candidate_content = candidate["content"]
            text_parts = " ".join(part["text"] for part in candidate_content["parts"])
            StringProperty += f"{text_parts}"
    elif AI_PROVIDER == 'openai':
        payload = {
            "model": "gpt-3.5-turbo",
            "messages": [
                {
                    "role": "user",
                    "content": f"{ThePrompt}: {TheItem}"
                }
            ],
            "temperature": 1,
            "top_p": 1,
            "n": 1,
            "stream": False,
            "max_tokens": 500,
            "presence_penalty": 0,
            "frequency_penalty": 0
        }
        response = openaiPostRequest(payload)
        StringProperty = response.json()["choices"][0]["message"]["content"]
    else:
        return jsonify({"error": "Invalid AI provider configuration"})


    return jsonify({"prop": StringProperty})

@app.route('/settings', methods=['GET'])
def get_settings():
    user_id, error = guard(request)
    if error:
        return error
    row = mythicforge.get_db().execute(
        'SELECT * FROM users_settings WHERE user_id = ?', (user_id,)).fetchone()
    return jsonify(dict(row) if row else {})


@app.route('/api/tools', methods=['GET'])
def list_tools():
    """Describe every callable tool, so the UI does not hard-code the list."""
    user_id, error = guard(request)
    if error:
        return error
    return jsonify([
        {
            "name": name,
            "scope": "user" if takes_user else "public",
            "description": (fn.__doc__ or "").strip(),
            "arguments": forge_tools.describe_arguments(fn, skip_user_id=takes_user),
        }
        for name, (fn, takes_user) in sorted(forge_tools.TOOLS.items())
    ])


@app.route('/api/tool/<name>', methods=['POST'])
def call_tool(name):
    """Invoke one tool by name with a JSON object of arguments.

    One dispatch route rather than 21 hand-written ones: the registry in
    forge_tools is the allowlist, so a tool added there is reachable here with
    no change to this file, and nothing outside it is reachable at all.

    `user_id` comes from the authenticated session that Express verified. It is
    never read from the body, so a caller cannot act as another account.
    """
    user_id, error = guard(request)
    if error:
        return error
    arguments = request.get_json(silent=True)
    if arguments is None:
        arguments = {}
    try:
        return jsonify({"result": forge_tools.call(name, user_id, arguments)})
    except forge_tools.ToolError as e:
        return jsonify({"error": str(e)}), e.status

def geminiPostRequest(payload):
    if not GEMINI_API_KEY:
        return jsonify({"error": "GEMINI_API_KEY is not set"})
    #do a post request to the gemini AI
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"
    params = {
        "key" : GEMINI_API_KEY
    }
    headers = {
        "Content-Type": "application/json"
    }
    response = requests.post(url, params=params, headers=headers, json=payload)
    return response

def openaiPostRequest(payload):
    if not OPENAI_API_KEY:
        return jsonify({"error": "OPENAI_API_KEY is not set"})
    #do a post request to the openai API
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }
    response = requests.post(url, headers=headers, json=payload)
    return response

def verifyRequest(request):
    """True when the call carries the internal secret Node was started with.

    Replaces a User-Agent check, which any client could set. Compared with
    hmac.compare_digest so a wrong secret cannot be found a byte at a time.
    """
    if not INTERNAL_SECRET:
        return False
    supplied = request.headers.get('X-Forge-Secret', '')
    return hmac.compare_digest(supplied, INTERNAL_SECRET)


def currentUserId(request):
    """The user Express authenticated, or None if the header is missing or junk."""
    raw = request.headers.get('X-Forge-User', '')
    try:
        user_id = int(raw)
    except (TypeError, ValueError):
        return None
    return user_id if user_id > 0 else None


def guard(request):
    """(user_id, None) when the request may proceed, else (None, error response)."""
    if not verifyRequest(request):
        return None, (jsonify({"error": "Forbidden"}), 403)
    user_id = currentUserId(request)
    if user_id is None:
        return None, (jsonify({"error": "Missing user context"}), 400)
    return user_id, None

if __name__ == '__main__':
    # server.js passes --port; honour it rather than assuming 4000.
    port = 4000
    if '--port' in sys.argv:
        port = int(sys.argv[sys.argv.index('--port') + 1])

    # Loopback only: this process trusts whoever presents the internal secret and
    # is not meant to be reachable from the network. Express is the public face.
    # The reloader is off even in debug, since it would fork a second process
    # holding the same SQLite file.
    app.run(host='127.0.0.1', port=port, debug=DEBUG_MODE, use_reloader=False)
