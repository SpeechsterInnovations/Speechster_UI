// Toast sound offsets (ms). Positive = play before toast, Negative = delay after toast
const TOAST_SOUND_LEADINS = {
  success:              930,  // 1s before toast
  warning:              100,   // 0.7s before toast
  info   :              300,    // 0.3s before toast
  error  :              1000,
};

// Toast sound sources (host locally in /sounds/toasts/)
const TOAST_SOUNDS = {
  success:              "/sounds/toasts/success.mp3",
  error  :              "/sounds/toasts/error.mp3",
  warning:              "/sounds/toasts/error.mp3",
  info   :              "/sounds/toasts/info.mp3",
};

// Centralized Toast Event Map
const ToastEvents = {
  BLE_CONNECTED: {
    type: "success",
    title: "Bluetooth Connected",
    body: "Speechster device is now connected via Bluetooth and WiFi!"
  },
  WIFI_FAIL: {
    type: "error",
    title: "Wi-Fi Failed",
    body: "Could not connect to the network. Please check your credentials."
  },
  SESSION_SAVED: {
    type: "success",
    title: "Session Saved",
    body: "All session data was stored safely."
  },
  LOGIN_SUCCESS: {
    type: "success",
    title: "Login Successful",
    body: "Welcome back to Speechster!"
  },
  LOGIN_FAILED: {
    type: "warning",
    title: "Login Failed",
    body: "Incorrect credentials or user not found."
  },
  // Add more as needed...
};


function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.AudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

// Add a constant to hold the silent audio element
const silenceAudio = document.getElementById("silence");

// Application State
const AppState = {
  currentScreen: 'auth-screen',
  isAuthenticated: false,
  user: null,
  selectedPatientId: null,
  debugMode: false,
  patientData: null,
  scores: {
    practice: 0,
    level1: 0,
    level2: 0,
  },
};

const ExpectedWords = {
  "practice-screen": ["no"],
  "level-screen-1": [],
  "level-screen-2": ["one"]
};

// Unlock audio on first interaction and start silent sound
["click", "touchstart", "keydown"].forEach(evt => {
  window.addEventListener(evt, () => {
    initAudioContext();
    if (silenceAudio) {
      silenceAudio.play();
    }
  }, { once: true });
});


// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC4o7uIHSqRChe0k5LZOfnFDCr-vBWoqvY",
  authDomain: "speechster-1000.firebaseapp.com",
  databaseURL: "https://speechster-1000-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "speechster-1000",
  storageBucket: "speechster-1000.firebasestorage.app",
  messagingSenderId: "543492593404",
  appId: "1:543492593404:web:df0f06a3db1af716626979",
  measurementId: "G-RM7GFYFZB9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Export to global scope for other scripts
window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDB = db;
window.firebaseModules = {
  ref,
  set,
  get,
  update,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  onValue,
  db,
  uploadFile,
  retrieveFile,
  writeToDB,
  writeToDB_DEPRICATED,
  handleLogout,
  selectPatient,
  unassignPatient,
  increaseScore,
  saveDBData,
  AppState,
};

// DOM Elements
const elements = {
  screens: document.querySelectorAll('.screen'),
  loginForm: document.getElementById('login-form'),
  registerForm: document.getElementById('register-form'),
  loginMessage: document.getElementById('login-message'),
  registerMessage: document.getElementById('register-message'),
  logoutBtn: document.getElementById('logout-btn'),
  practiceCount: document.getElementById('practice-count'),
  practiceFeedback: document.getElementById('practice-feedback'),
  lightModeBtn: document.getElementById('light-mode-btn'),
  darkModeBtn: document.getElementById('dark-mode-btn'),
  practiceScreen: document.getElementById('practice-screen'),
  level1Screen: document.getElementById('level-screen-1'),
  level2Screen: document.getElementById('level-screen-2'),
  backgroundAudio: document.getElementById('background-audio'),
  soundSettings: document.getElementById('sound-settings'),
  soundSettingsBackBtn: document.getElementById('sound-settings-back'),
  practiceScoreDisplay: document.getElementById('practice-score'),
  level1ScoreDisplay: document.getElementById('level-1-score'),
  level2ScoreDisplay: document.getElementById('level-2-score'),
  connectBluetoothBtn: document.getElementById('bt-connect-btn'),
  patientSelectionScreen: document.getElementById('patient-selection-screen'),
  patientDashboard: document.getElementById('patient-dashboard'),
};

// --- Global Audio Amplification Setup ---
let audioCtx = new (window.AudioContext || window.AudioContext)();
const gainNode = audioCtx.createGain();
gainNode.gain.value = 1.0; // default = normal volume
gainNode.connect(audioCtx.destination);

// Unlock AudioContext on first user click (autoplay policy)
["click", "touchstart", "keydown"].forEach(evt => {
  window.addEventListener(evt, () => {
    if (audioCtx.state === "suspended") audioCtx.resume();
  }, { once: true });
});

// Connect background music through gainNode
const backgroundSource = audioCtx.createMediaElementSource(elements.backgroundAudio);
backgroundSource.connect(gainNode);

