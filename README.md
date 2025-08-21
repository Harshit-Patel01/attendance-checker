# CyberVidya Attendance Bot

An automated attendance tracking bot for CyberVidya Learning Management System that sends notifications through Telegram.

## Features

- 🔄 Automatically checks attendance every 30 minutes during working hours
- 📊 Calculates attendance percentage for each course
- 🚨 Sends Telegram notifications when attendance changes
- 📅 Smart scheduling (only runs Mon-Fri, 10 AM - 10 PM IST)
- 💾 Maintains attendance state and pushes to GitHub
- ⚡ Calculates lectures needed to maintain 75% attendance

## Setup

### Prerequisites

- Node.js v14 or higher
- A Telegram bot token (Get it from [@BotFather](https://t.me/botfather))
- Your Telegram chat ID (Message [@userinfobot](https://t.me/userinfobot))
- Your CyberVidya credentials

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/Harshit-Patel01/attendance_checker.git
   cd attendance_checker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your credentials:
   ```env
   CYBERVIDYA_USERNAME=your_enrollment_number
   PASSWORD=your_password
   BOT_TOKEN=your_telegram_bot_token
   CHAT_ID=your_telegram_chat_id
   GITHUB_REPOSITORY=your_github_username/repo_name
   GIT_SSH_KEY=your_private_ssh_key
   ```

### Running Locally

```bash
npm start
```

### Deployment

The bot is designed to be deployed on [Railway](https://railway.app):

1. Create a new project on Railway
2. Connect your GitHub repository
3. Add the environment variables listed above
4. Railway will automatically detect the Procfile and start the worker

## How It Works

1. **Schedule**: The bot runs every 30 minutes during working hours (Mon-Fri, 10 AM - 10 PM IST)
2. **Login**: Authenticates with CyberVidya using provided credentials
3. **Fetch**: Retrieves current attendance for all courses
4. **Compare**: Checks for changes in attendance since last run
5. **Notify**: Sends Telegram messages for any detected changes
6. **Store**: Saves current state and pushes to GitHub

## Telegram Notifications

The bot sends detailed notifications including:
- Course name
- Attendance status (Present/Absent)
- Current attendance percentage
- Number of lectures that can be skipped while maintaining 75%
- Warning if attendance falls below 75%

Example notification:
```
📘 Database Systems
✅ Marked as Present
Attendance: 5/6 (83.33%)
✅ Safe! You can skip up to 0 lecture(s) while staying ≥75%.
```

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
