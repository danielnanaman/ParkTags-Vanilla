// Firebase is loaded straight from Google's CDN as ES modules (no bundler needed).
// To change SDK version, edit FIREBASE_VERSION.
const FIREBASE_VERSION = "12.19.0";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const { initializeApp, getApps } = await import(`${CDN}/firebase-app.js`);
const authSdk = await import(`${CDN}/firebase-auth.js`);
const dbSdk = await import(`${CDN}/firebase-database.js`);

const firebaseConfig = {
  apiKey: "AIzaSyDlowz8JwEwKFSb0gAjwLGHLo3P70_q4YA",
  authDomain: "parktags-a9582.firebaseapp.com",
  databaseURL: "https://parktags-a9582-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "parktags-a9582",
  storageBucket: "parktags-a9582.firebasestorage.app",
  messagingSenderId: "89730867013",
  appId: "1:89730867013:web:892093a538dba9bebf682c",
};

const app = initializeApp(firebaseConfig);
export const db = dbSdk.getDatabase(app);
export const auth = authSdk.getAuth(app);

/** A second app instance, so an admin can create accounts without being signed out. */
export const getSecondaryAuth = () =>
  authSdk.getAuth(getApps().find((a) => a.name === "aux") || initializeApp(firebaseConfig, "aux"));

export const { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } = authSdk;
export const { ref, get, set, push, update, onValue } = dbSdk;
