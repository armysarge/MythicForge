from flask import Flask, jsonify, request, g
import sqlite3,os

app = Flask(__name__)
DATABASE = 'MythicForge.db'

# Function to get database connection
def get_db():
    conn = sqlite3.connect(DATABASE)
    return conn

# Run SQL commands from the setup file
def init_db():
    with app.app_context():
        db = get_db()
        with open('setup.sql', 'r') as f:
            db.executescript(f.read)
        db.commit()

# Endpoint to get data from the database
@app.route('/data', methods=['GET'])
def get_data():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM campaigns')
    rows = cursor.fetchall()
    conn.close()

    # Return data as JSON
    return jsonify(rows)

# Endpoint to execute a function (e.g., insert data)
@app.route('/execute', methods=['POST'])
def execute_command():
    data = request.json
    conn = get_db()
    cursor = conn.cursor()

    # Example: Insert data into the database
    cursor.execute('INSERT INTO example_table (name, description) VALUES (?, ?)', (data['name'], data['description']))
    conn.commit()
    conn.close()

    return jsonify({"status": "success", "message": "Data inserted successfully"})

# Close the database connection when the app context ends
@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

if __name__ == '__main__':
    ''' Initialize the database if it does not exist '''
    if not os.path.exists(DATABASE):
        init_db()

    app.run(debug=True)
