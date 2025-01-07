import os,requests,tempfile,shutil
import json,time,sqlite3,sys
from flask import Flask, jsonify, request, g
from pathlib import Path
from typing import List, Dict
class MythicForge:
    def __init__(self, app):
        self.app = app
        self.db_path = 'MythicForge.db'

        # Initialize database schema
        #with sqlite3.connect(self.db_path) as conn:
        #    with open('setup.sql', 'r', encoding='utf-8') as f:
        #        conn.executescript(f.read())

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

    #do a post request to the gemini AI
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"
    params = {
        "key" : ""
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
    app.run(debug=True)
