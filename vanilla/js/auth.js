import { auth, db, get, onAuthStateChanged, ref, signInWithEmailAndPassword, signOut } from "./firebase.js";
import { DB } from "./constants.js";

/** Current sign-in state. `ready` is false until the first auth check (and role lookup) finishes. */
export const session = { user: null, role: null, ready: false };

async function fetchRole(uid) {
  try {
    return (await get(ref(db, `${DB.roles}/${uid}`))).val()?.role ?? null;
  } catch {
    return null; // no role (or no permission) simply means no access yet
  }
}

export function watchAuth(onChange) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      Object.assign(session, { user: null, role: null, ready: true });
    } else {
      Object.assign(session, { user, ready: false });
      onChange();
      Object.assign(session, { role: await fetchRole(user.uid), ready: true });
    }
    onChange();
  });
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