// --- Volume Slider Integration ---
const volumeSlider = document.getElementById("volume-slider");
if (volumeSlider) {
  volumeSlider.min = 0;
  volumeSlider.max = 200;

  const savedVolume = localStorage.getItem("masterVolume");
  if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    gainNode.gain.value = savedVolume / 100;
  } else {
    volumeSlider.value = 100;
  }

  volumeSlider.addEventListener("input", (e) => {
    const value = e.target.value;
    gainNode.gain.value = value / 100; // 0–200 → 0.0–2.0
    localStorage.setItem("masterVolume", value);
  });
}


// Navigation Functions
// main.js

function animateScreenSwitch(newScreenId) {
  const appContainer = document.getElementById("app-container");
  const currentScreen = document.querySelector(".screen.active");
  const newScreen = document.getElementById(newScreenId);

  if (!appContainer || !newScreen || newScreen === currentScreen) return;

  const startHeight = appContainer.offsetHeight;

  if (currentScreen) currentScreen.classList.remove("active");
  newScreen.classList.add("active");

  // force reflow
  newScreen.offsetHeight;

  const endHeight = newScreen.offsetHeight;

  appContainer.style.height = startHeight + "px";
  appContainer.offsetHeight; // trigger reflow

  appContainer.style.height = endHeight + "px";

  const onTransitionEnd = (e) => {
    if (e.propertyName === "height") {
      appContainer.style.height = "auto";
      appContainer.removeEventListener("transitionend", onTransitionEnd);
    }
  };
  appContainer.addEventListener("transitionend", onTransitionEnd);
}


// Function to navigate between screens
function navigateToScreen(screenId) {
  // Get all screens and the main app container
  const allScreens = document.querySelectorAll('.screen');
  const appContainer = document.getElementById('app-container');

  // First, hide all screens by setting their display to 'none'
  allScreens.forEach(screen => {
    screen.style.display = 'none';
  });

  // Then, set the main app container to 'block' to make sure it's visible and doesn't collapse
  if (appContainer) {
    appContainer.style.display = 'block';
  }

  // Finally, show the specific screen you want to navigate to
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.style.display = 'block';
    AppState.currentScreen = screenId;
    console.log(`Navigated to screen: ${screenId}`);
  } else {
    console.error(`Screen with ID "${screenId}" not found.`);
    showToast("error", `Screen with ID "${screenId}" not found.`, "critical error");
  }
}

// Back button handlers
function setupBackButtons() {
  const backButtons = document.querySelectorAll('.back-btn');
  backButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToScreen('mode-selection-screen');
    });
  });
}

// Message display utility
function showMessage(element, message, isError = true) {
  if (element) {
    element.textContent = message;
    element.style.color = isError ? '#e67c7c' : '#28a745';

    // Auto-clear success messages after 3 seconds
    if (!isError) {
      setTimeout(() => {
        element.textContent = '';
      }, 3000);
    }
  }
}

// File Storage Functions
/**
 * Reads a file and returns its data as a Base64 string.
 * @param {File} file The file to read.
 * @returns {Promise<string>} A promise that resolves with the Base64 string.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

/**
 * Uploads a file as a Base64 string to the Realtime Database.
 * @param {File} file The file to upload.
 * @param {string} filePath The path where the Base64 data will be stored (e.g., 'audio/user-id/recording').
 * @returns {Promise<void>}
 */
async function uploadFile(file, filePath) {
  try {
    const base64Data = await fileToBase64(file);
    await window.firebaseModules.writeToDB(filePath, base64Data);
    console.log("File uploaded successfully to Realtime Database.");
  } catch (error) {
    console.error("Error uploading file:", error);
    throw error;
  }
}

/**
 * Retrieves a file's Base64 string from the Realtime Database.
 * @param {string} filePath The path of the file to retrieve.
 * @returns {Promise<string|null>} A promise that resolves with the Base64 string or null if not found.
 */
async function retrieveFile(filePath) {
  try {
    const fileRef = ref(window.firebaseDB, filePath);
    const snapshot = await get(fileRef);
    if (snapshot.exists()) {
      return snapshot.val();
    } else {
      console.log("No data found at path:", filePath);
      return null;
    }
  } catch (error) {
    console.error("Error retrieving file:", error);
    throw error;
  }
}

// Data Writing Functions

/**
 * Writes data to the database for a specific patient. Only callable by a doctor.
 * @param {string} patientId The ID of the patient.
 * @param {string} folderPath The path of the folder relative to the patient's data node.
 * @param {boolean} isDirectory If true, creates a folder.
 * @param {string} [fileName] The name of the file (required if isDirectory is false).
 * @param {any} [fileContents] The contents to save (required if isDirectory is false).
 */
async function writeToDB_DEPRICATED(patientId, folderPath, isDirectory, fileName, fileContents) {
  // Wait for AppState.user to be populated before running this check
  if (!AppState.user || AppState.user.designation !== 'doctor') {
    console.error('Permission denied: Only doctors can write data to patient profiles.');
    return;
  }

  const { ref, set } = window.firebaseModules;
  const basePath = `users/patients/${patientId}/${folderPath}`;

  if (isDirectory) {
    const folderRef = ref(window.firebaseDB, basePath);
    await set(folderRef, { 'ignore': true });
    console.log(`Folder created at: ${basePath}`);
  } else {
    if (!fileName || typeof fileContents === 'undefined') {
      console.error('Error: fileName and fileContents are required for writing a file.');
      return;
    }
    const fileRef = ref(window.firebaseDB, `${basePath}/${fileName}`);
    await set(fileRef, fileContents);
    console.log(`File '${fileName}' written to: ${basePath}`);
  }
}

