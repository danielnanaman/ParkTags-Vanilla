import {
  createUserWithEmailAndPassword, db, get, getSecondaryAuth, push, ref, set, signOut, update,
} from "./firebase.js";
import { DB, MAX_VEHICLES_PER_USER, NOT_PARKED, OTHER_TYPE, UNLISTED_VEHICLE } from "./constants.js";
import {
  assertValid, buildOfflineLog, checkField, isStaff, isValidFirebaseKey, normalizePlate, normalizeVehicleType, personErrors,
  resolveOfflineLog, resolveVehicleType, stripArchiveStamp, toPersonRecord, toVehicleRecord, today, vehicleErrors,
} from "./utils.js";

/* ---------------- generic helpers ---------------- */

const readValue = async (path) => (await get(ref(db, path))).val();
const exists = async (path) => (await get(ref(db, path))).exists();
const writeValue = (path, value) => set(ref(db, path), value);
/** Multi-path update from the root; a `null` value deletes that path. Atomic. */
const updatePaths = (paths) => update(ref(db), paths);

const archiveRecord = ({ livePath, archivePath, record, reason, extra }) =>
  updatePaths({
    [archivePath]: { ...record, archived_at: today(), ...(reason && { archived_reason: reason }) },
    [livePath]: null,
    ...extra,
  });

async function restoreRecord({ livePath, archivePath, record, conflictMessage, transform = (r) => r, extra }) {
  if (await exists(livePath)) throw new Error(conflictMessage);
  await updatePaths({ [livePath]: transform(stripArchiveStamp(record)), [archivePath]: null, ...extra });
}

const studentPath = (id) => `${DB.students}/${id}`;
const vehiclePath = (studentId, vehicleId) => `${studentPath(studentId)}/vehicles/${vehicleId}`;
const touchStudent = (id) => ({ [`${studentPath(id)}/last_updated`]: today() });

/* ---------------- vehicle rules ---------------- */

const limitMessage = `A user can have at most ${MAX_VEHICLES_PER_USER} vehicles.`;


/* ---------------- users ---------------- */

export async function registerUser(values) {
  const id = values.id.trim();
  assertValid([...personErrors(values), ...vehicleErrors(values)]);
  if (await exists(studentPath(id))) throw new Error("That Student/Staff ID is already registered");
  await writeValue(studentPath(id), {
    ...toPersonRecord(values),
    date_registered: today(),
    status: "active",
    vehicles: { [values.vehicleId.trim()]: toVehicleRecord(values) },
  });
  return "User added";
}

export async function updateUserProfile(id, values, student) {
  assertValid(personErrors(values, { staff: isStaff(id, student) }));
  await update(ref(db, studentPath(id)), toPersonRecord(values));
  return "Profile updated";
}

export const archiveUser = (id, student) =>
  archiveRecord({ livePath: studentPath(id), archivePath: `${DB.archivedStudents}/${id}`, record: student, reason: "Removed by administrator" });

/** Parked status can't be trusted after time in the archive, so restored vehicles start as "not parked". */
const resetParked = (vehicles) =>
  Object.fromEntries(Object.entries(vehicles).map(([id, v]) => [id, { ...v, current_status: NOT_PARKED }]));

export const restoreUser = (id, archived) =>
  restoreRecord({
    livePath: studentPath(id),
    archivePath: `${DB.archivedStudents}/${id}`,
    record: archived,
    conflictMessage: "An active user with that ID already exists",
    transform: ({ vehicles, ...rest }) => ({ ...rest, last_updated: today(), ...(vehicles && { vehicles: resetParked(vehicles) }) }),
  });

function studentFromImport(r) {
  return {
    ...toPersonRecord(r),
    date_registered: today(),
    status: "active",
    ...(r.vehicleId && { vehicles: { [r.vehicleId]: toVehicleRecord({ ...r, customType: "" }) } }),
  };
}

