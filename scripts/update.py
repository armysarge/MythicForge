import os
import hashlib
import json
import requests
import subprocess
import shutil
import sqlite3
from datetime import datetime
from typing import Dict, Optional

temp_dir = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'temp_download')

def escape_column_name(name):
    """Escape SQLite reserved words by wrapping in quotes"""
    reserved_words = ['index', 'group', 'order', 'by', 'where']
    return f'"{name}"' if name.lower() in reserved_words else name

def convert_value(value):
    """Convert complex types to SQLite-compatible strings"""
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    elif value is None:
        return ''
    return value

class GitHubAutoUpdater:
    def __init__(self, repo_owner: str, repo_name: str, copy: bool = True, backup: bool = True):
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.dobackup = backup
        self.github_api = f"https://api.github.com/repos/{repo_owner}/{repo_name}"
        self.local_files_path = os.path.dirname(os.path.realpath(__file__))
        self.root_path = os.path.dirname(self.local_files_path)
        self.update_info_file = os.path.join(self.local_files_path, "update_info.json")
        self.current_version = self.get_current_version(repo_name)
        self.copy = copy

    def calculate_file_hash(self, filepath: str) -> str:
        """Calculate SHA-256 hash of a file."""
        sha256_hash = hashlib.sha256()
        with open(filepath, "rb") as f:
            print(f"Calculating hash for {filepath}...")
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def get_latest_release(self):
        """Get the latest release information from GitHub."""
        try:
            response = requests.get(f"{self.github_api}/releases/latest")
            if response.status_code == 200:
                release_info = response.json()
                # Use zipball_url if no assets
                if not release_info.get('assets'):
                    release_info['assets'] = [{
                        'browser_download_url': release_info['zipball_url'],
                        'name': f"{self.repo_name}-{release_info['tag_name']}.zip"
                    }]
                return release_info
            return None
        except Exception as e:
            print(f"Error getting latest release: {e}")
            return None

    def download_file(self, url: str, local_path: str) -> bool:
        """Download file from URL and save to local path."""
        try:
            response = requests.get(url, stream=True)
            if response.status_code == 200:
                with open(local_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                if local_path.endswith('.zip'):
                    self.extract_zip(local_path)
                return True
            return False
        except Exception as e:
            print(f"Error downloading file: {e}")
            return False

    def extract_zip(self, zip_path: str):
        """Extract ZIP file to temp directory."""
        import zipfile
        temp_extract = os.path.join(os.path.dirname(zip_path), 'extract_temp')
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_extract)
        # Move extracted files
        first_dir = next(os.walk(temp_extract))[1][0]  # Get first directory
        if not self.copy:
            src_dir = temp_extract
            dst_dir = os.path.join(os.path.dirname(temp_dir), self.repo_name)
        else:
            src_dir = os.path.join(temp_extract, first_dir)
            dst_dir = os.path.dirname(temp_dir)
        for item in os.listdir(src_dir):
            s = os.path.join(src_dir, item)
            d = os.path.join(dst_dir, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)

    def get_current_version(self, repo_name: str) -> str:
        """Get current version from update.json file."""
        try:
            if not os.path.exists(self.update_info_file):
                return "v0.0.0"

            with open(self.update_info_file, 'r') as file:
                data = json.load(file)
                for entry in data:
                    if entry.get('repo') == repo_name:
                        return entry.get('version', 'v0.0.0')
                return "v0.0.0"
        except Exception as e:
            print(f"Error reading version file: {e}")
            return "v0.0.0"

    def backup_current_version(self):
        if self.dobackup:
            """Create a backup of the current version."""
            backup_dir = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            backup_dir = os.path.join(self.local_files_path, backup_dir)
            parent_dir = os.path.dirname(self.local_files_path)
            os.makedirs(backup_dir, exist_ok=True)

            try:
                for root, _, files in os.walk(parent_dir):
                    if '.git' in root or 'backup_' in root:
                        continue
                    for file in files:
                        if file == os.path.basename(self.update_info_file):
                            continue
                        src_path = os.path.join(root, file)
                        rel_path = os.path.relpath(src_path, parent_dir)
                        dst_path = os.path.join(backup_dir, rel_path)

                        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                        shutil.copy2(src_path, dst_path)

                return backup_dir
            except Exception as e:
                print(f"Error during backup: {e}")
                return None

    def save_update_info(self, version: str, files_hash: Dict[str, str]):
        """Save update information to a JSON file."""
        update_info = {
            'repo': self.repo_name,
            'version': version,
            'last_update': datetime.now().isoformat(),
            'files_hash': files_hash
        }
        try:
            with open(self.update_info_file, 'r') as file:
                data = json.load(file)
                found = False
                for entry in data:
                    if entry.get('repo') == self.repo_name:
                        found = True
                        entry['version'] = version
                        break
                if not found:
                    data.append(update_info)
                else:
                    update_info = data

                with open(self.update_info_file, 'w') as file:
                    json.dump(update_info, file, indent=4)

        except FileNotFoundError:
            print(f"Error: The file {self.update_info_file} was not found.")
            print("Creating a new version file...")
            with open(self.update_info_file, 'w') as file:
                json.dump([update_info], file, indent=4)

    def load_update_info(self) -> Optional[Dict]:
        """Load saved update information."""
        try:
            with open(self.update_info_file, 'r') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def check_and_update(self) -> bool:
        """Main method to check for and perform updates."""

        # Get latest release from GitHub
        latest_release = self.get_latest_release()
        if not latest_release:
            return False

        latest_version = latest_release['tag_name']
        if latest_version <= self.current_version:
            print("Already running the latest version.")
            return False

        print(f"New version available: {latest_version}")

        # Create backup
        backup_dir = self.backup_current_version()
        print(f"Backup created in: {backup_dir}")

        # Create temp directory for downloads
        os.makedirs(temp_dir, exist_ok=True)
        print(f"Downloading files to: {temp_dir}")

        # Download and update files
        success = True
        new_files_hash = {}

        try:
            for asset in latest_release['assets']:
                download_url = asset['browser_download_url']
                filename = asset['name']
                download_path = os.path.join(temp_dir, filename)

                if not self.download_file(download_url, download_path):
                    success = False
                    break

                new_files_hash[filename] = self.calculate_file_hash(download_path)

                if self.copy:
                    # Move file to correct location
                    target_path = os.path.join(temp_dir, filename)
                    shutil.move(download_path, target_path)

        finally:
            # Cleanup temp directory
            if os.path.exists(temp_dir):
               shutil.rmtree(temp_dir)
            print(f" ")

        if success:
            self.save_update_info(latest_version, new_files_hash)
            print(f"Successfully updated to version {latest_version}")
            return True
        else:
            # Restore from backup if update failed
            print("Update failed, restoring from backup...")
            subprocess.run(['rm', '-rf', self.local_files_path])
            subprocess.run(['cp', '-r', backup_dir, self.local_files_path])
            return False

def main():
    hasBackedUp = False
    # Example usage
    updater = GitHubAutoUpdater(
        repo_owner="armysarge",
        repo_name="MythicForge",
        backup = not hasBackedUp
    )

    print("Checking for MythicForge updates...")
    if updater.check_and_update():
        print("Update completed successfully...")

        print(" ")
        #Check if database is up to date
        if os.path.exists("../MythicForge.db"):
            print("Updating MythicForge database...")
            subprocess.run(['python', 'update_db.py'])

    else:
        print("No MythicForge update performed.")

    print(" ")

    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    main()