/**
 * Writes data to the database at a specified path. Can perform single-path sets or multi-path updates.
 * @param {string} path The full database path (e.g., 'users/patients/patient123/data').
 * @param {any} data The data to be written. Can be a value for a set or an object for a multi-path update.
 */
async function writeToDB(path, data) {
  const { ref, set, update } = window.firebaseModules;

  if (typeof path !== 'string' || !path) {
    console.error('Error: A valid path string is required for writing to the database.');
    return;
  }

  try {
    const dataRef = ref(window.firebaseDB, path);
    if (typeof data === 'object' && data !== null && !Array.isArray(data) && Object.keys(data).length > 1) {
      // If the data object has multiple keys, treat it as a multi-path update
      await update(dataRef, data);
      console.log(`Data updated successfully at path: ${path}`);
    } else {
      // Otherwise, perform a simple set operation
      await set(dataRef, data);
      console.log(`Data set successfully at path: ${path}`);
    }
  } catch (error) {
    console.error(`Error writing data to path '${path}':`, error);
    throw error;
  }
}

/**
 * Saves level score data to the Firebase Realtime Database.
 * @param {string} mode - The level mode to save: 'practice', 'level1', or 'level2'.
 */
async function saveDBData(mode) {
  // Check for a valid patient ID
  if (!AppState.selectedPatientId) {
    showToast("warning", "No patient selected. Cannot save data.");
    return;
  }
  
  // Check if the mode is valid and has an associated score
  if (!AppState.scores.hasOwnProperty(mode)) {
    showToast("error", `Invalid mode provided: ${mode}. Cannot save data.`, "critical error");
    return;
  }

  const patientId = AppState.selectedPatientId;
  const sessionId = `session-${new Date().getTime()}`;
  const path = `users/patients/${patientId}/data/${mode}/${sessionId}`;

  if (mode === "practice") {
    try {
      const payload = {
      "successSpoken": AppState.scores[mode],
      }

      await writeToDB(path, payload);
      triggerToast("SESSION_SAVED")

  } catch (error) {
      console.error("Failed to save data:", error);
      showToast("error", "Failed to save data. See console for details.", "critical error");
    }

  } else if (mode === "level1") {
    try {
      const payload = {
      "successTouch": AppState.scores[mode],
      }

      await writeToDB(path, payload);
      showToast("success", `Data saved for ${mode} (${sessionId})`);

  } catch (error) {
      console.error("Failed to save data:", error);
      showToast("error", "Failed to save data. See console for details.", "critical error");
    }
  } else if (mode === "level2") {
    try {
      const payload = {
      "successSpoken": AppState.scores[mode],
      }

      await writeToDB(path, payload);
      showToast("success", `Data saved for ${mode} (${sessionId})`);

  } catch (error) {
      console.error("Failed to save data:", error);
      showToast("error", "Failed to save data. See console for details.", "critical error");
    }
  }
} 


// Authentication Functions
async function handleLogin(email, password) {
  try {
    const { signInWithEmailAndPassword } = window.firebaseModules;
    await signInWithEmailAndPassword(window.firebaseAuth, email, password);
    triggerToast("LOGIN_SUCCESS")
    console.log("Logged in as", email)
    return true;
  } catch (error) {
    console.error('Login error:', error);

    let errorMessage = 'Login failed. Please try again.';
    if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/user-disabled') {
      errorMessage = 'This account has been disabled.';
    } else if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found with this email.';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Incorrect password.';
    }

    showToast('error',errorMessage, "login failed")
    return false;
  }
}

async function handleRegistration(username, email, password, designation) {
  try {
    const { createUserWithEmailAndPassword } = window.firebaseModules;
    const userCredential = await createUserWithEmailAndPassword(
      window.firebaseAuth, email, password,
    );

    // Save user data to the correct, designation-specific path using writeToDB
    const userPath = `users/${designation}s/${userCredential.user.uid}`;
    await window.firebaseModules.writeToDB(userPath, {
      username,
      email,
      designation,
      createdAt: Date.now()
    });

    // If the new user is a patient, create their base data folders
    if (designation === 'patient') {
      const patientDataPath = `users/patients/${userCredential.user.uid}/data`;
      await window.firebaseModules.writeToDB(`${patientDataPath}/levels/level1`, { 'placeholder': true });
      await window.firebaseModules.writeToDB(`${patientDataPath}/levels/level2`, { 'placeholder': true });
      await window.firebaseModules.writeToDB(`${patientDataPath}/Practice`, { 'placeholder': true });
      await window.firebaseModules.writeToDB(`${patientDataPath}/Settings`, { 'placeholder': true });
    }

    await handleLogin(email, password);
    showToast('success','Registration successful! Redirecting...');
    // showMessage(elements.registerMessage, 'Registration successful! Redirecting...', false);


    return true;

  } catch (error) {
    console.error('Registration error:', error);

    let errorMessage = 'Registration failed. Please try again.';
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'This email is already registered.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password should be at least 6 characters.';
    }

    showMessage(elements.registerMessage, errorMessage);
    return false;
  }
}

async function handleLogout() {
  try {
    const { signOut } = window.firebaseModules;
    await signOut(window.firebaseAuth);
    console.log("Successfully Logged Out.")
    showToast("success","Successfully Logged Out")
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Logout error:', error);
    showToast("error",'Logout failed. Please try again.', "critical error");
  }
}