/** Bulk-registers users. Skips IDs that already exist and vehicles whose ID or plate is already in use. */
export async function importUsers(records) {
  const existing = (await readValue(DB.students)) || {};
  const takenVehicleIds = new Set();
  const takenPlates = new Set();
  Object.values(existing).forEach((student) => Object.entries(student.vehicles || {}).forEach(([id, vehicle]) => {
    takenVehicleIds.add(id);
    if (vehicle.plate_number) takenPlates.add(normalizePlate(vehicle.plate_number));
  }));

  const fresh = [];
  let duplicateUsers = 0, vehicleConflicts = 0;
  for (const record of records) {
    const plate = normalizePlate(record.plate);
    if (existing[record.id]) { duplicateUsers += 1; continue; }
    if (record.vehicleId && (takenVehicleIds.has(record.vehicleId) || (plate && takenPlates.has(plate)))) { vehicleConflicts += 1; continue; }
    fresh.push(record);
    if (record.vehicleId) takenVehicleIds.add(record.vehicleId);
    if (plate) takenPlates.add(plate);
  }

  if (fresh.length) await updatePaths(Object.fromEntries(fresh.map((r) => [studentPath(r.id), studentFromImport(r)])));
  const notes = [
    duplicateUsers && `${duplicateUsers} duplicate user ID(s) skipped`,
    vehicleConflicts && `${vehicleConflicts} skipped because the vehicle ID or plate is already registered`,
  ].filter(Boolean);
  return `${fresh.length} user(s) imported${notes.length ? `; ${notes.join("; ")}` : ""}`;
}

/* ---------------- vehicles ---------------- */

export async function saveVehicle({ studentId, originalVehicleId, values }) {
  assertValid(vehicleErrors(values));
  const newId = values.vehicleId.trim();
  const isEditing = !!originalVehicleId;
  const isRenamed = isEditing && newId !== originalVehicleId;

  const current = (await readValue(`${studentPath(studentId)}/vehicles`)) || {};
  if (!isEditing && Object.keys(current).length >= MAX_VEHICLES_PER_USER) throw new Error(limitMessage);


  const status = isEditing ? values.status : NOT_PARKED;
  await updatePaths({
    [vehiclePath(studentId, newId)]: { ...current[originalVehicleId], ...toVehicleRecord(values, status) },
    ...(isRenamed && { [vehiclePath(studentId, originalVehicleId)]: null }),
    ...touchStudent(studentId),
  });
  return isEditing ? "Vehicle updated" : "Vehicle added";
}

export const archiveVehicle = (studentId, vehicleId, vehicle) =>
  archiveRecord({
    livePath: vehiclePath(studentId, vehicleId),
    archivePath: `${DB.archivedVehicles}/${studentId}/${vehicleId}`,
    record: vehicle,
    extra: touchStudent(studentId),
  });

export async function restoreVehicle(studentId, vehicleId, archived) {
  if (!(await exists(studentPath(studentId)))) throw new Error(`User ${studentId} is not active. Restore the user first.`);
  const current = (await readValue(`${studentPath(studentId)}/vehicles`)) || {};
  if (Object.keys(current).length >= MAX_VEHICLES_PER_USER) throw new Error(`${limitMessage} Remove one before restoring this vehicle.`);
  await restoreRecord({
    livePath: vehiclePath(studentId, vehicleId),
    archivePath: `${DB.archivedVehicles}/${studentId}/${vehicleId}`,
    record: archived,
    conflictMessage: "A vehicle with that ID already exists for this user",
    transform: (r) => ({ ...r, current_status: NOT_PARKED }),
    extra: touchStudent(studentId),
  });
}

/* ---------------- gate cards ---------------- */

const cardPath = (uid) => `${DB.manualCards}/${uid}`;

