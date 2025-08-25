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

// Session management
let currentSession = null;
let lastLoginAttempt = null;
let loginAttempts = 0;
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_COOLDOWN = 30 * 60 * 1000; // 30 minutes
const SESSION_RENEWAL_THRESHOLD = 20 * 60 * 60 * 1000; // 20 hours

// Cache for failed login attempts
const loginCache = {
  attempts: 0,
  lastAttempt: null,
  resetTime: null
};

function canAttemptLogin() {
  const now = Date.now();
  
  // If we're in cooldown period after multiple failures
  if (loginCache.resetTime && now < loginCache.resetTime) {
    console.log(`Login cooldown active. Wait ${Math.ceil((loginCache.resetTime - now) / 1000 / 60)} minutes`);
    return false;
  }

  // If we've made too many attempts recently
  if (lastLoginAttempt && (now - lastLoginAttempt) < getBackoffDelay()) {
    console.log(`Login backoff active. Wait ${Math.ceil((getBackoffDelay() - (now - lastLoginAttempt)) / 1000)} seconds`);
    return false;
  }

  // Reset attempts if it's been long enough
  if (lastLoginAttempt && (now - lastLoginAttempt) > LOGIN_COOLDOWN) {
    loginAttempts = 0;
  }

  return true;
}

function getBackoffDelay() {
  // Exponential backoff: 2^attempts * 1000ms (1 second base)
  return Math.min(Math.pow(2, loginAttempts) * 1000, LOGIN_COOLDOWN);
}

async function refreshSession(session) {
  try {
    console.log('Attempting to refresh session before expiry');
    const { auth_pref, token } = await login();
    const newSession = {
      auth_pref,
      token,
      timestamp: new Date().toISOString()
    };
    
    // Save new session to Firebase
    const sessionRef = ref(database, 'session');
    await set(sessionRef, newSession);
    currentSession = newSession;
    loginAttempts = 0; // Reset attempts on successful refresh
    return newSession;
  } catch (error) {
    console.error('Session refresh failed:', error);
    throw error;
  }
}