// Theme Management
function setupThemeSwitcher() {
  if (elements.lightModeBtn) {
    elements.lightModeBtn.addEventListener('click', () => {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light-mode');
    });
  }

  if (elements.darkModeBtn) {
    elements.darkModeBtn.addEventListener('click', () => {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark-mode');
    });
  }

  // Load saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.body.classList.add(savedTheme);
  }
}

// Mode Selection Handlers
function setupModeSelection() {
  const practiceBtn = document.getElementById('practice-mode-btn');
  const levelBtn = document.getElementById('level-mode-btn');
  const level1Btn = document.getElementById('level-mode-btn-1');
  const level2Btn = document.getElementById('level-mode-btn-2');
  const settingsBtn = document.getElementById('settings-btn');
  const soundSettingsBtn = document.getElementById('sound-settings-btn')
  const patientSelectBtn = document.getElementById('patient-select-btn');

  if (practiceBtn) {
    practiceBtn.addEventListener('click', () => navigateToScreen('practice-screen'));
  }

  if (levelBtn) {
    levelBtn.addEventListener('click', () => navigateToScreen('level-selection-screen'));
  }

  if (level1Btn) {
    level1Btn.addEventListener('click', () => navigateToScreen('level-screen-1'));
  }

  if (level2Btn) {
    level2Btn.addEventListener('click', () => navigateToScreen('level-screen-2'));
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => navigateToScreen('settings-screen'));
  }

  if (soundSettingsBtn) {
    soundSettingsBtn.addEventListener('click', () => navigateToScreen('sound-settings'))
  }

  if (patientSelectBtn) {
    patientSelectBtn.addEventListener('click', () => navigateToScreen('patient-selection-screen'));
  }

  // New Timer Logic for levels
  const level1StartBtn = document.getElementById('ready-btn');
  const level1TimerDisplay = document.getElementById('level-1-timer');
  const level2StartBtn = document.getElementById('start-level-2');
  const level2TimerDisplay = document.getElementById('level-2-timer');

  if (level1StartBtn) {
    level1StartBtn.addEventListener('click', () => {
      // level 1 Timer: 3 minutes (180 seconds)
      startTimer(180, level1TimerDisplay);
    });
  }

  if (level2StartBtn) {
    level2StartBtn.addEventListener('click', () => {
      // level 2 Timer: 1 minute (60 seconds)
      startTimer(60, level2TimerDisplay);
    });
  }
}

function startTimer(duration, display) {
  let timer = duration;
  let minutes, seconds;
  const levelInterval = setInterval(() => {
    minutes = parseInt(timer / 60, 10);
    seconds = parseInt(timer % 60, 10);

    minutes = minutes < 10 ? "0" + minutes : minutes;
    seconds = seconds < 10 ? "0" + seconds : seconds;

    display.textContent = minutes + ":" + seconds;

    if (--timer < 0) {
      clearInterval(levelInterval);
      display.textContent = "00:00";
      console.log("Time's up!");
      // Add any end-of-level logic here
    }
  }, 1000);
}

// Debug Mode

function createDebugButton(text) {
  const button = document.createElement('button');
  button.textContent = text;
  button.classList.add('btn', 'debug-btn');
  return button;
}

window.enableDebugMode = function() {
  if (AppState.debugMode) {
    console.log("Debug mode is already enabled.");
    return;
  }
  AppState.debugMode = true;
  console.log("Debug mode enabled. 'Increase Score' buttons should appear on Practice, level 1, and level 2 screens.");

  const practiceScoreDisplay = document.getElementById('practice-count');
  const level1ScoreDisplay = document.getElementById('level-1-score');
  const level2ScoreDisplay = document.getElementById('level-2-score');

  // Add "Increase Score" button to Practice Mode
  const practiceDebugBtn = createDebugButton("Increase Score");
  elements.practiceScreen.querySelector('.button-container').appendChild(practiceDebugBtn);
  practiceDebugBtn.addEventListener('click', async () => {
    const sessionId = `session-${Date.now()}`;
    if (AppState.selectedPatientId && sessionId) {
      const scoreRef = ref(window.firebaseDB, `users/patients/${AppState.selectedPatientId}/data/practice/sessions/${sessionId}/correctAttemps`);
      const snapshot = await get(scoreRef);
      const currentScore = snapshot.exists() ? snapshot.val() : 0;
      const path = `users/patients/${AppState.selectedPatientId}/data/practice/sessions/${sessionId}`;
      const data = { correctAttemps: currentScore + 10 };
      await writeToDB(path, data);
      practiceScoreDisplay.textContent = (parseInt(practiceScoreDisplay.textContent, 10) || 0) + 10;
      console.log(`Score increased for Practice Mode. New score: ${parseInt(practiceScoreDisplay.textContent, 10)}`);
    }
  });

  // Add "Increase Score" button to level 1
  const level1DebugBtn = createDebugButton("Increase Score");
  elements.level1Screen.querySelector('.button-container').appendChild(level1DebugBtn);
  level1DebugBtn.addEventListener('click', async () => {
    const sessionId = `session-${Date.now()}`;
    if (AppState.selectedPatientId && sessionId) {
      const scoreRef = ref(window.firebaseDB, `users/patients/${AppState.selectedPatientId}/data/levels/level1/sessions/${sessionId}/finalScore`);
      const snapshot = await get(scoreRef);
      const currentScore = snapshot.exists() ? snapshot.val() : 0;
      const path = `users/patients/${AppState.selectedPatientId}/data/levels/level1/sessions/${sessionId}`;
      const data = { finalScore: currentScore + 10 };
      await writeToDB(path, data);
      level1ScoreDisplay.textContent = (parseInt(level1ScoreDisplay.textContent, 10) || 0) + 10;
      console.log(`Score increased for level 1. New score: ${parseInt(level1ScoreDisplay.textContent, 10)}`);
    }
  });

  // Add "Increase Score" button to level 2
  const level2DebugBtn = createDebugButton("Increase Score");
  elements.level2Screen.querySelector('.button-container').appendChild(level2DebugBtn);
  level2DebugBtn.addEventListener('click', async () => {
    const sessionId = `session-${Date.now()}`;
    if (AppState.selectedPatientId && sessionId) {
      const scoreRef = ref(window.firebaseDB, `users/patients/${AppState.selectedPatientId}/data/levels/level2/sessions/${sessionId}/finalScore`);
      const snapshot = await get(scoreRef);
      const currentScore = snapshot.exists() ? snapshot.val() : 0;
      const path = `users/patients/${AppState.selectedPatientId}/data/levels/level2/sessions/${sessionId}`;
      const data = { finalScore: currentScore + 10 };
      await writeToDB(path, data);
      level2ScoreDisplay.textContent = (parseInt(level2ScoreDisplay.textContent, 10) || 0) + 10;
      console.log(`Score increased for level 2. New score: ${parseInt(level2ScoreDisplay.textContent, 10)}`);
    }
  });
};


