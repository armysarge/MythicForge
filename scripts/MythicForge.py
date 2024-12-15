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

@app.route('/data', methods=['GET'])
def get_data():
    results = ""
    if request.args.get('type') == 'monsters':
        search_term = request.args.get('q')
        if search_term:
            if search_term != "":
                results = mythicforge.lookup_monsters(search_term)

    if request.args.get('type') == 'monster':
        monster_id = request.args.get('q')
        if monster_id:
            if monster_id != "":
                results = mythicforge.monster_details(monster_id)

    return results

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
    #mythicforge.download_data_from5etools()
    app.run(debug=True)