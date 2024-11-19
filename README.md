
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Node.js](https://img.shields.io/badge/Node.js-14.x+-green.svg)](https://nodejs.org/)

<div align="center">
  <img src="assets/images/logo-big.webp" alt="MythicForge Logo" width="300px">
</div>

---

<div align="center">
  <strong>🏰 A powerful D&D 5E campaign management and character creation tool powered by AI. MythicForge combines traditional tabletop gaming with advanced AI capabilities to enhance your roleplaying experience. 🧙‍♂️</strong>
</div>

---

## VERSION: 0.0.1 PRE-ALPHA

## ✨ Projected Features

- **Complete D&D 5E Database**
  - Spells, items, monsters, and more
  - Quick search and filtering
  - Homebrew content support

- **Character Creation & Management**
  - Interactive character builder
  - Automatic stat calculations
  - Character sheet export/import
  - Custom character artwork integration

- **AI-Powered Campaign Tools**
  - AI Dungeon Master mode
  - Dynamic NPC generation
  - Intelligent encounter scaling
  - Campaign story generation
  - Memory-aware storytelling

- **Flexible AI Integration**
  - OpenAI, Google Gemini support
  - Local AI option for offline use
  - Customizable AI parameters

- **DM Tools**
  - Random encounter generator
  - Custom monster creator
  - Loot table generator
  - Initiative tracker
  - Interactive maps

## 🚀 Getting Started

### Prerequisites

- Python 3.8 or higher
- Node.js 14.x or higher
- SQLite3

### Installation

1. Clone the repository
```bash
git clone https://github.com/armysarge/mythicforge.git
cd mythicforge
```

2. Install Python dependencies
```bash
pip install -r requirements.txt
```

3. Install Node.js dependencies
```bash
npm install
```

4. Configure your environment
```bash
cp .env.example .env
# Edit .env with your API keys and preferences
```

5. Initialize the database
```bash
python scripts/init_db.py
```

6. Start the application
```bash
npm run start
```

The application will be available at `http://localhost:3000`

## 🔧 Configuration

### AI Provider Setup

Configure your preferred AI provider in the `.env` file:

```env
AI_PROVIDER=openai  # Options: openai, gemini, local
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
```

### Local AI Setup

For offline AI functionality:
1. Download the required models using `python scripts/download_local_models.py`
2. Enable local AI mode in settings

## 📚 Documentation

For detailed documentation, visit our [Wiki](https://github.com/armysarge/MythicForge/wiki)

- [API Reference](https://github.com/armysarge/MythicForge/wiki/API-Reference)
- [Custom Content Guide](https://github.com/armysarge/MythicForge/wiki/Custom-Content)
- [AI Configuration](https://github.com/armysarge/MythicForge/wiki/AI-Configuration)

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📋 Roadmap

- [ ] Virtual tabletop integration
- [ ] Multi-language support
- [ ] Audio integration for ambient sounds
- [ ] Mobile companion app
- [ ] Campaign sharing platform

## 📄 License

This project is licensed under the AGPL License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- D&D 5E SRD for reference content
- OpenAI and Google for AI capabilities
- The D&D community for inspiration and feedback

## 💬 Support

- Create an [Issue](https://github.com/armysarge/mythicforge/issues)
- Join our [Discord](https://discord.gg/eGeMyCYSny)
- Email: armysarge.ss@gmail.com

---

Built with ❤️ for the D&D community