// Initialize the application
function initApp() {
  // Set up event listeners
  if (elements.loginForm) {
    elements.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      await handleLogin(email, password);
    });

  // Is Bluetooth Supported?
  isBluetoothSupported();
  }

  if (elements.registerForm) {
    elements.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('register-username').value;
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const designation = document.getElementById('register-designation').value;
      await handleRegistration(username, email, password, designation);
    });
  }

  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', handleLogout);
  }

  // Set up navigation
  setupBackButtons();
  setupModeSelection();
  setupThemeSwitcher();

  // Handle browser back/forward navigation
  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.screen) {
      navigateToScreen(event.state.screen);
    }
  });

  // Check initial hash for deep linking
  const initialHash = window.location.hash.substring(1);
  if (initialHash && document.getElementById(initialHash)) {
    navigateToScreen(initialHash);
  }

  navigateToScreen(AppState.currentScreen);

  // Monitor auth state
  const { onAuthStateChanged, ref, get } = window.firebaseModules;

  onAuthStateChanged(window.firebaseAuth, async (user) => {
    if (user) {
      AppState.isAuthenticated = true;
      AppState.user = { uid: user.uid, email: user.email };

      let userRef;
      let snapshot;
      let userData;

      // Try to get user data from the 'patients' path
      userRef = ref(window.firebaseDB, `users/patients/${user.uid}`);
      snapshot = await get(userRef);
      if (snapshot.exists()) {
        userData = snapshot.val();
        AppState.user = { ...AppState.user, ...userData };
        if (AppState.user.designation === 'patient') {
          fetchPatientData(); // Correct placement and no UID argument
          displayPatientData();
          navigateToScreen('patient-dashboard-screen');
          return;
        }
      }

      // If not found in 'patients', try the 'doctors' path
      if (!userData) {
        userRef = ref(window.firebaseDB, `users/doctors/${user.uid}`);
        snapshot = await get(userRef);
        if (snapshot.exists()) {
          userData = snapshot.val();
          AppState.user = { ...AppState.user, ...userData };
          if (AppState.user.designation === 'doctor') {
            navigateToScreen('mode-selection-screen');
            fetchAndPopulatePatients();
            return;
          } else if (AppState.user.designation === 'patient') {
            fetchPatientData(); // Correct placement and no UID argument
            displayPatientData();
            navigateToScreen('patient-dashboard-screen');
            return;
          }
        }
      }

      if (!userData) {
        navigateToScreen('no-user-found-screen');
      }

    } else {
      AppState.isAuthenticated = false;
      AppState.user = null;
      if (AppState.currentScreen !== 'auth-screen') {
        navigateToScreen('auth-screen');
      }
    }
  });
}

/**
 * Plays an audio element or URL through the global gainNode.
 * @param {HTMLAudioElement|string} input - Audio element or URL.
 */
function playSound(input) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  if (typeof input === "string") {
    // Play sound from URL
    fetch(input)
      .then(r => r.arrayBuffer())
      .then(buf => audioCtx.decodeAudioData(buf))
      .then(buffer => {
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        source.start(0);
      })
      .catch(err => console.error("Error loading sound:", err));
  } else if (input instanceof HTMLMediaElement) {
    // Play <audio> element
    input.play().catch(err => console.error("Error playing media element:", err));
  }
}


// ---------------------------
// Toast Notification System
// ---------------------------

function playToastSound(type) {
  const url = TOAST_SOUNDS[type];
  if (!url) return;

  if (!audioCtx) {
    // fallback for browsers that don’t need unlock
    playSound(url);
    return;
  }

  fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(buffer => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      source.start(0);
    });
}