async function getSession() {
  try {
    // Try to get session from Firebase first
    const sessionRef = ref(database, 'session');
    const snapshot = await get(sessionRef);
    
    if (snapshot.exists()) {
      const session = snapshot.val();
      if (session && session.timestamp) {
        const sessionAge = Date.now() - new Date(session.timestamp).getTime();
        
        // If session is still valid
        if (sessionAge < 23 * 60 * 60 * 1000) {
          console.log('Using existing session');
          currentSession = session;
          
          // If session is approaching expiry, try to refresh it proactively
          if (sessionAge > SESSION_RENEWAL_THRESHOLD) {
            console.log('Session approaching expiry, scheduling renewal');
            // Schedule refresh but don't wait for it
            refreshSession(session).catch(err => {
              console.log('Background session refresh failed:', err);
            });
          }
          
          return session;
        }
      }
    }
    
    // If we reach here, we need a new session
    if (!canAttemptLogin()) {
      if (currentSession) {
        console.log('Reusing last known session despite age');
        return currentSession;
      }
      throw new Error('LOGIN_RATE_LIMITED');
    }
    
    // Check if we should create a new session based on time
    const now = new Date();
    const minutes = now.getMinutes();
    
    // Only create new session at XX:00 or XX:30
    if (minutes === 0 || minutes === 30) {
      console.log('Creating new session at scheduled time');
      
      // Track login attempt
      loginAttempts++;
      lastLoginAttempt = Date.now();
      
      try {
        const { auth_pref, token } = await login();
        currentSession = { 
          auth_pref, 
          token,
          timestamp: new Date().toISOString()
        };
        
        // Reset counters on successful login
        loginAttempts = 0;
        loginCache.attempts = 0;
        loginCache.resetTime = null;
        
        // Save new session to Firebase
        await set(sessionRef, currentSession);
        return currentSession;
      } catch (error) {
        // Handle failed login attempt
        loginCache.attempts++;
        if (loginCache.attempts >= MAX_LOGIN_ATTEMPTS) {
          loginCache.resetTime = Date.now() + LOGIN_COOLDOWN;
          console.log(`Too many failed attempts. Cooling down until ${new Date(loginCache.resetTime)}`);
        }
        throw error;
      }
    } else {
      console.log('Session expired, but waiting for next scheduled login time (XX:00 or XX:30)');
      throw new Error('SESSION_WAIT_SCHEDULED_TIME');
    }
  } catch (error) {
    console.error('Session error:', error);
    throw error;
  }
}

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
    if (error.response) {
      console.error('Server response:', error.response.data);
      // If unauthorized, clear session
      if (error.response.status === 401) {
        console.log('Session expired, clearing session...');
        currentSession = null;
        // Clear session from Firebase
        await set(ref(database, 'session'), null);
        // Don't retry immediately - throw error and let check_attendance handle it
        throw new Error('SESSION_EXPIRED');
      }
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

function calculateAttendanceMessage(course, present, total, status) {
    const percentage = total > 0 ? (present / total * 100) : 0;
    
    let statusEmoji, statusText;
    switch(status) {
        case "Present":
            statusEmoji = "✅";
            statusText = "PRESENT";
            break;
        case "Absent":
            statusEmoji = "❌";
            statusText = "ABSENT";
            break;
        case "Unknown":
            statusEmoji = "⚠️";
            statusText = "UNKNOWN";
            break;
    }
    
    // Main header with course name
    let msg = `📚 *${course}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `${statusEmoji} Status: ${statusText}\n`;
    msg += `📊 Attendance: ${present}/${total} lectures\n`;
    msg += `📈 Percentage: *${percentage.toFixed(1)}%*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (percentage < 75) {
        let x = Math.ceil((0.75 * total - present) / 0.25);
        if (x < 0) x = 0;
        msg += `⚠️ __CRITICAL ALERT__\n`;
        msg += `📉 Below minimum requirement!\n`;
        msg += `🎯 *Action Required:* Attend next ${x} lecture(s)\n`;
    } else {
        let y = Math.floor(present / 0.75 - total);
        if (y < 0) y = 0;
        msg += `✅ __ATTENDANCE SECURE__\n`;
        msg += `🎉 Above 75% requirement!\n`;
        msg += `🏖 *Flexibility:* Can skip up to ${y} lecture(s)\n`;
    }
    
    return msg;
}

// Export all necessary functions
module.exports = {
    calculateAttendanceMessage,
    login,
    fetch_courses,
    send_telegram,
    saveAttendanceState,
    getAttendanceState
};

// Git functionality removed to simplify the bot

async function check_attendance() {
  const currentTime = new Date().toLocaleString('en-US', { 
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'long'
  });
  console.log(`Checking attendance at ${currentTime}`);
  try {
    let session;
    try {
      // Try to get or create session
      session = await getSession();
    } catch (error) {
      if (error.message === 'SESSION_WAIT_SCHEDULED_TIME') {
        console.log('Skipping attendance check until next scheduled login time');
        return; // Exit early, wait for next scheduled check
      }
      throw error; // Re-throw other errors
    }
    
    // Fetch courses using existing session
    const courses = await fetch_courses(session.auth_pref, session.token);
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

        // Case 1: Total days same but present days increased
        if (total === old_total && present > old_present) {
          status = "Unknown";
          console.log(`[${code}] Unusual: Present days increased without total days increasing`);
        }
        // Case 2: Both total and present increased
        else if (total > old_total && present > old_present) {
          status = "Present";
          console.log(`[${code}] Marked Present: Both total and present days increased`);
        }
        // Case 3: Only total increased, present stayed same
        else if (total > old_total && present === old_present) {
          status = "Absent";
          console.log(`[${code}] Marked Absent: Total days increased but present days unchanged`);
        }
        // Case 4: Any other unexpected changes
        else {
          status = "Unknown";
          console.log(`[${code}] Unusual change detected - Old: ${old_present}/${old_total}, New: ${present}/${total}`);
        }

        const msg = calculateAttendanceMessage(c.courseName, present, total, status);
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

    // Schedule to run every 5 minutes
    cron.schedule('*/5 * * * *', runCheck, {
      timezone: "Asia/Kolkata" // Set timezone to IST
    });

    console.log('Attendance checker scheduler started. Will check every 5 minutes during working hours (Mon-Fri, 10 AM - 10 PM IST)');
    
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
