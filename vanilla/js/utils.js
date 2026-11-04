import { NOT_PARKED, OTHER_TYPE, RELATIONSHIPS, STAFF_PREFIX, VEHICLE_TYPES, YEAR_MAX, YEAR_MIN } from "./constants.js";

/* ---------------- DOM helper ---------------- */

/** Tiny hyperscript: h("div", {class: "x", onclick}, child, [children], "text"). Text is always escaped. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, val] of Object.entries(props || {})) {
    if (val == null || val === false) continue;
    if (key === "class") el.className = val;
    else if (key === "value") value = val;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), val);
    else el.setAttribute(key, val === true ? "" : val);
  }
  const append = (child) => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(append);
    else el.append(child instanceof Node ? child : String(child));
  };
  children.forEach(append);
  if (value !== undefined) el.value = value; // after children, so <select> options exist
  return el;
}

/** Replaces a slot's content, skipping null/false so conditional children don't render as text. */
export function mount(slot, ...children) {
  slot.replaceChildren(...children.flat(Infinity).filter((child) => child != null && child !== false));
}

/* ---------------- dates ---------------- */

export const toDateKey = (date = new Date()) => date.toLocaleDateString("en-CA"); // local YYYY-MM-DD
export const today = () => toDateKey();

export function formatLogTimestamp(log) {
  if (!log.timestamp) return log.timestamp_human || "N/A";
  return new Date(log.timestamp).toLocaleString("en-PH", {
    ...(log.isUTC && { timeZone: "Asia/Manila" }),
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* ---------------- validation ---------------- */

const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
export function isValidPersonName(name) {
  const value = String(name ?? "").trim();
  return value.length >= 2 && value.length <= 80 && PERSON_NAME.test(value) && !/\s{2,}/.test(value);
}
export const isValidFirebaseKey = (key) => !!key && !/[.$#[\]/]/.test(key);
export const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);

/* ---------------- users & vehicles ---------------- */

export const isStaffId = (id) => String(id || "").trim().startsWith(STAFF_PREFIX);
export const isStaff = (id, student = {}) => isStaffId(id) || !!student.department;
export const vehiclesOf = (student) => Object.values(student?.vehicles || {});
export const hasParkedVehicle = (student) => vehiclesOf(student).some((v) => v.current_status === "parked");
export const initialsOf = (name) => (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** {id: record} -> [{...record, id}] */
export const toRows = (map) => Object.entries(map || {}).map(([id, record]) => ({ ...record, id }));
export function stripArchiveStamp(record) {
  const { archived_at, archived_reason, ...rest } = record;
  return rest;
}

export const resolveVehicleType = (v) => (v.vehicleType === OTHER_TYPE ? (v.customType || "").trim() : v.vehicleType);
export const toVehicleRecord = (v, status = NOT_PARKED) => ({
  type: resolveVehicleType(v),
  brand: v.brand.trim(),
  model: v.model.trim(),
  plate_number: v.plate.trim(),
  color: v.color.trim(),
  registration_expiry: v.expiry,
  is_active: true,
  current_status: status,
});

/** Fields shared by "add user", "edit profile" and Excel import writes. */
export const toPersonRecord = (v) => ({
  name: v.name.trim(),
  course: v.course.trim(),
  email: v.email.trim(),
  contact_number: v.phone.trim(),
  year_level: v.year ? Number(v.year) : null,
  last_updated: today(),
  emergency_contact: { name: v.emergencyName.trim(), phone: v.emergencyPhone.trim(), relationship: v.emergencyRelationship.trim() },
});
export function assertValidPersonNames(v) {
  if (!isValidPersonName(v.name)) throw new Error("Enter a valid full name (letters and common name punctuation only)");
  if (!isValidPersonName(v.emergencyName)) throw new Error("Enter a valid emergency contact name");
}

/* ---------------- display rows ---------------- */

export function buildUserRows(students) {
  return Object.entries(students || {})
    .map(([id, s]) => ({ ...s, id, kind: isStaff(id, s) ? "staff" : "student", vehicleCount: vehiclesOf(s).length, parked: hasParkedVehicle(s) }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
export const countVehicles = (users) => users.reduce((n, u) => n + u.vehicleCount, 0);
export const countParkedUsers = (users) => users.filter((u) => u.parked).length;
export const countParkedVehicles = (students) =>
  Object.values(students).flatMap(vehiclesOf).filter((v) => v.current_status === "parked").length;
export const recentlyRegistered = (users, limit) =>
  [...users].sort((a, b) => (b.date_registered || "").localeCompare(a.date_registered || "")).slice(0, limit);

function directionLabel(log) {
  if (!log.granted) return "Denied";
  if (log.access_type === "EXIT") return "Exit";
  if (log.access_type === "ENTRANCE") return "Entry";
  return log.access_type || "Unknown";
}

/** One access log joined with its student record, with every display field derived. */
export function toActivityRow(id, log, students) {
  const student = students[log.student_id];
  const vehicle = student?.vehicles?.[log.card_uid];
  const visitor = log.visitor_data;
  const needsDetails = !!(log.needs_details || log.user_type === "admin");
  const isVisitor = log.user_type === "visitor";
  const isManual = !!(log.manual_entry || log.manual_card || log.reader === "MANUAL" || log.user_type === "admin");
  const vehicleType = isVisitor ? visitor?.vehicle_type : vehicle?.type || visitor?.vehicle_type;
  const plate = isVisitor ? visitor?.plate_number : vehicle?.plate_number || visitor?.plate_number;
  return {
    ...log,
    id,
    needs_details: needsDetails,
    manual: isManual,
    unregistered: isManual && !isVisitor && !needsDetails && !student,
    name: needsDetails ? "Unidentified" : isVisitor ? visitor?.name || "Visitor" : student?.name || visitor?.name || "N/A",
    vehicleType: vehicleType || "N/A",
    plate: plate || "N/A",
    kind: needsDetails ? "pending" : isVisitor ? "visitor" : isStaff(log.student_id || "", student) ? "staff" : "student",
    label: directionLabel(log),
    time: formatLogTimestamp(log),
    date: log.timestamp ? toDateKey(new Date(log.timestamp)) : "",
  };
}
export const buildActivityRows = (logs, students) =>
  Object.entries(logs || {}).map(([id, log]) => toActivityRow(id, log, students)).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

/* ---------------- filters ---------------- */

const matchesText = (query, fields) => {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some((f) => String(f ?? "").toLowerCase().includes(needle));
};
const inRange = (value, from, to) => (!from || value >= from) && (!to || value <= to);

export const defaultUserFilters = { kind: "all", course: "all", year: "all", from: "", to: "" };
export const filterUsers = (users, query, f) =>
  users.filter((u) =>
    matchesText(query, [u.name, u.id, u.email]) &&
    (f.kind === "all" || u.kind === f.kind) &&
    (f.course === "all" || u.course === f.course) &&
    (f.year === "all" || String(u.year_level) === f.year) &&
    inRange(u.date_registered || "", f.from, f.to));

export const defaultActivityFilters = { source: "all", kind: "all", result: "granted", vehicle: "all", from: "", to: "" };
function matchesResult(row, result) {
  if (result === "all") return true;
  if (result === "granted") return row.granted;
  if (result === "DENIED") return !row.granted;
  if (result === "PENDING") return row.needs_details;
  return row.granted && row.access_type === result; // ENTRANCE | EXIT
}
function matchesVehicle(row, vehicle) {
  if (vehicle === "all") return true;
  const type = row.vehicleType.toLowerCase();
  return vehicle === "Other" ? !VEHICLE_TYPES.includes(type) : type === vehicle;
}
export const filterActivities = (rows, query, f) =>
  rows.filter((r) =>
    matchesText(query, [r.name, r.student_id, r.plate]) &&
    (f.kind === "all" || r.kind === f.kind) &&
    (f.source === "all" || r.manual === (f.source === "manual")) &&
    matchesResult(r, f.result) &&
    matchesVehicle(r, f.vehicle) &&
    inRange(r.date, f.from, f.to));

/* ---------------- Excel import ---------------- */

const COLUMN_ALIASES = {
  id: ["id", "studentid", "staffid", "studentstaffid", "student staff id", "student / staff id", "user id"],
  name: ["name", "fullname", "user name"],
  course: ["course", "department", "coursedepartment"],
  year: ["year", "yearlevel", "year level"],
  email: ["email", "emailaddress"],
  phone: ["phone", "contactnumber", "contact number", "mobile"],
  emergencyName: ["emergencyname", "emergencycontactname", "emergency contact name"],
  emergencyPhone: ["emergencyphone", "emergencycontactphone", "emergency contact phone"],
  emergencyRelationship: ["relationship", "emergencyrelationship", "emergency contact relationship"],
  vehicleId: ["vehicleid", "rfid", "rfidtag", "vehicle id", "rfid tag"],
  vehicleType: ["vehicletype", "vehicle type", "type"],
  brand: ["brand", "vehiclebrand"],
  model: ["model", "vehiclemodel"],
  plate: ["plate", "platenumber", "plate number"],
  color: ["color", "vehiclecolor"],
  expiry: ["expiry", "registrationexpiry", "registration expiry"],
};
const normalizeHeader = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, " ");
const HEADER_TO_FIELD = new Map(Object.entries(COLUMN_ALIASES).flatMap(([field, aliases]) => aliases.map((a) => [normalizeHeader(a), field])));

function mapRow(rawRow, row) {
  const record = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((k) => [k, ""]));
  for (const [header, value] of Object.entries(rawRow)) {
    const field = HEADER_TO_FIELD.get(normalizeHeader(header));
    if (field) record[field] = String(value ?? "").trim();
  }
  return { ...record, row };
}

export function validateImportRecord(r) {
  const errors = [];
  if (!isValidFirebaseKey(r.id)) errors.push("Invalid or missing ID");
  if (!isValidPersonName(r.name)) errors.push("Invalid full name");
  if (!r.course) errors.push("Missing course / department");
  if (!isValidEmail(r.email)) errors.push("Invalid email");
  if (!r.phone) errors.push("Missing contact number");
  if (!isValidPersonName(r.emergencyName)) errors.push("Invalid emergency contact name");
  if (!r.emergencyPhone) errors.push("Missing emergency contact phone");
  if (!RELATIONSHIPS.includes(r.emergencyRelationship)) errors.push("Choose a valid relationship");
  if (r.year && (!/^\d+$/.test(r.year) || +r.year < YEAR_MIN || +r.year > YEAR_MAX)) errors.push(`Year level must be ${YEAR_MIN}–${YEAR_MAX}`);
  if (r.vehicleId) {
    if (!isValidFirebaseKey(r.vehicleId)) errors.push("Invalid vehicle ID");
    if (![r.vehicleType, r.brand, r.model, r.plate, r.color].every(Boolean)) errors.push("Vehicle ID requires type, brand, model, plate, and color");
  }
  return errors;
}

/** Reads the first worksheet of an .xlsx/.xls file (SheetJS is loaded by a <script> tag in index.html). */
export async function readUserWorkbook(file) {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("Excel reader did not load. Check your internet connection and reload the page.");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no worksheet");
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (!rawRows.length) throw new Error("The worksheet is empty");

  const seen = new Set(), valid = [], issues = [];
  rawRows.forEach((raw, index) => {
    const record = mapRow(raw, index + 2); // row 1 is the header
    const errors = validateImportRecord(record);
    if (seen.has(record.id)) errors.push("Duplicate ID in this file");
    if (record.id) seen.add(record.id);
    if (errors.length) issues.push({ row: record.row, errors });
    else valid.push(record);
  });
  return { valid, issues };
}
