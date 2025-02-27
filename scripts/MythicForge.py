import os,requests,tempfile,shutil
import json,time,sqlite3,sys
from flask import Flask, jsonify, request, g
from pathlib import Path
from typing import List, Dict
from dotenv import load_dotenv

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

####################################################################################
############################# MYTHIC FORGE CLASS ###################################
####################################################################################

class MythicForge:
    def __init__(self, app):
        self.app = app
        self.db_path = 'MythicForge.db'

        # Initialize database schema
        with sqlite3.connect(self.db_path) as conn:
            with open('setup.sql', 'r', encoding='utf-8') as f:
                conn.executescript(f.read())

    def get_db(self):
        if 'main_db' not in g:
            g.main_db = sqlite3.connect(self.db_path)
            g.main_db.row_factory = sqlite3.Row
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
    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

    # Get query parameters
    data_type = request.args.get('type')
    query = request.args.get('q')

    db = mythicforge.get_db()
    cursor = db.cursor()

    # Example query - modify according to your database schema
    if data_type == 'characters':
        cursor.execute('SELECT character_id, name, gender, race, class, level, avatar FROM characters')
    elif data_type == 'character':
        cursor.execute('SELECT * FROM characters WHERE character_id = ?', query)
    elif data_type == 'monsters':
        cursor.execute('SELECT * FROM monsters WHERE name LIKE ?', (f'%{query}%',))
    # Add more data types as needed

    rows = cursor.fetchall()
    return jsonify([dict(row) for row in rows])

@app.route('/init', methods=['GET'])
def init():

    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

    #get query from the request
    query = request.args.get('q')
    if query == "download_data":
        mythicforge.download_data_from5etools()
        mythicforge.download_images_from5etools()
    return jsonify({"status": "success"})

@app.route('/story', methods=['POST'])
def create_story():

    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

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

    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

    ThePrompt = "Better explain a DND property on the specific topic, maybe also include an example/ or where/when this might take place. Response in html format but no ``` or code blocks are needed and no css style tags. dont repeat the item details from the prompt any dice notation should be wrapped like {@dice 1d20} as an example following roll20 notation format."
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

@app.route('/execute', methods=['POST'])
def execute_command():

    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

    db = mythicforge.get_db()
    cursor = db.cursor()

    data = request.json
    cursor.execute('INSERT INTO example_table (name, description) VALUES (?, ?)',
                  (data['name'], data['description']))
    db.commit()

    return jsonify({"status": "success"})

    if verifyRequest(request) == False:
        return jsonify({"error": "Invalid request"})

    db = mythicforge.get_db()
    cursor = db.cursor()

    uuid = request.args.get('userId')
    cursor.execute('SELECT * FROM users_settings WHERE user_id = ?', (uuid))
    rows = cursor.fetchall()

    return jsonify({"usersettings": [dict(row) for row in rows]})

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
    verified = True
    #verify if user agent starts with axios/
    if request.headers.get('User-Agent').startswith('axios/') == False:
        verified = False

    return verified

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=4000, debug=True)