function showToast(type, message, header) {
  const container = document.getElementById("toast-container");

  // Create toast element (but don’t attach yet!)
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "ℹ️";
  if (type === "success") icon = "✅";
  if (type === "error")   icon = "❌";
  if (type === "warning") icon = "⚠️";
  if (type === "critical error") icon = "❗";

  if (header === undefined) header = type;
 
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div>
      <div class="toast-header">${header.toUpperCase()}</div>
      <div class="toast-body">${message}</div>
    </div>
  `;

  const leadIn = TOAST_SOUND_LEADINS[type] ?? 0;

  if (leadIn < 0) {
    // 🔊 Play sound *before* toast
    playToastSound(type);
    setTimeout(() => container.appendChild(toast), Math.abs(leadIn));
  } else {
    // ⏱️ Delay toast until after sound
    setTimeout(() => {
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 5500);
    }, leadIn);
    playToastSound(type);
  }
}

/**
 * Fires a pre-mapped toast event.
 * Example: triggerToast("BLE_CONNECTED");
 */
function triggerToast(eventKey) {
  const t = ToastEvents[eventKey];
  if (!t) {
    console.warn(`⚠️ Unknown toast event: ${eventKey}`);
    return;
  }
  showToast(t.type, t.body, t.title);
}


// -----------------
// Background Sound
// -----------------

elements.backgroundAudio.volume = 0.5;

document.addEventListener('click', function() {
  playSound(elements.backgroundAudio);
});

// ---------------------------
// Doctor High-Level Commands
// ---------------------------
async function assignPatient(patientId) {
  if (!AppState.user || AppState.user.designation !== 'doctor') {
    showToast("error", "Only doctors can assign patients.", "critical error");
    return {
      success: false,
      message: 'Not authorized'
    };
  }
  try {
    const doctorId = AppState.user.uid;
    await writeToDB(`users/doctors/${doctorId}/assignedPatients/${patientId}`, true);
    await writeToDB(`users/patients/${patientId}/data/assignedTo`, doctorId);
    showToast("success", `Patient ${patientId} assigned`);
    AppState.selectedPatientId = patientId; // Corrected line
    return {
      success: true,
      doctorId,
      patientId
    };
  } catch (err) {
    console.error(err);
    showToast("error", "Failed to assign patient (check Console Logs!)", "critical error");
    return {
      success: false,
      message: err.message
    };
  }
}

async function unassignPatient(patientId) {
  if (!AppState.user || AppState.user.designation !== 'doctor') {
    showToast("error", "Only doctors can unassign patients.", "critical error");
    return { success: false, message: 'Not authorized' };
  }
  try {
    const doctorId = AppState.user.uid;
    const updates = {};
    updates[`users/doctors/${doctorId}/assignedPatients/${patientId}`] = null;
    updates[`users/patients/${patientId}/data/assignedTo`] = null;
    await writeToDB('/', updates);
    showToast("success", `Patient ${patientId} unassigned.`);
    return { success: true, doctorId, patientId };
  } catch (err) {
    console.error(err);
    showToast("error", "Failed to unassign patient.");
    return { success: false, message: err.message };
  }
}

function selectPatient(patientId) {
  AppState.selectedPatientId = patientId;
  showToast("info", `Selected patient: ${patientId}`);
  return { success: true, patientId };
}

// --------------------------
// Patient Dashboard System
// --------------------------

function fetchPatientData() {
  const userId = AppState.user.uid;
  if (!userId) {
    console.error("User ID is not available.");
    showToast("error", "Please log in to view data.", "critical error");
    return;
  }

  // CORRECTED LINE: Use the ref() function with the firebaseDB instance
  const dbRef = ref(window.firebaseDB, 'users/patients/' + userId + '/data');

  onValue(dbRef, (snapshot) => {
    const data = snapshot.val();
    AppState.patientData = data;
    displayPatientData();
  }, (error) => {
    console.error("Error fetching patient data:", error);
    showToast("error", "Failed to load patient data.", "error");
  });
}


function displayPatientData() {
  const sessionList = document.getElementById('session-list');
  
  // Clear any existing content
  sessionList.innerHTML = '';
  
  // Check if patientData exists and is not empty
  if (AppState.patientData) {
    // Convert the data object to a formatted JSON string
    const dataString = JSON.stringify(AppState.patientData, null, 2);
    
    // Create a <pre> tag to preserve formatting and display the raw JSON
    const preElement = document.createElement('pre');
    preElement.textContent = dataString;
    
    // Append the element to the session list container
    sessionList.appendChild(preElement);
    
  } else {
    // Display a message if no data is found
    sessionList.innerHTML = '<li>No data to display.</li>';
  }
}
// --------------------------
// Other Low-Level Functions
// --------------------------

/**
 * Fetches the list of patients from the database and populates the UI.
 * This function uses an onValue listener for real-time updates.
 */
function fetchAndPopulatePatients() {
  const patientListRef = ref(db, 'users/patients');
  const patientListElement = document.getElementById('patient-list');

  onValue(patientListRef, (snapshot) => {
    // Clear the current list to prevent duplicates
    if (patientListElement) {
      patientListElement.innerHTML = '';
    }

    // Check if data exists
    if (snapshot.exists()) {
      const patients = snapshot.val();
      Object.keys(patients).forEach(patientId => {
        const patientData = patients[patientId];
        const patientUsername = patientData.username || patientId; // Use username if available, otherwise fall back to the ID

        // Create a button element for each patient
        const patientBtn = document.createElement('button');
        patientBtn.className = 'btn patient-btn';
        patientBtn.textContent = patientUsername;
        
        // Store the patient ID and name for later use
        patientBtn.dataset.patientId = patientId;
        patientBtn.dataset.patientUsername = patientUsername;

        // Add a click listener to select the patient
        patientBtn.addEventListener('click', () => {
          selectPatient(patientId, patientUsername);
        });

        if (patientListElement) {
          patientListElement.appendChild(patientBtn);
        }
      });
      console.log("Patient list populated successfully.");
    } else {
      // If no patients exist, display a message
      const noPatientsMessage = document.createElement('p');
      noPatientsMessage.textContent = "No patients found.";
      if (patientListElement) {
        patientListElement.appendChild(noPatientsMessage);
      }
      console.log("No patients found in the database.");
    }
  }, {
    // Optional: handle errors
    error: (error) => {
      console.error("Error fetching patients:", error);
      showToast("error", "Failed to fetch patients. See console for details.", "critical error");
     }
  });
}

// --------------------------
// level Score Functions
// --------------------------

function updateScoreDisplay() {
  elements.practiceScoreDisplay.textContent = AppState.scores.practice;
  elements.level1ScoreDisplay.textContent = AppState.scores.level1;
  elements.level2ScoreDisplay.textContent = AppState.scores.level2;
}

/**
 * Increases the score for a specific level mode, provided it's currently active.
 * @param {string} levelmode - The level mode for which to increase the score.
 */
function increaseScore(levelmode) {
    AppState.scores[levelmode]++;
    updateScoreDisplay();
    if (AppState.scores[levelmode]%10 == 0) {
      showToast("success", `Score for ${levelmode} is now: ${AppState.scores[levelmode]}, a multiple of 10!`);
      return;
    }

    showToast("info", `Score for ${levelmode} is now: ${AppState.scores[levelmode]}`);
}

//---------------------
// Bluetooth Functions
//--------------------

/**
 * Checks if the Web Bluetooth API is supported by the browser.
 * @returns {boolean} True if supported, false otherwise.
 */
function isBluetoothSupported() {
  console.log("Checking BT Support")
  if (!('bluetooth' in navigator)) {
    showToast("error", "Chrome with Web Bluetooth API Enabled is REQUIRED to use Bluetooth-based services.", "critical error")
    console.log("BT Unsupported.")
    return;
  }
  console.log("BT Avail")
}

// ────────────────────────────────
// SPEECHSTER BROWSER BLE BRIDGE
// ────────────────────────────────

let bleDevice = null;
let gattServer = null;
let bleService = null;
let writeChar = null;
let notifyChar = null;

const SERVICE_UUID     = "0000feed-0000-1000-8000-00805f9b34fb";
const WRITE_CHAR_UUID  = "feed0001-0010-0000-8000-00805f9b34fb";
const NOTIFY_CHAR_UUID = "feed0002-0010-0000-8000-00805f9b34fb";

// ───────────────────────────────
// Strict LAN IP Discovery Utility
// ───────────────────────────────
async function getLocalIPAddress(timeout = 3000) {
  return new Promise((resolve) => {
    let foundIP = null;
    const pc = new RTCPeerConnection({ iceServers: [] });

    pc.createDataChannel("ipcheck");
    pc.onicecandidate = (evt) => {
      if (!evt.candidate) return;
      const cand = evt.candidate.candidate;
      // Extract ONLY IPv4 addresses
      const ipMatch = cand.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (ipMatch) {
        foundIP = ipMatch[1];
        resolve(foundIP);
        pc.close();
      }
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => resolve(null));

    // timeout fallback
    setTimeout(() => {
      if (!foundIP) {
        resolve(null);
        try { pc.close(); } catch {}
      }
    }, timeout);
  });
}

// ----------------------------
// BLE Notification Handler
// ----------------------------
function handleNotification(event) {
  try {
    // Read raw data from BLE characteristic
    const value = event.target.value;
    const decoder = new TextDecoder("utf-8");
    const decoded = decoder.decode(value);
    console.log("BLE Notification (raw):", decoded);

    // Try to parse as JSON (ESP usually sends small JSONs like {"status":"ok"})
    let msg = null;
    try {
      msg = JSON.parse(decoded);
    } catch {
      // not JSON → show as plain text
      showToast("info", decoded);
      return;
    }

    // Handle known message types
    if (msg.status) {
      showToast("info", `ESP Status: ${msg.status}`);
    }

    if (msg.wifi && msg.wifi === "connected") {
      triggerToast("BLE_CONNECTED");
    } else if (msg.wifi && msg.wifi === "failed") {
      triggerToast("WIFI_FAIL")
    }

    if (msg.ota) {
      showToast("info", `OTA: ${msg.ota}`);
    }

    if (msg.ai_result) {
      handleAIResult(msg.ai_result);
    }

    // Catch-all log for debugging
    console.log("Parsed BLE message:", msg);

  } catch (error) {
    console.error("Notification handling error:", error);
    showToast("error", "Error processing BLE notification");
  }
}


// Connect Button - Main Page

document.getElementById("wifi-take-btn").addEventListener("click", async () => {
  navigateToScreen("wifi-setup-screen")
})

// Connect button - WiFi Page
document.getElementById("bt-connect-btn").addEventListener("click", async (event) => {
  event.preventDefault();

  const ssid = document.getElementById("wifi-ssid").value;
  const pass = document.getElementById("wifi-pass").value;

  if (!ssid || !pass) {
    showToast("warning", "Please enter both SSID and password");
    return;
  }

  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "Speechster" }],
      optionalServices: [SERVICE_UUID],
    });

    showToast("info", `Connecting to ${bleDevice.name}...`);
    gattServer = await bleDevice.gatt.connect();

    bleService = await gattServer.getPrimaryService(SERVICE_UUID);
    writeChar = await bleService.getCharacteristic(WRITE_CHAR_UUID);
    notifyChar = await bleService.getCharacteristic(NOTIFY_CHAR_UUID);

    await notifyChar.startNotifications();
    notifyChar.addEventListener("characteristicvaluechanged", handleNotification);

    showToast("success", `Connected to ${bleDevice.name}`);
    showToast("info", "Attempting to Send WiFi Credentials")

    await sendBLECommand({ ssid, pass });
    showToast("success", `Sent Wi-Fi credentials for ${ssid}`);
    navigateToScreen("mode-selection-screen")

  } catch (error) {
    console.error("Bluetooth Connection Error:", error);
    showToast("error", "Failed to connect to device.");
  }
});

let bleFirstMessageSent = false;

async function sendBLECommand(command) {
  const backendUrl = window.location.origin;
  const hostname = window.location.hostname;
  const port = 8080 // window.location.port || (window.location.protocol === "https:" ? "443" : "80"); <-- OLD CODE (DOESNT WORK)

  let hostIP = hostname;

  // Detect LAN IP only if needed
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    /^[a-zA-Z]+$/.test(hostname)
  ) {
    console.log("Attempting to detect LAN IP...");
    const ip = await getLocalIPAddress();
    if (ip) {
      hostIP = ip;
      console.log("Detected LAN IP:", ip);
    } else {
      console.warn("Could not detect LAN IP. Using default hostname.");
    }
  }

  // ✅ Only include host_ip/host_port if first message (ssid+pass)
  let fullCommand;
  if (!bleFirstMessageSent && command.ssid && command.pass) {
    fullCommand = { ...command, host_ip: hostIP, host_port: String(port) };
    bleFirstMessageSent = true; // Prevent future inclusion
  } else {
    fullCommand = { ...command };
  }

  // BLE send
  if (writeChar) {
    try {
      const json = new TextEncoder().encode(JSON.stringify(fullCommand));
      await writeChar.writeValue(json);
      console.log("Sent via BLE:", fullCommand);
    } catch (err) {
      console.error("BLE write failed:", err);
    }
  }

  // Optional: send to backend
  try {
    await fetch(`${backendUrl}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: "speechster_b1_s3",
        command: fullCommand,
      }),
    });
    console.log("Pushed command to backend:", fullCommand);
  } catch (err) {
    console.error("Failed to push command to backend:", err);
  }
}