export async function registerGateCard({ uid, label, createdBy, existingCards }) {
  const cardUid = uid.trim().toUpperCase();
  if (!isValidFirebaseKey(cardUid)) throw new Error("Card UID can’t contain . $ # [ ] /");
  if (existingCards?.[cardUid]) throw new Error("That card is already registered");
  await writeValue(cardPath(cardUid), { label: label.trim() || null, created: today(), created_by: createdBy });
  return "Gate card added";
}

export const archiveGateCard = ({ id, ...card }) =>
  archiveRecord({ livePath: cardPath(id), archivePath: `${DB.archivedManualCards}/${id}`, record: card });

export const restoreGateCard = (uid, archived) =>
  restoreRecord({ livePath: cardPath(uid), archivePath: `${DB.archivedManualCards}/${uid}`, record: archived, conflictMessage: "That card is already registered" });

/* ---------------- accounts ---------------- */

const rolePath = (uid) => `${DB.roles}/${uid}`;

function describeSignUpError(code) {
  if (code === "auth/email-already-in-use") return "That email already has an account";
  if (code === "auth/weak-password") return "Password must be at least 6 characters";
  return "Could not create the account";
}

export async function createAccount({ email, password, role }) {
  const secondaryAuth = getSecondaryAuth();
  let uid;
  try {
    uid = (await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password)).user.uid;
  } catch (error) {
    throw new Error(describeSignUpError(error.code));
  }
  await signOut(secondaryAuth);
  await writeValue(rolePath(uid), { role, email: email.trim() });
  return "Account created";
}

export const changeAccountRole = (uid, role) => update(ref(db, rolePath(uid)), { role });

export const archiveAccount = ({ id, ...account }) =>
  archiveRecord({ livePath: rolePath(id), archivePath: `${DB.archivedRoles}/${id}`, record: account });

/** Re-grants app access. The Firebase sign-in account was never deleted, so the same login works again. */
export const restoreAccount = (uid, archived) =>
  restoreRecord({ livePath: rolePath(uid), archivePath: `${DB.archivedRoles}/${uid}`, record: archived, conflictMessage: "That account already has access" });

/* ---------------- activity (manual entries) ---------------- */

/** Works out which parts of the manual-entry form are typed in vs. picked from the registry. */
export function deriveActivityMode(values, students) {
  const studentId = (values.studentId || "").trim();
  const student = students[studentId];
  const isVisitor = values.kind === "visitor";
  const isUnregisteredPerson = !isVisitor && !!studentId && !student;
  const needsTypedName = isVisitor || isUnregisteredPerson;
  return { student, isVisitor, isUnregisteredPerson, needsTypedName, needsTypedVehicle: needsTypedName || values.vehicleId === UNLISTED_VEHICLE };
}

function identityFields(values, students) {
  const mode = deriveActivityMode(values, students);
  const studentId = values.studentId.trim();

  if (mode.needsTypedVehicle) {
    const resolvedType = resolveVehicleType(values);
    assertValid([
      mode.needsTypedName && checkField("name", values.visitorName),
      checkField("vehicleType", values.vehicleType),
      values.vehicleType === OTHER_TYPE && checkField("customType", values.customType, { vehicleType: OTHER_TYPE }),
      checkField("plate", values.plate, { resolvedType }),
    ].filter(Boolean));
    const plate = values.plate.trim().toUpperCase();
    const plateTag = plate.replace(/\s+/g, "_") || "NO-PLATE";
    return {
      registeredVehicleId: null,
      fields: {
        student_id: mode.isVisitor ? `VISITOR_${Date.now()}` : studentId,
        card_uid: `${mode.isVisitor ? "VISITOR" : "MANUAL"}_${plateTag}`,
        visitor_data: {
          name: mode.needsTypedName ? values.visitorName.trim() : mode.student?.name || "",
          vehicle_type: normalizeVehicleType(resolvedType),
          plate_number: plate,
        },
      },
    };
  }
  if (!mode.student?.vehicles?.[values.vehicleId]) throw new Error("Choose one of this user’s registered vehicles");
  return { registeredVehicleId: values.vehicleId, fields: { student_id: studentId, card_uid: values.vehicleId } };
}

