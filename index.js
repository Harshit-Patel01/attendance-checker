require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');

const LOGIN_URL = "https://kiet.cybervidya.net/api/auth/login";

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// Firebase helper functions
async function saveAttendanceState(state) {
  try {
    const attendanceRef = ref(database, 'attendance');
    await set(attendanceRef, {
      state: state,
      lastUpdated: new Date().toISOString()
    });
    console.log('State saved to Firebase');
    
    // Keep local backup
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Error saving to Firebase:', error);
    // Fallback to local file
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
}

async function getAttendanceState() {
  try {
    const attendanceRef = ref(database, 'attendance');
    const snapshot = await get(attendanceRef);
    if (snapshot.exists()) {
      return snapshot.val().state;
    }
    return {};
  } catch (error) {
    console.error('Error reading from Firebase:', error);
    // Fallback to local file
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return {};
  }
}
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

// Git functionality removed to simplify the bot

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
    const prev_state = await getAttendanceState();
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

    await saveAttendanceState(new_state);
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
