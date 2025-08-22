require('dotenv').config();
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
  const userName = process.env.CYBERVIDYA_USERNAME || process.env.USERNAME;
  const password = process.env.PASSWORD;
  const payload = { userName, password };
  
  try {
    console.log('Attempting login...');
    const resp = await axios.post(LOGIN_URL, payload);
    console.log('Login successful');
    return { 
      auth_pref: resp.data.data.auth_pref, 
      token: resp.data.data.token 
    };
  } catch (error) {
    console.error('Login failed:', error.message);
    if (error.response && error.response.data) {
      console.error('Server response:', error.response.data);
    }
    throw error;
  }
}

async function fetch_courses(auth_pref, token) {
  const headers = { Authorization: auth_pref + token };
  try {
    console.log('Fetching courses...');
    const resp = await axios.get(COURSES_URL, { headers });
    console.log('Successfully fetched courses');
    return resp.data.data;
  } catch (error) {
    console.error('Error fetching courses:', error.message);
    if (error.response && error.response.data) {
      console.error('Server response:', error.response.data);
    }
    throw error;
  }
}

async function send_telegram(msg) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: process.env.CHAT_ID, text: msg, parse_mode: "Markdown" };
  try {
    const r = await axios.post(url, payload);
    console.log("Telegram status:", r.data);
  } catch (error) {
    console.error("Error sending telegram message:", error);
    throw error;
  }
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

async function commit_and_push() {
  const execAsync = (command) => {
    console.log(`Executing: ${command}`);
    try {
      const output = execSync(command, { encoding: 'utf8' });
      console.log(`Output: ${output}`);
      return output;
    } catch (error) {
      console.error(`Command failed: ${command}`);
      console.error(`Error: ${error.message}`);
      console.error(`Stdout: ${error.stdout}`);
      console.error(`Stderr: ${error.stderr}`);
      throw error;
    }
  };

  try {
    // Check if we're in a git repository
    try {
      execAsync('git rev-parse --is-inside-work-tree');
    } catch (e) {
      console.log('Not in a git repository, initializing...');
      execAsync('git init');
      execAsync(`git remote add origin git@github.com:${process.env.GITHUB_REPOSITORY}.git`);
    }

    // Add the file and check status
    execAsync(`git add ${STATE_FILE}`);
    const status = execAsync('git status --porcelain').toString();
    
    if (status.includes(STATE_FILE)) {
      // Get the current branch
      let branch;
      try {
        branch = execAsync('git rev-parse --abbrev-ref HEAD').trim();
      } catch (e) {
        console.log('No branch found, creating main branch...');
        execAsync('git checkout -b main');
        branch = 'main';
      }

      const commit_message = `Update attendance state on ${new Date().toISOString()}`;
      execAsync(`git commit -m "${commit_message}"`);
      
      // Try to pull first to avoid conflicts
      try {
        execAsync(`git pull origin ${branch} --rebase`);
      } catch (e) {
        console.log('Pull failed, continuing with push...');
      }

      // Push changes
      execAsync(`git push origin ${branch}`);
      console.log("Changes successfully pushed to the repository.");
    } else {
      console.log("No changes detected in the state file.");
    }
  } catch (error) {
    console.error('Git operation failed:', error);
    // Log the git status and configuration for debugging
    try {
      console.log('\n=== Git Debug Information ===');
      execAsync('git status');
      execAsync('git remote -v');
      execAsync('git config --list');
    } catch (e) {
      console.error('Failed to get debug information:', e);
    }
  }
}

async function check_attendance() {
  const currentTime = new Date().toLocaleString('en-US', { 
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'long'
  });
  console.log(`Checking attendance at ${currentTime}`);
  try {
    const { auth_pref, token } = await login();
    const courses = await fetch_courses(auth_pref, token);

    let prev_state = {};
    if (fs.existsSync(STATE_FILE)) {
      try {
        const stateContent = fs.readFileSync(STATE_FILE, 'utf8');
        prev_state = JSON.parse(stateContent);
      } catch (error) {
        console.error('Error reading state file:', error);
        prev_state = {};
      }
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

    fs.writeFileSync(STATE_FILE, JSON.stringify(new_state, null, 2));
    
    await commit_and_push();
  } catch (error) {
    console.error('Error in check_attendance:', error);
    throw error;
  }
}

function isWithinWorkingHours() {
  // Create a date object with IST timezone
  const istTime = new Date().toLocaleString('en-US', { 
    timeZone: 'Asia/Kolkata'
  });
  const istDate = new Date(istTime);

  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const day = istDate.getDay();
  if (day === 0 || day === 6) {
    console.log('Current day is weekend, skipping check');
    return false; // Skip weekends
  }

  // Get hour in IST (0-23)
  const hour = istDate.getHours();
  const isWorkingHour = hour >= 10 && hour < 22;

  console.log(`Current time in IST: ${istTime}`);
  console.log(`Current hour: ${hour}, Is working hour: ${isWorkingHour}`);

  return isWorkingHour;
}

async function runCheck() {
  console.log('\n=== Checking schedule ===');
  if (isWithinWorkingHours()) {
    console.log('Within working hours, checking attendance...');
    try {
      await check_attendance();
    } catch (error) {
      console.error('Error in scheduled check:', error);
    }
  } else {
    console.log('Outside working hours (Mon-Fri, 10 AM - 10 PM IST), skipping check');
  }
}

async function main() {
  try {
    // Start with a schedule check
    console.log('Attendance checker starting...');
    await runCheck();

    // Schedule to run every 30 minutes
    cron.schedule('*/30 * * * *', runCheck, {
      timezone: "Asia/Kolkata" // Set timezone to IST
    });

    console.log('Attendance checker scheduler started. Will check every 30 minutes during working hours (Mon-Fri, 10 AM - 10 PM IST)');
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('Received SIGINT. Gracefully shutting down...');
      process.exit(0);
    });

    // Prevent the process from exiting
    await new Promise(() => {});
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Start the application
main();
