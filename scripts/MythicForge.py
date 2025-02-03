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

if AI_PROVIDER == 'openai' and not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY is required when AI_PROVIDER is 'openai'")

if AI_PROVIDER == 'gemini' and not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is required when AI_PROVIDER is 'gemini'")

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

@app.route('/')
def index():
    #redirect to the localhost:3000
    new_url = "http://localhost:3000"
    return redirect(new_url)

@app.route('/init', methods=['GET'])
def init():
    #get query from the request
    query = request.args.get('q')
    if query == "download_data":
        mythicforge.download_data_from5etools()
        mythicforge.download_images_from5etools()
    return jsonify({"status": "success"})

@app.route('/story', methods=['POST'])
def create_story():
    #get post json data of a monster, use Google gemini AI to create a story and return it
    if AI_PROVIDER == 'gemini':
        #do a post request to the gemini AI
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"
        params = {
            "key" : GEMINI_API_KEY
        }
        headers = {
            "Content-Type": "application/json"
        }

        payload = {
            "system_instruction": {
            "parts":
            {
                "text": "You are a story teller and you are telling a fantasy story about a monster backstory. You will receive json data about the monster, use it to tell a interesting short summarized back story about it with a name."}},
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
    elif AI_PROVIDER == 'openai':
        # Add OpenAI implementation here
        pass
    else:
        return jsonify({"error": "Invalid AI provider configuration"})

    response = requests.post(url, params=params, headers=headers, json=payload)
    print(response.json())
    return response.json()

@app.route('/execute', methods=['POST'])
def execute_command():
    db = mythicforge.get_db()
    cursor = db.cursor()

    data = request.json
    cursor.execute('INSERT INTO example_table (name, description) VALUES (?, ?)',
                  (data['name'], data['description']))
    db.commit()

    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=4000, debug=True)
