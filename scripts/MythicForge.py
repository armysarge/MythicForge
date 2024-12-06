import os,requests,tempfile,shutil
import json,time,sqlite3,sys
from flask import Flask, jsonify, request, g
from pathlib import Path
from typing import List, Dict
class MythicForge:
    def __init__(self, app):
        self.app = app
        self.db_path = 'MythicForge.db'
        self.bestiary_db_path = 'data/bestiary.db'

        # Initialize database schema
        #with sqlite3.connect(self.db_path) as conn:
        #    with open('setup.sql', 'r', encoding='utf-8') as f:
        #        conn.executescript(f.read())

    def get_db(self):
        if 'main_db' not in g:
            g.main_db = sqlite3.connect(self.db_path)
            g.main_db.row_factory = sqlite3.Row
        return g.main_db

    def get_bestiary_db(self):
        if 'bestiary_db' not in g:
            g.bestiary_db = sqlite3.connect(self.bestiary_db_path)
            g.bestiary_db.row_factory = sqlite3.Row
        return g.bestiary_db

    def close_db(self, e=None):
        main_db = g.pop('main_db', None)
        if main_db is not None:
            main_db.close()

        bestiary_db = g.pop('bestiary_db', None)
        if bestiary_db is not None:
            bestiary_db.close()

    def get_directory_contents(self, path: str = "",repo_owner: str = "", repo_name: str = "") -> List[Dict]:
        """Get contents of a directory from GitHub API"""
        url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/contents/data/{path}"
        response = requests.get(url, headers={"Accept": "application/vnd.github.v3+json"})
        response.raise_for_status()
        return response.json()

    def download_file(self, file_path: str, output_dir: Path, repo_owner: str = "", repo_name: str = "") -> None:
        """Download a single file"""
        url = f"https://raw.githubusercontent.com/{repo_owner}/{repo_name}/master/data/{file_path}"
        out_path = output_dir / file_path
        out_path.parent.mkdir(parents=True, exist_ok=True)

        for attempt in range(3):  # Retry up to 3 times
            try:
                response = requests.get(url)
                response.raise_for_status()
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(response.json(), f, indent=2)
                print(f"Downloaded: {file_path}")
                return
            except Exception as e:
                if attempt == 2:  # Last attempt
                    print(f"Failed to download {file_path}: {str(e)}")
                time.sleep(1)  # Wait before retry

    def download_data_from5etools(self, output_dir: str = "data") -> None:
        """
        Download all JSON files from the data directory, excluding adventure and book folders
        Args:
            output_dir (str): Directory to save the downloaded files
        """
        output_path = Path(tempfile.gettempdir()) / "mythicforge_temp"
        output_path.mkdir(parents=True, exist_ok=True)
        exclude_folders = ['adventure', 'book']

        def process_directory(path: str = "") -> None:
            try:
                contents = self.get_directory_contents(path, "5etools-mirror-3", "5etools-src")
                for item in contents:
                    # Skip excluded folders
                    if item["type"] == "dir" and item["name"].lower() in exclude_folders:
                        print(f"Skipping excluded folder: {item['name']}")
                        continue

                    if item["type"] == "file" and item["name"].endswith(".json"):
                        rel_path = f"{path}/{item['name']}" if path else item["name"]
                        temp_path = output_path / rel_path
                        self.download_file(rel_path, output_path, "5etools-mirror-3", "5etools-src")
                    elif item["type"] == "dir":
                        new_path = f"{path}/{item['name']}" if path else item["name"]
                        process_directory(new_path)
            except Exception as e:
                print(f"Error processing directory {path}: {str(e)}")

        def create_bestiary_db(output_path):

            def insert_monster(cursor, monster):

                srd_value = 1 if monster.get('srd', False) else 0
                #if srd_value == 0:
                #    return None
                def extract_sizes(size_data):
                    sizes = None
                    """Extract size and type from monster size field"""
                    def sizeLabel(size):
                        return {
                            'T': 'Tiny',
                            'S': 'Small',
                            'M': 'Medium',
                            'L': 'Large',
                            'H': 'Huge',
                            'G': 'Gargantuan',
                        }.get(size, '')
                    if isinstance(size_data, list):
                        for size in size_data:
                            sizelabel = sizeLabel(size)
                            if sizelabel != '':
                                sizes = sizes + ' / ' + sizelabel if sizes else sizelabel
                    else:
                        sizes = sizeLabel(size_data)

                    return str(sizes).strip()

                def extract_alignment(alignment):
                    primary_alignment = None
                    def alignmentLabel(alignment):
                        if isinstance(alignment, dict):
                            if alignment.get('special', ''):
                                return alignment.get('special', '')
                            if alignment.get('alignment', ''):
                                alignment = alignment.get('alignment', '')
                        return {
                            'L': 'Lawful',
                            'N': 'Neutral',
                            'C': 'Chaotic',
                            'G': 'Good',
                            'E': 'Evil',
                            'U': 'Unaligned',
                            'NX': 'Any Neutral',
                            'A': 'Any',
                        }.get(alignment, '')

                    """Extract primary alignment from monster alignment field"""
                    if isinstance(alignment, list):
                        if str(alignment) == "['NX', 'NY', 'N']":
                            primary_alignment = 'Any Neutral'
                            ['NX', 'C', 'G', 'NY', 'E']
                        elif str(alignment) == "['NX', 'C', 'G', 'NY', 'E']":
                            primary_alignment = 'Any Non-Lawful'
                        elif str(alignment) == "['L', 'NX', 'C', 'NY', 'E']":
                            primary_alignment = 'Any Non-Good'
                        elif str(alignment) == "['C', 'G', 'NY', 'E']":
                            primary_alignment = 'Any Chaotic'
                        elif str(alignment) == "['L', 'NX', 'NY', 'N']":
                            primary_alignment = 'Any Non-Evil'
                        elif str(alignment) == "['L', 'NX', 'C', 'G']":
                            primary_alignment = 'Any Good'
                        elif str(alignment) == "['L', 'C', 'G', 'NY']":
                            primary_alignment = 'Any Non-Neutral'
                        elif str(alignment) == "['NX', 'NY', 'N']":
                            primary_alignment = 'Any Evil'
                        else:
                            for align in alignment:
                                if isinstance(align, dict):
                                    if align.get('alignment', ''):
                                        if primary_alignment is not None:
                                            primary_alignment = primary_alignment + ' /'
                                        NewAlignment = alignmentLabel(align.get('alignment', '')[0])
                                        if align.get('alignment', '').__len__() > 1:
                                            NewAlignment = NewAlignment + ' ' + alignmentLabel(align.get('alignment', '')[1])
                                        if align.get('chance', ''):
                                            NewAlignment = NewAlignment + ' (' + str(align.get('chance', '')) + '% chance)'
                                        if align.get('note', ''):
                                            NewAlignment = NewAlignment + ' (' + str(align.get('note', '')) + ')'
                                        primary_alignment = primary_alignment + ' ' + NewAlignment if primary_alignment else NewAlignment
                                    elif align.get('special', ''):
                                        primary_alignment = primary_alignment + ' ' + align.get('special', '') if primary_alignment else align.get('special', '')
                                else:
                                    primary_alignment = ''
                                    for align in alignment:
                                        primary_alignment = primary_alignment + ' ' + alignmentLabel(align) if primary_alignment else alignmentLabel(align)

                    return str(primary_alignment).strip() or 'Unaligned'

                def extract_ac_values(ac_data):
                    """Extract primary AC and description from monster AC field"""
                    # Handle empty/none
                    if not ac_data:
                        return None, None

                    # Convert single value to list
                    if not isinstance(ac_data, list):
                        ac_data = [ac_data]

                    # Get primary AC value
                    primary_ac = None
                    ac_desc = []

                    for entry in ac_data:
                        # Integer AC
                        if isinstance(entry, int):
                            if primary_ac is None:
                                primary_ac = entry
                            continue

                        # Dictionary AC
                        if isinstance(entry, dict):
                            ac_value = entry.get('ac')
                            if primary_ac is None:
                                primary_ac = ac_value

                            # Collect descriptions
                            if 'from' in entry:
                                ac_desc.extend(entry['from'])
                            if 'condition' in entry:
                                if 'ac' in entry:
                                    ac_desc.append(str(entry['ac']) + ' ' + entry['condition'])
                                else:
                                    ac_desc.append(entry['condition'])

                    return primary_ac, '; '.join(ac_desc) if ac_desc else None

                # Convert and validate data
                name = monster.get('name', '')
                srd_value = 1 if monster.get('srd', False) else 0
                page = monster.get('page', None) if monster.get('page', None) else None
                source = monster.get('source', '')
                legendaryGroupName = monster.get('legendaryGroup', {}).get('name', '')
                legendaryGroupSource = monster.get('legendaryGroup', {}).get('source', '')
                size = extract_sizes(monster.get('size', 'M'))
                type_val = monster.get('type', '')
                if isinstance(type_val, dict):
                    type_val = str(type_val.get('type', ''))
                alignment = extract_alignment(monster.get('alignment', ''))

                # Handle AC structure
                ac_value, ac_desc = extract_ac_values(monster.get('ac'))

                # Handle HP structure
                hp_avg = None
                hp_formula = None
                if isinstance(monster.get('hp'), dict):
                    hp_avg = monster['hp'].get('average') if monster['hp'].get('average') else None
                    hp_formula = monster['hp'].get('formula') if monster['hp'].get('formula') else None
                    if monster['hp'].get('special') is not None:
                        hp_formula = monster['hp'].get('special')

                # Stats with fallback values
                str_val = monster.get('str', 10)
                dex_val = monster.get('dex', 10)
                con_val = monster.get('con', 10)
                int_val = monster.get('int', 10)
                wis_val = monster.get('wis', 10)
                cha_val = monster.get('cha', 10)
                passive = monster.get('passive', 10)
                cr = str(monster.get('cr', '0'))
                age = monster.get('age', '') if monster.get('age', '') else None
                if age is None:
                    age = monster.get('dragonAge', '') if monster.get('dragonAge', '') else None
                castingColor = monster.get('castingColor', '') if monster.get('castingColor', '') else None
                if castingColor is None:
                    castingColor = monster.get('dragonCastingColor', '') if monster.get('dragonCastingColor', '') else None
                environment = ' / '.join(monster.get('environment', [])) if monster.get('environment', []) else None
                group = ' / '.join(monster.get('group', [])) if monster.get('group', []) else None
                hasFluff = monster.get('hasFluff', 0) == True
                hasFluffImages = monster.get('hasFluffImages', 0) == True
                hasToken = monster.get('hasToken', 0) == True
                soundClipType = monster.get('soundClip', {}).get('type', '') if monster.get('soundClip', {}).get('type', '') else None
                soundClip = monster.get('soundClip', {}).get('path', '') if monster.get('soundClip', {}).get('path', '') else None
                soundClip = soundClip.replace('bestiary/', 'sounds/bestiary/') if soundClip else None
                legendaryGroupName = monster.get('legendaryGroup', {}).get('name', '') if monster.get('legendaryGroup', {}).get('name', '') else None
                legendaryGroupSource = monster.get('legendaryGroup', {}).get('source', '') if monster.get('legendaryGroup', {}).get('source', '') else None
                #print(f"Inserting monster {name}...")
                try:

                    # Insert main monster record
                    cursor.execute('''
                    INSERT INTO monsters (
                        name, srd, source, size, type, page,
                        alignment, ac, ac_desc, hp_average, hp_formula,
                        str, dex, con, int, wis,
                        cha, passive, cr, age, castingColor,
                        environment, monster_group, hasFluff, hasFluffImages, hasToken,
                        soundClipType, soundClip, legendaryGroupName, legendaryGroupSource
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        name,
                        srd_value,
                        source,
                        size,
                        type_val,
                        page,
                        alignment,
                        ac_value,
                        ac_desc,
                        hp_avg,
                        hp_formula,
                        str_val,
                        dex_val,
                        con_val,
                        int_val,
                        wis_val,
                        cha_val,
                        passive,
                        cr,
                        age,
                        castingColor,
                        environment,
                        group,
                        hasFluff,
                        hasFluffImages,
                        hasToken,
                        soundClipType,
                        soundClip,
                        legendaryGroupName,
                        legendaryGroupSource
                    ))

                    monster_id = cursor.lastrowid

                    # Insert speeds
                    for speed_type, value in monster.get('speed', {}).items():
                        #check if value is a int
                        if not isinstance(value, int):
                            if isinstance(value, dict):
                                speed_type = f'{speed_type} {value.get("condition", "")}'
                                value = value.get('number', 0)

                        cursor.execute('''
                        INSERT INTO monster_speeds (monster_id, type, distance)
                        VALUES (?, ?, ?)
                        ''', (monster_id, speed_type, value))

                    # Insert senses
                    if monster.get('senses', []) is not None:
                        for sense in monster.get('senses', []):
                            cursor.execute('INSERT INTO monster_senses VALUES (?, ?)', (monster_id, sense))

                    # Insert saves
                    if monster.get('save', {}) is not None:
                        for save, value in monster.get('save', {}).items():
                            cursor.execute('INSERT INTO monster_saves VALUES (?, ?, ?)', (monster_id, save, value))

                    # Insert spellcasting
                    if monster.get('spellcasting', []) is not None:
                        for casting in monster.get('spellcasting', []):
                            # Insert main spellcasting entry
                            cursor.execute('''
                            INSERT INTO monster_spellcasting
                            (monster_id, name, ability, notes)
                            VALUES (?, ?, ?, ?)
                            ''', (
                                monster_id,
                                casting.get('name'),
                                casting.get('ability'),
                                '\n'.join(casting.get('headerEntries', []))
                            ))

                            spellcasting_id = cursor.lastrowid

                            # Handle at-will spells
                            for spell in casting.get('will', []):
                                hidden  = 0
                                if isinstance(spell, dict):
                                    hidden = spell.get('hidden', 0)
                                    spell = spell.get('entry')
                                cursor.execute('''
                                INSERT INTO monster_spells
                                (spellcasting_id, spell, cast_type, cast_level, hidden)
                                VALUES (?, ?, ?, ?, ?)
                                ''', (spellcasting_id, spell, 'at will', '0', hidden))

                            # Handle daily spells
                            for uses, spells in casting.get('daily', {}).items():
                                for spell in spells:
                                    hidden  = 0
                                    if isinstance(spell, dict):
                                        hidden = spell.get('hidden', 0)
                                        spell = spell.get('entry')
                                    cursor.execute('''
                                    INSERT INTO monster_spells
                                    (spellcasting_id, spell, cast_type, cast_level, hidden)
                                    VALUES (?, ?, ?, ?, ?)
                                    ''', (spellcasting_id, spell, 'daily', uses, hidden))

                            # Handle spells by level
                            for level, level_data in casting.get('spells', {}).items():
                                for spell in level_data.get('spells', []):
                                    hidden  = 0
                                    if isinstance(spell, dict):
                                        hidden = spell.get('hidden', 0)
                                        spell = spell.get('entry')
                                    cursor.execute('''
                                    INSERT INTO monster_spells
                                    (spellcasting_id, spell, cast_type, cast_level, hidden)
                                    VALUES (?, ?, ?, ?, ?)
                                    ''', (spellcasting_id, spell, 'prepared', level, hidden))

                    # Insert skills
                    if monster.get('skill', []) is not None:
                        if isinstance(monster.get('skill', []), dict):
                            for skill, bonus in monster.get('skill', []).items():
                                cursor.execute('INSERT INTO monster_skills VALUES (?, ?, ?)', (monster_id, skill, str(bonus)))

                    # Insert traits
                    if monster.get('trait', []) is not None:
                        for trait in monster.get('trait', []):
                            cursor.execute('''
                            INSERT INTO monster_traits
                            (monster_id, name)
                            VALUES (?, ?)
                            ''', (
                                monster_id,
                                trait['name']
                            ))

                            main_trait_id = cursor.lastrowid

                            # Insert trait entries
                            for entry in trait.get('entries', []):
                                if isinstance(entry, dict):
                                    cursor.execute('''
                                    INSERT INTO monster_traits_entries
                                    (trait_id, type, style, items)
                                    VALUES (?, ?, ?, ?)
                                    ''', (
                                        main_trait_id,
                                        entry.get('type', ''),
                                        entry.get('style', ''),
                                        None
                                    ))

                                    trait_entry_id = cursor.lastrowid

                                    # Insert trait sub-entries
                                    for sub_entry in entry.get('items', []):
                                        if isinstance(sub_entry, dict):
                                            cursor.execute('''
                                            INSERT INTO monster_traits_entries
                                            (trait_id, trait_entry_id, description, type, style, items)
                                            VALUES (?, ?, ?, ?, ?, ?)
                                            ''', (
                                                main_trait_id,
                                                trait_entry_id,
                                                sub_entry.get('name', ''),
                                                sub_entry.get('type', ''),
                                                sub_entry.get('style', ''),
                                                '\n'.join(sub_entry.get('entries', []))
                                            ))
                                else:
                                    cursor.execute('''
                                    INSERT INTO monster_traits_entries
                                    (trait_id, description, type, style, items)
                                    VALUES (?, ?, ?, ?, ?)
                                    ''', (
                                        main_trait_id,
                                        entry,
                                        None,
                                        None,
                                        None
                                    ))

                    # Insert actions
                    if monster.get('action', []) is not None:
                        for action in monster.get('action', []):
                            cursor.execute('''
                            INSERT INTO monster_actions
                            (monster_id, name, type)
                            VALUES (?, ?, ?)
                            ''', (
                                monster_id,
                                action['name'],
                                'action'
                            ))

                            main_action_id = cursor.lastrowid

                            # Insert action entries
                            for entry in action.get('entries', []):
                                if isinstance(entry, dict):
                                    cursor.execute('''
                                    INSERT INTO monster_action_entries
                                    (action_id, type, style, items)
                                    VALUES (?, ?, ?, ?)
                                    ''', (
                                        main_action_id,
                                        entry.get('type', ''),
                                        entry.get('style', ''),
                                        None
                                    ))

                                    action_entry_id = cursor.lastrowid

                                    # Insert action sub-entries
                                    for sub_entry in entry.get('items', []):
                                        if isinstance(sub_entry, dict):
                                            cursor.execute('''
                                            INSERT INTO monster_action_entries
                                            (action_id, action_entry_id, description, type, style, items)
                                            VALUES (?, ?, ?, ?, ?, ?)
                                            ''', (
                                                main_action_id,
                                                action_entry_id,
                                                sub_entry.get('name', ''),
                                                sub_entry.get('type', ''),
                                                sub_entry.get('style', ''),
                                                '\n'.join(sub_entry.get('entries', []))
                                            ))
                                else:
                                    cursor.execute('''
                                    INSERT INTO monster_action_entries
                                    (action_id, description, type, style, items)
                                    VALUES (?, ?, ?, ?, ?)
                                    ''', (
                                        main_action_id,
                                        entry,
                                        None,
                                        None,
                                        None
                                    ))

                    # Insert legendary actions
                    if monster.get('legendary', []) is not None:
                        for action in monster.get('legendary', []):
                            cursor.execute('''
                            INSERT INTO monster_actions
                            (monster_id, name, type)
                            VALUES (?, ?, ?)
                            ''', (
                                monster_id,
                                action['name'] if 'name' in action else '',
                                'legendary'
                            ))

                            main_action_id = cursor.lastrowid

                            # Insert action entries
                            for entry in action.get('entries', []):
                                if isinstance(entry, dict):
                                    cursor.execute('''
                                    INSERT INTO monster_action_entries
                                    (action_id, type, style, items)
                                    VALUES (?, ?, ?, ?)
                                    ''', (
                                        main_action_id,
                                        entry.get('type', ''),
                                        entry.get('style', ''),
                                        None
                                    ))

                                    action_entry_id = cursor.lastrowid

                                    # Insert action sub-entries
                                    for sub_entry in entry.get('items', []):
                                        if isinstance(sub_entry, dict):
                                            cursor.execute('''
                                            INSERT INTO monster_action_entries
                                            (action_id, action_entry_id, description, type, style, items)
                                            VALUES (?, ?, ?, ?, ?, ?)
                                            ''', (
                                                main_action_id,
                                                action_entry_id,
                                                sub_entry.get('name', ''),
                                                sub_entry.get('type', ''),
                                                sub_entry.get('style', ''),
                                                '\n'.join(sub_entry.get('entries', []))
                                            ))
                                else:
                                    cursor.execute('''
                                    INSERT INTO monster_action_entries
                                    (action_id, description, type, style, items)
                                    VALUES (?, ?, ?, ?, ?)
                                    ''', (
                                        main_action_id,
                                        entry,
                                        None,
                                        None,
                                        None
                                    ))

                    # Insert immunities
                    if monster.get('immune', []) is not None:
                        for immunity in monster.get('immune', []):
                            if isinstance(immunity, dict):
                                note = immunity.get('note', '')
                                cond = immunity.get('cond', False) == True
                                if isinstance(immunity.get('immune', ''), list):
                                    for r in immunity.get('immune', []):
                                        cursor.execute('INSERT INTO monster_immunities VALUES (?, ?, ?, ?)',
                                                    (monster_id, str(r), cond, note))
                            else:
                                cursor.execute('INSERT INTO monster_immunities VALUES (?, ?, ?, ?)',
                                            (monster_id, str(immunity), None, None))

                    # Insert resistances
                    if monster.get('resist', []) is not None:
                        for resistance in monster.get('resist', []):
                            if isinstance(resistance, dict):
                                note = resistance.get('note', '')
                                cond = resistance.get('cond', False) == True
                                if isinstance(resistance.get('resist', ''), list):
                                    for r in resistance.get('resist', []):
                                        cursor.execute('INSERT INTO monster_resistances VALUES (?, ?, ?, ?)',
                                                    (monster_id, str(r), cond, note))
                            else:
                                cursor.execute('INSERT INTO monster_resistances VALUES (?, ?, ?, ?)',
                                            (monster_id, str(resistance) , None, None))

                    if monster.get('conditionImmune', []) is not None:
                        for condition in monster.get('conditionImmune', []):
                            notes = ''
                            if isinstance(condition, dict):
                                notes = condition.get('preNote', '')
                                condition = str(condition.get('conditionImmune', ''))
                            cursor.execute('INSERT INTO monster_condition_immunities VALUES (?, ?, ?)',
                                        (monster_id, condition, notes))

                    # Insert languages
                    if monster.get('languages', []) is not None:
                        for language in monster.get('languages', []):
                            cursor.execute('INSERT INTO monster_languages VALUES (?, ?, ?)',
                                        (monster_id, language, None))
                except sqlite3.Error as e:
                    line = sys.exc_info()[-1].tb_lineno
                    print(f"Error inserting monster {name}: {e} at line {line}")
                    print(f"Values: {(name, srd_value, source, size, type_val, alignment, ac_value, ac_desc, hp_avg, hp_formula, str_val, dex_val, con_val, int_val, wis_val, cha_val, passive, cr)}")
                                        #stop app
                    sys.exit(1)
                    return None

                return monster_id

            #delete the bestiary.db file
            if os.path.exists( os.path.dirname(os.path.dirname(os.path.realpath(__file__))) + '/data/bestiary.db'):
                os.remove( os.path.dirname(os.path.dirname(os.path.realpath(__file__))) + '/data/bestiary.db')
            #create the bestiary.db sqlite file
            conn = sqlite3.connect(os.path.dirname(os.path.dirname(os.path.realpath(__file__))) + '/data/bestiary.db')
            cursor = conn.cursor()

            # Main monster table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monsters (
                -- Core identifiers
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                source TEXT,
                page INTEGER,
                srd INTEGER DEFAULT 0,

                -- Basic attributes
                size TEXT,
                type TEXT,
                alignment TEXT,

                -- Combat stats
                ac INTEGER,
                ac_desc TEXT,
                hp_average INTEGER,
                hp_formula TEXT,

                -- Ability scores
                str INTEGER DEFAULT 10,
                dex INTEGER DEFAULT 10,
                con INTEGER DEFAULT 10,
                int INTEGER DEFAULT 10,
                wis INTEGER DEFAULT 10,
                cha INTEGER DEFAULT 10,

                -- Additional stats
                passive INTEGER,
                cr TEXT,

                -- Legendary info
                legendaryGroupId INTEGER,
                legendaryGroupName TEXT,
                legendaryGroupSource TEXT,

                -- Metadata
                age TEXT,
                monster_group TEXT,
                environment TEXT,
                castingColor TEXT,
                hasFluff INTEGER DEFAULT 0,
                hasFluffImages INTEGER DEFAULT 0,
                hasToken INTEGER DEFAULT 0,
                soundClipType TEXT,
                soundClip TEXT,

                -- Constraints
                UNIQUE(name, source)
            )
            ''')

            # Create indexes for common search fields
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_name ON monsters(name)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_cr ON monsters(cr)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_type ON monsters(type)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_source ON monsters(source)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_size ON monsters(size)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_srd ON monsters(srd)')

            # Compound index for name and source since they're used together
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_name_source ON monsters(name, source)')

            # Movement speeds
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_speeds (
                monster_id INTEGER,
                type TEXT,
                distance INTEGER,
                notes TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster speed lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_speeds ON monster_speeds(monster_id)')

            # Senses
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_senses (
                monster_id INTEGER,
                sense TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster sense lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_senses ON monster_senses(monster_id)')

            # Saves
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_saves (
                monster_id INTEGER,
                save TEXT,
                value INTEGER,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster save lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_saves ON monster_saves(monster_id)')

            # Spellcasting abilities
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_spellcasting (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                monster_id INTEGER,
                name TEXT,
                ability TEXT,
                notes TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster spellcasting lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_spellcasting ON monster_spellcasting(monster_id)')

            # Individual spells
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_spells (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spellcasting_id INTEGER,
                spell TEXT,
                hidden INTEGER,   -- 1 if spell is hidden (e.g. in spoiler)
                cast_type TEXT,    -- 'will', 'daily', 'ritual' etc
                cast_level TEXT,   -- spell level or 'at will'
                notes TEXT,        -- additional casting notes
                FOREIGN KEY(spellcasting_id) REFERENCES monster_spellcasting(id)
            )''')
            # Create index for faster spell lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_spells ON monster_spells(spellcasting_id)')

            # Actions (including reactions and legendary actions)
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                monster_id INTEGER,
                name TEXT,
                type TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster action lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_actions ON monster_actions(monster_id)')

            # Action Entries
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_action_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_id INTEGER,
                action_entry_id INTEGER DEFAULT NULL,
                description TEXT,
                type TEXT,
                style TEXT,
                items TEXT,
                FOREIGN KEY(action_id) REFERENCES monster_actions(id)
                FOREIGN KEY(action_entry_id) REFERENCES monster_action_entries(id)
            )''')
            # Create index for faster action entry lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_action_entries ON monster_action_entries(action_id)')

            # Skills
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_skills (
                monster_id INTEGER,
                skill TEXT,
                bonus INTEGER,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster skill lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_skills ON monster_skills(monster_id)')

            # Traits
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_traits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                monster_id INTEGER,
                name TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster trait lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_traits ON monster_traits(monster_id)')

            # Traits Extra Entries
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_traits_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trait_id INTEGER,
                trait_entry_id INTEGER DEFAULT NULL,
                description TEXT,
                type TEXT,
                style TEXT,
                items TEXT,
                FOREIGN KEY(trait_id) REFERENCES monster_traits(id)
                FOREIGN KEY(trait_entry_id) REFERENCES monster_traits_entries(id)
            )''')
            # Create index for faster trait entry lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_traits_entries ON monster_traits_entries(trait_id)')

            # immunities
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_immunities (
                monster_id INTEGER,
                type TEXT,
                cond INT,
                note TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster immunities
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_immunities ON monster_immunities(monster_id)')

            #resistances
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_resistances (
                monster_id INTEGER,
                type TEXT,
                cond INT,
                note TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster resistances
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_resistances ON monster_resistances(monster_id)')

            # Condition immunities
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_condition_immunities (
                monster_id INTEGER,
                condition TEXT,
                notes TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster condition immunities
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_condition_immunities ON monster_condition_immunities(monster_id)')

            # Languages
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_languages (
                monster_id INTEGER,
                language TEXT,
                notes TEXT,
                FOREIGN KEY(monster_id) REFERENCES monsters(id)
            )''')
            # Create index for faster language lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_languages ON monster_languages(monster_id)')

            # LegendaryGroup
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_legendary_group (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                source TEXT,
                page INTEGER
            )''')
            # Create index for faster legendary group lookups using name and source
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_legendary_group ON monster_legendary_group(name, source)')

            # LairActions
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_lair_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                legendary_group_id INTEGER,
                monster_lair_actions_id INTEGER DEFAULT NULL,
                name TEXT DEFAULT NULL,
                description TEXT DEFAULT NULL,
                type TEXT DEFAULT NULL,
                style TEXT DEFAULT NULL,
                FOREIGN KEY(legendary_group_id) REFERENCES monster_legendary_group(id)
                FOREIGN KEY(monster_lair_actions_id) REFERENCES monster_lair_actions(id)
            )''')
            # Create index for faster lair action lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_lair_actions_id ON monster_lair_actions(monster_lair_actions_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_legendary_group_id ON monster_lair_actions(legendary_group_id)')

            # Regional Effects
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS monster_regional_effects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                legendary_group_id INTEGER,
                monster_regional_effects_id INTEGER DEFAULT NULL,
                name TEXT DEFAULT NULL,
                description TEXT DEFAULT NULL,
                type TEXT DEFAULT NULL,
                style TEXT DEFAULT NULL,
                FOREIGN KEY(legendary_group_id) REFERENCES monster_legendary_group(id)
                FOREIGN KEY(monster_regional_effects_id) REFERENCES monster_regional_effects(id)
            )''')
            # Create index for faster regional effect lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_regional_effects_id ON monster_regional_effects(monster_regional_effects_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_monster_legendary_group_id ON monster_regional_effects(legendary_group_id)')

            # Get all bestiary JSON files
            bestiary_files = list(output_path.glob('bestiary/bestiary-*.json'))
            all_monsters = {'monsters': []}

            # Load and combine all bestiary files
            print("Processing bestiary files...")
            for file_path in bestiary_files:
                #print(f"Processing {file_path.name}...")
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    if 'monster' in data:
                        all_monsters['monsters'].extend(data['monster'])

            data = all_monsters

            for monster in data['monsters']:
                insert_monster(cursor, monster)

            #load Lengerdary Groups File
            with open(output_path / 'bestiary/legendaryGroups.json', 'r') as f:
                data = json.load(f)
                for group in data['legendaryGroup']:
                    MonsterName = group.get('name', '')
                    MonsterSource = group.get('source', '')
                    Page = group.get('page', None)

                    #Insert the legendary group
                    cursor.execute('''
                    INSERT INTO monster_legendary_group (name, source, page)
                    VALUES (?, ?, ?)
                    ''', (
                        MonsterName,
                        MonsterSource,
                        Page
                    ))

                    legendary_group_id = cursor.lastrowid

                    lair_actions = group.get('lairActions', [])
                    regional_effects = group.get('regionalEffects', [])

                    #Insert the lair actions
                    for action in lair_actions:
                        if isinstance(action, str):
                            cursor.execute('''
                            INSERT INTO monster_lair_actions (legendary_group_id, description) VALUES (?, ?)''', (
                                legendary_group_id,
                                action,
                            ))
                        elif isinstance(action, dict):
                            theType = action.get('type', '')
                            theStyle = action.get('style', '')

                            if theType == 'list':
                                items = action.get('items', [])
                                ParentItemCreated = False
                                lair_action_id = None
                                for item in items:
                                    if isinstance(item,str):
                                        cursor.execute('''
                                        INSERT INTO monster_lair_actions (legendary_group_id, description, type) VALUES (?, ?, ?)''', (
                                            legendary_group_id,
                                            item,
                                            theType
                                        ))
                                    elif isinstance(item, dict):
                                        if not ParentItemCreated:
                                            cursor.execute('''
                                            INSERT INTO monster_lair_actions (legendary_group_id, type, style) VALUES (?, ?, ?)''', (
                                                legendary_group_id,
                                                theType,
                                                theStyle
                                            ))
                                            ParentItemCreated = True
                                            lair_action_id = cursor.lastrowid

                                        item_type = item.get('type', '')
                                        item_name = item.get('name', '')
                                        item_style = item.get('style', '') if item.get('style', '') else None
                                        item_entries = item.get('entries', [])

                                        cursor.execute('''
                                        INSERT INTO monster_lair_actions (legendary_group_id, monster_lair_actions_id, type, name, style) VALUES (?, ?, ?, ?, ?)''', (
                                            legendary_group_id,
                                            lair_action_id,
                                            item_type,
                                            item_name,
                                            item_style
                                        ))

                                        lair_action_sub_id = cursor.lastrowid

                                        if len(item_entries) > 0:
                                            cursor.execute('''
                                            UPDATE monster_lair_actions SET description = ? WHERE id = ?''', (
                                                '\n'.join(item_entries),
                                                lair_action_sub_id
                                            ))
                                        elif item.get('entry', []):
                                            cursor.execute(''' UPDATE monster_lair_actions SET description = ? WHERE id = ?''', (
                                                item.get('entry', []),
                                                lair_action_sub_id
                                            ))

                    #Insert the regional effects
                    for effect in regional_effects:
                        if isinstance(effect, str):
                            cursor.execute('''
                            INSERT INTO monster_regional_effects (legendary_group_id, description) VALUES (?, ?)''', (
                                legendary_group_id,
                                effect,
                            ))
                        elif isinstance(effect, dict):
                            theType = effect.get('type', '')
                            theStyle = effect.get('style', '')

                            if theType == 'list':
                                items = effect.get('items', [])
                                ParentItemCreated = False
                                regional_effect_id = None
                                for item in items:
                                    if isinstance(item,str):
                                        cursor.execute('''
                                        INSERT INTO monster_regional_effects (legendary_group_id, description, type) VALUES (?, ?, ?)''', (
                                            legendary_group_id,
                                            item,
                                            theType
                                        ))
                                    elif isinstance(item, dict):
                                        if not ParentItemCreated:
                                            cursor.execute('''
                                            INSERT INTO monster_regional_effects (legendary_group_id, type, style) VALUES (?, ?, ?)''', (
                                                legendary_group_id,
                                                theType,
                                                theStyle
                                            ))
                                            ParentItemCreated = True
                                            regional_effect_id = cursor.lastrowid

                                        item_type = item.get('type', '')
                                        item_name = item.get('name', '')
                                        item_style = item.get('style', '') if item.get('style', '') else None
                                        item_entries = item.get('entries', [])

                                        cursor.execute('''
                                        INSERT INTO monster_regional_effects (legendary_group_id, monster_regional_effects_id, type, name, style) VALUES (?, ?, ?, ?, ?)''', (
                                            legendary_group_id,
                                            regional_effect_id,
                                            item_type,
                                            item_name,
                                            item_style
                                        ))

                                        regional_effect_sub_id = cursor.lastrowid

                                        if len(item_entries) > 0:
                                            cursor.execute('''
                                            UPDATE monster_regional_effects SET description = ? WHERE id = ?''', (
                                                '\n'.join(item_entries),
                                                regional_effect_sub_id
                                            ))
                                        elif item.get('entry', []):
                                            cursor.execute(''' UPDATE monster_regional_effects SET description = ? WHERE id = ?''', (
                                                item.get('entry', []),
                                                regional_effect_sub_id
                                            ))

            #Update legendaryGroupId in monsters table
            cursor.execute('''
            UPDATE monsters
            SET legendaryGroupId = (SELECT id FROM monster_legendary_group WHERE name = monsters.legendaryGroupName AND source = monsters.legendaryGroupSource)
            WHERE legendaryGroupName IS NOT NULL AND legendaryGroupSource IS NOT NULL
            ''')

            print("Bestiary database created!")

            # Commit changes and close connection
            conn.commit()
            conn.close()

        try:
            #process_directory()
            # Move files from temp to final location
            final_path = Path(output_dir)
            if final_path.exists():
                shutil.rmtree(final_path)
            shutil.copytree(output_path, final_path)
            print("Download complete!")
            print("Creating Bestiary Database...")

            create_bestiary_db(output_path)
        finally:
            # Cleanup temp directory
            print("Cleaning up...")
            #shutil.rmtree(output_path)

    def lookup_monsters(self, search_term):
        db = self.get_bestiary_db()
        cursor = db.cursor()
        """Lookup a monster by name, any stats, return list of matching monsters, json response"""
        results = cursor.execute('''
        SELECT id, name, source FROM monsters
        WHERE name LIKE ?
        OR source LIKE ?
        OR size LIKE ?
        OR type LIKE ?
        OR alignment LIKE ?
        OR ac_desc LIKE ?
        OR hp_formula LIKE ?
        OR cr LIKE ?
        ORDER BY name
        ''', (f"%{search_term}%",) * 8)

        rows = results.fetchall()
        monster_list = []
        for row in rows:
            monster_list.append({
                'id': row['id'],
                'name': row['name'],
                'source': row['source']
            })

        return jsonify(monster_list)

    def getSourceDescription(self, source):
        return {
            'MM': 'Monster Manual',
            'VGM': 'Volo\'s Guide to Monsters',
            'MTF': 'Mordenkainen\'s Tome of Foes',
            'TCE': 'Tasha\'s Cauldron of Everything',
            'GGTR': 'Guildmasters\' Guide to Ravnica',
            'AI': 'Acquisitions Incorporated',
            'EGW': 'Explorer\'s Guide to Wildemount',
            'IDRotF': 'Icewind Dale: Rime of the Frostmaiden',
            'MOoT': 'Mythic Odysseys of Theros',
            'TTP': 'Tales from the Yawning Portal',
            'WDH': 'Waterdeep: Dragon Heist',
            'WDMM': 'Waterdeep: Dungeon of the Mad Mage',
            'BGDIA': 'Baldur\'s Gate: Descent into Avernus',
            'DC': 'Dungeoncraft',
            'GGR': 'Guildmasters\' Guide to Ravnica',
            'LLK': 'Lost Laboratory of Kwalish',
            'MFF': 'Mythic Odysseys of Theros',
            'WDH': 'Waterdeep: Dragon Heist',
            'WDMM': 'Waterdeep: Dungeon of the Mad Mage',
            'WDotMM': 'Waterdeep: Dungeon of the Mad Mage',
            'ToA': 'Tomb of Annihilation',
            'SKT': 'Storm King\'s Thunder',
            'PotA': 'Princes of the Apocalypse',
            'OotA': 'Out of the Abyss',
            'HotDQ': 'Hoard of the Dragon Queen',
            'RoT': 'Rise of Tiamat',
            'LMoP': 'Lost Mine of Phandelver',
            'CoS': 'Curse of Strahd'
        }.get(source, source)

    def monster_details(self, monster_id):
        db = self.get_bestiary_db()
        cursor = db.cursor()
        """Lookup a monster by ID, return full monster details, json response"""
        result = cursor.execute('''
        SELECT * FROM monsters WHERE id = ?
        ''', (monster_id,))
        row = result.fetchone()

        if row is None:
            return jsonify({"error": "Monster not found"})

        monster = {
            'id': row['id'],
            'name': row['name'],
            'source': row['source'],
            'page': row['page'],
            'sourceDescription': self.getSourceDescription(row['source']),
            'legendaryGroupName': row['legendaryGroupName'],
            'legendaryGroupSource': row['legendaryGroupSource'],
            'size': row['size'],
            'type': row['type'],
            'alignment': row['alignment'].split(' / '),
            'ac': row['ac'],
            'ac_desc': row['ac_desc'],
            'hp_average': row['hp_average'],
            'hp_formula': row['hp_formula'],
            'str': row['str'],
            'dex': row['dex'],
            'con': row['con'],
            'int': row['int'],
            'wis': row['wis'],
            'cha': row['cha'],
            'passive': row['passive'],
            'cr': row['cr'],
            'castingColor': row['castingColor'],
            'environment': row['environment'],
            'age': row['age'],
            'group': row['monster_group'],
            'hasFluff': row['hasFluff'],
            'hasFluffImages': row['hasFluffImages'],
            'hasToken': row['hasToken'],
            'soundClipType': row['soundClipType'],
            'soundClip': row['soundClip'],
            'srd': row['srd']
        }

        # Speeds
        speeds = cursor.execute('''
        SELECT type, distance, notes FROM monster_speeds WHERE monster_id = ?
        ''', (monster_id,))
        monster['speed'] = []
        for speed in speeds.fetchall():
            monster['speed'].append({
                'type': speed['type'],
                'distance': speed['distance'],
                'notes': speed['notes']
            })

        # Senses
        senses = cursor.execute('''
        SELECT sense FROM monster_senses WHERE monster_id = ?
        ''', (monster_id,))
        monster['senses'] = []
        for sense in senses.fetchall():
            monster['senses'].append(sense['sense'])

        # Saves
        saves = cursor.execute('''
        SELECT save, value FROM monster_saves WHERE monster_id = ?
        ''', (monster_id,))
        monster['saves'] = []
        for save in saves.fetchall():
            monster['saves'].append({
                save['save']: save['value']
            })

        # Spellcasting
        spellcasting = cursor.execute('''
        SELECT id, name, ability, notes FROM monster_spellcasting WHERE monster_id = ?
        ''', (monster_id,))
        monster['spellcasting'] = []
        for spell in spellcasting.fetchall():
            spellcasting_id = spell['id']
            spells = cursor.execute('''
            SELECT spell, cast_type, cast_level, notes FROM monster_spells WHERE spellcasting_id = ?
            ''', (spellcasting_id,))

            spell_list = []
            for s in spells.fetchall():
                spell_list.append({
                    'spell': s['spell'],
                    'cast_type': s['cast_type'],
                    'cast_level': s['cast_level'],
                    'notes': s['notes']
                })

            monster['spellcasting'].append({
                'name': spell['name'],
                'ability': spell['ability'],
                'notes': spell['notes'],
                'spells': spell_list
            })

        # Skills
        skills = cursor.execute('''
        SELECT skill, bonus FROM monster_skills WHERE monster_id = ?
        ''', (monster_id,))
        monster['skills'] = []
        for skill in skills.fetchall():
            monster['skills'].append({
                'skill': skill['skill'],
                'bonus': skill['bonus']
            })

        # Traits
        traits = cursor.execute('''
        SELECT id, name FROM monster_traits WHERE monster_id = ?
        ''', (monster_id,))
        monster['traits'] = []
        for trait in traits.fetchall():

            entries = cursor.execute('''
            SELECT trait_entry_id, description, type, style, items FROM monster_traits_entries WHERE trait_id = ?
            ''', (trait['id'],))
            trait_entries = []
            for entry in entries.fetchall():
                sub_entries = []

                if entry['trait_entry_id']:
                    sub_entries = cursor.execute('''
                    SELECT description, type, style, items FROM monster_traits_entries WHERE trait_entry_id = ?
                    ''', (entry['trait_entry_id'],))
                    for sub_entry in action_sub_entries.fetchall():
                        sub_entries.append({
                            'description': sub_entry['description'],
                            'type': sub_entry['type'],
                            'style': sub_entry['style'],
                            'items': sub_entry['items']
                        })

                trait_entries.append({
                    'description': entry['description'],
                    'type': entry['type'],
                    'style': entry['style'],
                    'items': entry['items'],
                    'sub_entries': sub_entries
                })

            monster['traits'].append({
                'name': trait['name'],
                'entries': trait_entries
            })

        # Actions
        actions = cursor.execute('''
        SELECT id, name, type FROM monster_actions WHERE monster_id = ?
        ''', (monster_id,))
        monster['actions'] = []
        for action in actions.fetchall():

            action_entries = cursor.execute('''
            SELECT action_entry_id, description, type, style, items FROM monster_action_entries WHERE action_id = ?
            ''', (action['id'],))
            entries = []
            for entry in action_entries.fetchall():

                sub_entries = []
                if entry['action_entry_id']:
                    action_sub_entries = cursor.execute('''
                    SELECT description, type, style, items FROM monster_action_entries WHERE action_entry_id = ?
                    ''', (entry['action_entry_id'],))
                    for sub_entry in action_sub_entries.fetchall():
                        sub_entries.append({
                            'description': sub_entry['description'],
                            'type': sub_entry['type'],
                            'style': sub_entry['style'],
                            'items': sub_entry['items']
                        })

                entries.append({
                    'description': entry['description'],
                    'type': entry['type'],
                    'style': entry['style'],
                    'items': entry['items'],
                    'sub_entries': sub_entries
                })

            monster['actions'].append({
                'name': action['name'],
                'entries': entries,
                'type': action['type']
            })

        # Immunities
        immunities = cursor.execute('''
        SELECT type, cond, note FROM monster_immunities WHERE monster_id = ?
        ''', (monster_id,))
        monster['immunities'] = []
        for immunity in immunities.fetchall():
            monster['immunities'].append({
                'type': immunity['type'],
                'cond': immunity['cond'],
                'note': immunity['note']
            })

        # Resistances
        resistances = cursor.execute('''
        SELECT type, cond, note FROM monster_resistances WHERE monster_id = ?
        ''', (monster_id,))
        monster['resistances'] = []
        for resistance in resistances.fetchall():
            monster['resistances'].append({
                'type': resistance['type'],
                'cond': resistance['cond'],
                'note': resistance['note']
            })

        # Condition immunities
        condition_immunities = cursor.execute('''
        SELECT condition, notes FROM monster_condition_immunities WHERE monster_id = ?
        ''', (monster_id,))
        monster['condition_immunities'] = []

        for condition in condition_immunities.fetchall():
            monster['condition_immunities'].append({
                'condition': condition['condition'],
                'notes': condition['notes']
            })

        # Languages
        languages = cursor.execute('''
        SELECT language, notes FROM monster_languages WHERE monster_id = ?
        ''', (monster_id,))

        monster['languages'] = []
        for language in languages.fetchall():
            monster['languages'].append({
                'language': language['language'],
                'notes': language['notes']
            })

        #Lair Actions
        lair_actions = cursor.execute('''
        SELECT la.id, la.name, la.description, la.type, la.style FROM monsters m JOIN monster_lair_actions la ON m.legendaryGroupId = la.legendary_group_id WHERE m.id = ?
        ''', (monster_id,))

        monster['lairActions'] = []
        for action in lair_actions.fetchall():
            if action['type'] == 'list' and action['style'] is not None:
                items = cursor.execute('''
                SELECT type, name, style, description FROM monster_lair_actions WHERE monster_lair_actions_id = ?
                ''', (action['id'],))

                item_list = []
                for item in items.fetchall():
                    item_list.append({
                        'type': item['type'],
                        'name': item['name'],
                        'style': item['style'],
                        'description': item['description']
                    })

                monster['lairActions'].append({
                    'type': action['type'],
                    'name': action['name'],
                    'style': action['style'],
                    'items': item_list
                })
            else:
                monster['lairActions'].append({
                    'type': action['type'],
                    'name': action['name'],
                    'style': action['style'],
                    'description': action['description']
                })

        #Regional Effects
        regional_effects = cursor.execute('''
        SELECT re.id, re.name, re.description, re.type, re.style FROM monsters m JOIN monster_regional_effects re ON m.legendaryGroupId = re.legendary_group_id WHERE m.id = ?
        ''', (monster_id,))

        monster['regionalEffects'] = []
        for effect in regional_effects.fetchall():
            if effect['type'] == 'list' and effect['style'] is not None:
                items = cursor.execute('''
                SELECT type, name, style, description FROM monster_regional_effects WHERE monster_regional_effects_id = ?
                ''', (effect['id'],))

                item_list = []
                for item in items.fetchall():
                    item_list.append({
                        'type': item['type'],
                        'name': item['name'],
                        'style': item['style'],
                        'description': item['description']
                    })

                monster['regionalEffects'].append({
                    'type': effect['type'],
                    'name': effect['name'],
                    'style': effect['style'],
                    'items': item_list
                })
            else:
                monster['regionalEffects'].append({
                    'type': effect['type'],
                    'name': effect['name'],
                    'style': effect['style'],
                    'description': effect['description']
                })

        return jsonify(monster)

app = Flask(__name__)
mythicforge = MythicForge(app)

# Register close_db function to run after each request
app.teardown_appcontext(mythicforge.close_db)

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