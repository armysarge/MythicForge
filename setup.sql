-- DND Character Database Schema
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    email TEXT UNIQUE,
    name TEXT,
    surname TEXT,
    contact_number TEXT,
    allow_ai_use BOOLEAN NOT NULL DEFAULT 0,
    is_admin BOOLEAN NOT NULL DEFAULT 0,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users_settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT NOT NULL DEFAULT 'default',
    srd_content BOOLEAN NOT NULL DEFAULT 0,
    using_ai BOOLEAN NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'en',
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Create table for character details
CREATE TABLE IF NOT EXISTS characters (
    character_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    isNPC BOOLEAN NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    age INTEGER,
    race TEXT NOT NULL,
    class TEXT NOT NULL,
    height INTEGER, -- in cm
    weight REAL DEFAULT 0.0, -- in kg
    level INTEGER NOT NULL DEFAULT 1,
    alignment TEXT,
    background TEXT,
    gold INTEGER NOT NULL DEFAULT 0,
    silver INTEGER NOT NULL DEFAULT 0,
    copper INTEGER NOT NULL DEFAULT 0,
    experience_points INTEGER NOT NULL DEFAULT 0,
    hit_points INTEGER NOT NULL DEFAULT 0,
    temporary_hit_points INTEGER NOT NULL DEFAULT 0,
    max_hit_points INTEGER NOT NULL DEFAULT 0,
    armor_class INTEGER NOT NULL DEFAULT 10,
    initiative INTEGER NOT NULL DEFAULT 0,
    inspiration BOOLEAN NOT NULL DEFAULT 0,
    speed INTEGER NOT NULL DEFAULT 30,
    alive BOOLEAN NOT NULL DEFAULT 1,
    resurrectable BOOLEAN NOT NULL DEFAULT 1,
    proficiency_bonus INTEGER NOT NULL DEFAULT 2,
    story TEXT,
    notes TEXT
);

-- Create table for notes or journal entries related to the character
CREATE TABLE IF NOT EXISTS character_notes (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

CREATE TABLE IF NOT EXISTS character_relationships (
    relationship_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    related_character_id INTEGER,
    relationship_type TEXT NOT NULL,
    relationship_description TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(character_id),
    FOREIGN KEY (related_character_id) REFERENCES characters(character_id)
);

-- Create table for character stats (strength, dexterity, etc.)
CREATE TABLE IF NOT EXISTS stats (
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    stat_name TEXT NOT NULL,  -- e.g., "Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"
    base_value INTEGER NOT NULL DEFAULT 10,
    modifier INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for skills (based on character stats)
CREATE TABLE IF NOT EXISTS skills (
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    skill_name TEXT NOT NULL,  -- e.g., "Athletics", "Acrobatics", "Stealth"
    associated_stat TEXT NOT NULL,  -- The stat that the skill is associated with (e.g., "Strength", "Dexterity")
    proficiency BOOLEAN NOT NULL DEFAULT 0,  -- Whether the character is proficient in the skill
    bonus INTEGER NOT NULL DEFAULT 0,  -- Additional bonuses (e.g., from feats or magic items)
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character inventory
CREATE TABLE IF NOT EXISTS inventory (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT,  -- e.g., "Weapon", "Armor", "Potion"
    quantity INTEGER NOT NULL DEFAULT 1,
    weight REAL DEFAULT 0.0,
    description TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character abilities (e.g., racial or class abilities)
CREATE TABLE IF NOT EXISTS abilities (
    ability_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    ability_name TEXT NOT NULL,
    description TEXT,
    uses_per_day INTEGER DEFAULT NULL,  -- How many times it can be used per day
    remaining_uses INTEGER DEFAULT NULL,  -- Current remaining uses for the day
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character spells
CREATE TABLE IF NOT EXISTS spells (
    spell_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    spell_name TEXT NOT NULL,
    spell_level INTEGER NOT NULL,
    casting_time TEXT,
    range TEXT,
    components TEXT,  -- e.g., "V, S, M"
    duration TEXT,
    description TEXT,
    prepared BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for spell slots
CREATE TABLE IF NOT EXISTS spell_slots (
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    spell_level INTEGER NOT NULL,
    total_slots INTEGER NOT NULL DEFAULT 0,
    used_slots INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character feats
CREATE TABLE IF NOT EXISTS feats (
    feat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    feat_name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character conditions (e.g., poisoned, stunned)
CREATE TABLE IF NOT EXISTS conditions (
    condition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    condition_name TEXT NOT NULL,
    description TEXT,
    duration INTEGER DEFAULT NULL,  -- Duration in rounds or minutes, NULL if indefinite
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character equipment (armor, weapons, etc.)
CREATE TABLE IF NOT EXISTS equipment (
    equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    equipment_type TEXT,  -- e.g., "Weapon", "Armor", "Shield"
    weight REAL DEFAULT 0.0,
    rarity TEXT,  -- e.g., "Common", "Uncommon", "Rare", "Very Rare", "Legendary"
    requires_attunement BOOLEAN NOT NULL DEFAULT 0,
    is_attuned BOOLEAN NOT NULL DEFAULT 0,
    is_equipped BOOLEAN NOT NULL DEFAULT 0,
    attack_bonus INTEGER DEFAULT 0,
    damage TEXT,  -- e.g., "1d8+2"
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character background features (skills, traits, ideals, bonds, flaws)
CREATE TABLE IF NOT EXISTS background_features (
    feature_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    feature_type TEXT NOT NULL,  -- e.g., "Skill", "Trait", "Ideal", "Bond", "Flaw"
    feature_description TEXT NOT NULL,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

-- Create table for character quests (ongoing or completed)
CREATE TABLE IF NOT EXISTS quests (
    quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    quest_name TEXT NOT NULL,
    description TEXT,
    is_completed BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    campaign_name TEXT NOT NULL,
    campaign_description TEXT,
    campaign_story TEXT,
    campaign_max_players INTEGER NOT NULL DEFAULT 4,
    campaign_start_level INTEGER NOT NULL DEFAULT 1,
    campaign_difficulty TEXT NOT NULL DEFAULT 'NORMAL',
    campaign_dm TEXT,
    campaign_setting TEXT,
    campaign_level_cap INTEGER NOT NULL DEFAULT 20,
    campaign_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    campaign_status TEXT NOT NULL DEFAULT 'INTRO'
);

CREATE TABLE IF NOT EXISTS campaign_characters (
    campaign_id INTEGER,
    character_id INTEGER,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id),
    FOREIGN KEY (character_id) REFERENCES characters(character_id)
);

CREATE TABLE IF NOT EXISTS campaign_sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    session_number INTEGER,
    session_date TIMESTAMP,
    session_summary TEXT,
    next_session_date TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);

CREATE TABLE IF NOT EXISTS event_history (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    user_id INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    event_prompt TEXT,
    event_summary TEXT,
    event_importance TEXT NOT NULL DEFAULT 'NORMAL',
    event_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_location TEXT,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id)
);