/** `pendingLog` is a gate-card tap awaiting details; omit it for a brand-new manual entry. */
export async function saveActivity({ values, students, recordedBy, pendingLog }) {
  const when = values.timestamp ? new Date(values.timestamp).getTime() : Date.now();
  if (Number.isNaN(when)) throw new Error("Enter a valid date and time.");
  if (when > Date.now() + 5 * 60 * 1000) throw new Error("The time can’t be in the future.");
  if ((values.remarks || "").length > 300) throw new Error("Remarks can be at most 300 characters.");
  const { registeredVehicleId, fields } = identityFields(values, students);
  const log = {
    ...fields,
    user_type: values.kind,
    access_type: values.accessType,
    remarks: (values.remarks || "").trim() || null,
    recorded_by: recordedBy,
  };

  if (pendingLog) {
    await update(ref(db, `${DB.accessLogs}/${pendingLog.id}`), { ...log, needs_details: null, manual_card_uid: pendingLog.card_uid || null });
  } else {
    await push(ref(db, DB.accessLogs), {
      ...log,
      granted: true,
      reader: "MANUAL",
      manual_entry: true,
      timestamp: when,
    });
  }
  if (registeredVehicleId) {
    await writeValue(`${vehiclePath(fields.student_id, registeredVehicleId)}/current_status`, values.accessType === "ENTRANCE" ? "parked" : NOT_PARKED);
  }
  return pendingLog ? "Details saved" : "Activity recorded";
}


export async function importOfflineLogs(rows, recordedBy) {
  if (!rows.length) throw new Error("There are no valid rows to import");
  const students = (await readValue(DB.students)) || {};
  const existing = (await readValue(DB.accessLogs)) || {};

  const newestByVehicle = new Map();
  Object.values(existing).forEach((log) => {
    if (!log.granted || !log.timestamp) return;
    const id = `${log.student_id}/${log.card_uid}`;
    newestByVehicle.set(id, Math.max(newestByVehicle.get(id) || 0, log.timestamp));
  });

  const writes = {};
  const latestImported = new Map();
  const counts = { saved: 0, duplicate: 0, unmatched: 0, unidentified: 0 };
  for (const row of rows) {
    if (existing[row.key]) { counts.duplicate += 1; continue; }
    const resolved = resolveOfflineLog(row, students);
    writes[`${DB.accessLogs}/${row.key}`] = buildOfflineLog(row, resolved, students, recordedBy);
    counts.saved += 1;
    if (resolved.vehicleId) {
      const id = `${resolved.studentId}/${resolved.vehicleId}`;
      if (!latestImported.get(id) || row.time >= latestImported.get(id).row.time) latestImported.set(id, { row, resolved });
    } else if (resolved.match === "unidentified") counts.unidentified += 1;
    else counts.unmatched += 1;
  }

  for (const [id, { row, resolved }] of latestImported) {
    if (row.time >= (newestByVehicle.get(id) || 0)) {
      writes[`${vehiclePath(resolved.studentId, resolved.vehicleId)}/current_status`] = row.direction === "ENTRANCE" ? "parked" : NOT_PARKED;
    }
  }

  if (counts.saved) await updatePaths(writes);
  const notes = [
    counts.duplicate && `${counts.duplicate} already imported earlier (skipped)`,
    counts.unmatched && `${counts.unmatched} saved with the plate/UID only because the vehicle isn’t registered to that user`,
    counts.unidentified && `${counts.unidentified} saved as “Unidentified” (no registered user or vehicle found)`,
  ].filter(Boolean);
  const headline = counts.saved ? `${counts.saved} offline log(s) imported as manual entries` : "Nothing new to import";
  return `${headline}${notes.length ? `; ${notes.join("; ")}` : ""}`;
}