const wsHost = window.location.hostname === "0.0.0.0" ? "localhost" : window.location.hostname;
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port ? `:${window.location.port}` : "";
const ws = new WebSocket(`${wsProtocol}//${wsHost}${wsPort}/ws`);
window.ws = ws;


// Keep track of last accepted word timestamps
const lastWordTimes = {};

// Minimum delay (ms) between valid detections of the same word
const DETECTION_COOLDOWN_MS = 2000;
// Helper to translate screen IDs into scoring modes
function getModeFromScreen(screenId) {
  if (screenId === "practice-screen") return "practice";
  if (screenId === "level-screen-1") return "level1";
  if (screenId === "level-screen-2") return "level2";
  return "practice"; // fallback
}

ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data);

  if (event.type === "esp.ai_result") {
    const { label, confidence } = event.payload;
    const pct = Math.round(confidence * 100);
    const currentScreen = AppState.currentScreen;
    const expectedWords = ExpectedWords[currentScreen] || [];
    const now = Date.now();

    // Debounce: ignore duplicates too soon
    if (lastWordTimes[label] && now - lastWordTimes[label] < DETECTION_COOLDOWN_MS) {
      console.log(`⏱️ Ignored repeated "${label}" (cooldown active)`);
      return;
    }

    // Check if the detected word is expected
    if (expectedWords.includes(label.toLowerCase()) && confidence >= 0.75) {
      console.log(`✅ Correct word detected for ${currentScreen}: ${label} (${pct}%)`);
      increaseScore(getModeFromScreen(currentScreen));
      lastWordTimes[label] = now; // mark as recently accepted
    } else {
      console.log(`❌ Incorrect or low-confidence word: ${label} (${pct}%)`);
    }
  }
};

// Called whenever AI inference is received or stubbed
function handleAIResult(data) {
  const output = document.getElementById("cnn-output");
  if (output) {
    const pct = Math.round((data.confidence || 0) * 100);
    output.textContent = `Detected: ${data.label} (${pct}%)`;
  }
  console.log("AI Result:", data);
}

// ---------------------------
// Add commands to global scope
// ---------------------------
Object.assign(window.firebaseModules, {
  assignPatient,
  unassignPatient,
  selectPatient,
  showToast,
  navigateToScreen,
  sendBLECommand,
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp)
