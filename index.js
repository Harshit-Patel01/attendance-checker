const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const cron = require('node-cron');

const LOGIN_URL = "https://kiet.cybervidya.net/api/auth/login";
const COURSES_URL = "https://kiet.cybervidya.net/api/student/dashboard/registered-courses";

const STATE_FILE = "attendance_state.json";

async function login() {
  const payload = { userName: process.env.USERNAME, password: process.env.PASSWORD };
  const resp = await axios.post(LOGIN_URL, payload);
  const data = resp.data.data;
  return { auth_pref: data.auth_pref, token: data.token };
}

async function fetch_courses(auth_pref, token) {
  const headers = { Authorization: auth_pref + token };
  const resp = await axios.get(COURSES_URL, { headers });
  return resp.data.data;
}

async function send_telegram(msg) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: process.env.CHAT_ID, text: msg, parse_mode: "Markdown" };
  const r = await axios.post(url, payload);
  console.log("Telegram status:", r.data);
}

function calculate_attendance_message(course, present, total, status) {
  const percentage = total > 0 ? (present / total * 100) : 0;
  const status_emoji = status === "Present" ? "✅" : "❌";
  let msg = `📘 *${course}*\n${status_emoji} Marked as *${status}*\nAttendance: ${present}/${total} (${percentage.toFixed(2)}%)`;

  if (percentage < 75) {
    let x = Math.ceil((0.75 * total - present) / 0.25);
    if (x < 0) x = 0;
    msg += `\n⚠️ Below 75%! You must attend at least ${x} more lecture(s) in a row.`;
  } else {
    let y = Math.floor(present / 0.75 - total);
    if (y < 0) y = 0;
    msg += `\n✅ Safe! You can skip up to ${y} lecture(s) while staying ≥75%.`;
  }
  return msg;
}

function setup_git_ssh() {
  const ssh_key = process.env.GIT_SSH_KEY;
  if (!ssh_key) {
    console.log("GIT_SSH_KEY environment variable not set. Skipping git push.");
    return false;
  }

  const ssh_dir = path.join(os.homedir(), '.ssh');
  if (!fs.existsSync(ssh_dir)) {
    fs.mkdirSync(ssh_dir, { recursive: true });
  }

  const key_path = path.join(ssh_dir, 'id_rsa');
  fs.writeFileSync(key_path, ssh_key);
  fs.chmodSync(key_path, 0o600);

  const config_path = path.join(ssh_dir, 'config');
  fs.writeFileSync(config_path, 'Host github.com\n  StrictHostKeyChecking no\n');

  return true;
}

function commit_and_push() {
  if (!setup_git_ssh()) return;

  try {
    execSync('git config --global user.name "Railway Cron"');
    execSync('git config --global user.email "railway-cron@example.com"');

    const repo_url = `git@github.com:${process.env.GITHUB_REPOSITORY}.git`;
    execSync(`git remote set-url origin ${repo_url}`);

    execSync(`git add ${STATE_FILE}`);

    const status = execSync('git status --porcelain').toString();
    if (status.includes(STATE_FILE)) {
      const commit_message = `Update attendance state on ${new Date().toISOString()}`;
      execSync(`git commit -m "${commit_message}"`);
      execSync('git push origin HEAD:main');
      console.log("Changes pushed to the repository.");
    } else {
      console.log("No changes to commit.");
    }
  } catch (e) {
    console.log(`Failed to push changes: ${e.message}`);
  }
}

async function check_attendance() {
  console.log(`Checking attendance at ${new Date()}`);
  const { auth_pref, token } = await login();
  const courses = await fetch_courses(auth_pref, token);

  let prev_state = {};
  if (fs.existsSync(STATE_FILE)) {
    prev_state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }

  const new_state = {};

  for (const c of courses) {
    const code = c.courseCode;
    const comp = c.studentCourseCompDetails[0];
    const present = comp.presentLecture;
    const total = comp.totalLecture;

    new_state[code] = { present, total };

    const old = prev_state[code] || {};
    if (old.present !== present || old.total !== total) {
      let status = "Unknown";
      const old_present = old.present || 0;
      const old_total = old.total || 0;
      if (present > old_present && total > old_total) {
        status = "Present";
      } else if (present === old_present && total > old_total) {
        status = "Absent";
      }

      const msg = calculate_attendance_message(c.courseName, present, total, status);
      await send_telegram(msg);
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(new_state));

  commit_and_push();
}

// Schedule the task: Mon-Fri, 10:00-19:40 every 40 min (at :00 and :40), and additionally at 20:00
cron.schedule('0,40 10-19 * * 1-5', async () => {
  await check_attendance();
});

cron.schedule('0 20 * * 1-5', async () => {
  await check_attendance();
});

console.log('Attendance checker scheduler started.');