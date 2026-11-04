// Form modals: add user, edit profile, add/edit vehicle, manual activity entry, Excel import.
import { session } from "./auth.js";
import { OTHER_TYPE, RELATIONSHIPS, UNLISTED_VEHICLE, VEHICLE_TYPES, YEAR_MAX, YEAR_MIN } from "./constants.js";
import { importUsers, deriveActivityMode, registerUser, saveActivity, saveVehicle, updateUserProfile } from "./services.js";
import { field, formActions, handleSubmit, openModal, options, toast } from "./ui.js";
import { h, isStaff, isStaffId, mount, readUserWorkbook } from "./utils.js";

/* ---------------- form-building helpers ---------------- */

const row2 = (...fields) => h("div", { class: "row2" }, fields);
const input = (name, attrs = {}) => h("input", { name, ...attrs });

/** Shows/hides a block and disables its controls, so hidden fields are neither validated nor submitted. */
function setEnabled(node, enabled) {
  node.hidden = !enabled;
  node.querySelectorAll("input, select, textarea").forEach((control) => (control.disabled = !enabled));
}

function personFields(values = {}, withId = false) {
  const idInput = input("id", { required: true, autocomplete: "off", value: values.id });
  const yearInput = input("year", { type: "number", min: YEAR_MIN, max: YEAR_MAX, value: values.year });
  const yearField = field("Year level", yearInput);

  const setStaff = (staff) => {
    yearInput.required = !staff;
    yearField.querySelector("span").textContent = staff ? "Year level (optional)" : "Year level";
  };

  const nodes = [
    field("Full name", input("name", { required: true, minlength: 2, maxlength: 80, autocomplete: "off", value: values.name }), "Use letters, spaces, periods, apostrophes, or hyphens."),
    withId && field("Student / Staff ID", idInput, "Staff IDs start with E"),
    row2(field("Course / Department", input("course", { required: true, value: values.course })), yearField),
    field("Email", input("email", { type: "email", required: true, value: values.email })),
    field("Contact number", input("phone", { type: "tel", required: true, value: values.phone })),
    h("h4", {}, "Emergency contact"),
    field("Name", input("emergencyName", { required: true, minlength: 2, maxlength: 80, value: values.emergencyName })),
    row2(
      field("Phone", input("emergencyPhone", { type: "tel", required: true, value: values.emergencyPhone })),
      field("Relationship", h("select", { name: "emergencyRelationship", required: true, value: values.emergencyRelationship || "" }, options(RELATIONSHIPS, "Select relationship…")))),
  ];
  setStaff(isStaff(values.id || "", values));
  return { nodes, idInput, setStaff };
}

/** Vehicle type dropdown plus a "Specify type" box that appears for "Other". */
function vehicleTypeFields(values = {}) {
  const select = h("select", { name: "vehicleType", required: true, value: values.vehicleType || "" },
    options([["car", "Car"], ["motorcycle", "Motorcycle"], [OTHER_TYPE, "Other"]], "Select…"));
  const custom = input("customType", { required: true, value: values.customType });
  const customField = field("Specify type", custom);

  const sync = (parentEnabled = true) => {
    const showCustom = parentEnabled && select.value === OTHER_TYPE;
    customField.hidden = !showCustom;
    custom.disabled = !showCustom;
  };
  select.addEventListener("change", () => sync());
  sync();
  return { node: h("div", {}, field("Vehicle type", select), customField), sync };
}

function vehicleFields(values = {}, withId = true) {
  const typeFields = vehicleTypeFields(values);
  const nodes = [
    withId && field("RFID tag / Vehicle ID", input("vehicleId", { required: true, value: values.vehicleId })),
    typeFields.node,
    row2(field("Brand", input("brand", { required: true, value: values.brand })), field("Model", input("model", { required: true, value: values.model }))),
    row2(field("Plate number", input("plate", { required: true, value: values.plate })), field("Color", input("color", { required: true, value: values.color }))),
    field("Registration expiry", input("expiry", { type: "date", required: true, value: values.expiry })),
  ];
  return { nodes, typeFields };
}

function vehicleFormValues(vehicleId = "", vehicle = {}) {
  const type = vehicle.type;
  const isStandard = VEHICLE_TYPES.includes(type);
  return {
    vehicleId,
    vehicleType: !type ? "" : isStandard ? type : OTHER_TYPE,
    customType: type && !isStandard ? type : "",
    brand: vehicle.brand || "",
    model: vehicle.model || "",
    plate: vehicle.plate_number || "",
    color: vehicle.color || "",
    expiry: vehicle.registration_expiry || "",
    status: vehicle.current_status || "not parked",
  };
}

/* ---------------- user modals ---------------- */

export function openAddUserModal() {
  const person = personFields({}, true);
  const vehicle = vehicleFields({});
  person.idInput.addEventListener("input", () => person.setStaff(isStaffId(person.idInput.value)));

  const form = h("form", {}, person.nodes, h("h4", {}, "Vehicle"), vehicle.nodes, formActions(() => close(), "Add user"));
  const close = openModal("Add user", form);
  handleSubmit(form, registerUser, close);
}

export function openEditProfileModal(studentId, student) {
  const emergency = student.emergency_contact || {};
  const person = personFields({
    name: student.name || "", id: studentId, course: student.course || "", year: student.year_level ? String(student.year_level) : "",
    email: student.email || "", phone: student.contact_number || "",
    emergencyName: emergency.name || "", emergencyPhone: emergency.phone || "", emergencyRelationship: emergency.relationship || "",
    department: student.department,
  });
  const form = h("form", {}, person.nodes, formActions(() => close(), "Save"));
  const close = openModal("Edit profile", form);
  handleSubmit(form, (values) => updateUserProfile(studentId, values), close);
}

/** Omit `vehicleId` to add a vehicle; pass it to edit that one. */
export function openVehicleModal({ studentId, vehicleId, vehicles }) {
  const isEditing = !!vehicleId;
  const values = vehicleFormValues(vehicleId, isEditing ? vehicles?.[vehicleId] : {});
  const vehicle = vehicleFields(values);

  const form = h("form", {}, vehicle.nodes,
    isEditing && field("Status", h("select", { name: "status", value: values.status }, options([["parked", "Parked"], ["not parked", "Not parked"]]))),
    formActions(() => close(), isEditing ? "Save" : "Add vehicle"));
  const close = openModal(isEditing ? "Edit vehicle" : "Add vehicle", form);
  handleSubmit(form, (formValues) => saveVehicle({ studentId, originalVehicleId: vehicleId, existingVehicles: vehicles, values: formValues }), close);
}

/* ---------------- manual activity entry ---------------- */

/**
 * `pendingLog`: a gate-card tap waiting for details. Omit it for a brand-new manual entry.
 * Parts of the form switch between "typed in" and "picked from the registry" as the ID/vehicle change.
 */
export function openActivityModal({ students, pendingLog = null }) {
  let kind = "student";
  let lastStudentId = null;

  const kindButtons = Object.fromEntries([["student", "Student / Staff"], ["visitor", "Visitor"]].map(([key, label]) =>
    [key, h("button", { type: "button", class: "btn", onclick: () => { kind = key; sync(); } }, label)]));

  const studentInput = input("studentId", { list: "student-ids", required: true, autocomplete: "off" });
  const studentField = field("Student / Staff ID", studentInput);
  const idList = h("datalist", { id: "student-ids" }, Object.entries(students).map(([id, s]) => h("option", { value: id }, s.name)));
  const unregisteredNote = h("p", { class: "note" }, "Not registered yet — that’s fine. The entry is saved with the details below and picks up their registered name once they’re registered.");
  const vehicleSelect = h("select", { name: "vehicleId", required: true });
  const vehicleField = field("Vehicle", vehicleSelect);
  const personSection = h("div", {}, studentField, idList, unregisteredNote, vehicleField);

  const nameField = field("Full name", input("visitorName", { required: true, minlength: 2, maxlength: 80 }));
  const typeFields = vehicleTypeFields();
  const typedVehicle = h("div", {}, typeFields.node, field("Plate number", input("plate", { required: true })));

  const form = h("form", {},
    pendingLog && h("p", { class: "note" }, "Gate card tap · ", h("b", {}, pendingLog.label), ` · ${pendingLog.time}`, h("br"),
      `Card ${pendingLog.card_uid || "N/A"}. Add who came through so the log is complete.`),
    h("div", { class: "seg" }, Object.values(kindButtons)),
    personSection, nameField, typedVehicle,
    row2(
      field("Entry or exit", h("select", { name: "accessType", value: pendingLog?.access_type === "EXIT" ? "EXIT" : "ENTRANCE" }, options([["ENTRANCE", "Entry"], ["EXIT", "Exit"]]))),
      !pendingLog && field("Time", input("timestamp", { type: "datetime-local" }), "Leave blank for now")),
    field("Remarks (optional)", h("textarea", { name: "remarks", rows: 2, maxlength: 300 })),
    formActions(() => close(), pendingLog ? "Save details" : "Record"));

  function fillVehicleOptions(student) {
    const previous = vehicleSelect.value;
    const vehicleOptions = Object.entries(student?.vehicles || {}).map(([id, v]) => [id, `${v.plate_number} · ${v.brand} ${v.model}`]);
    if (student) vehicleOptions.push([UNLISTED_VEHICLE, "Vehicle not registered…"]);
    vehicleSelect.replaceChildren(...options(vehicleOptions, student ? "Select vehicle…" : "Enter an ID first").flat(2).filter(Boolean));
    vehicleSelect.value = vehicleOptions.some(([id]) => id === previous) ? previous : "";
  }

  function sync() {
    Object.entries(kindButtons).forEach(([key, button]) => button.classList.toggle("on", key === kind));

    const studentId = studentInput.value.trim();
    if (studentId !== lastStudentId) {
      lastStudentId = studentId;
      fillVehicleOptions(students[studentId]);
    }
    const mode = deriveActivityMode({ kind, studentId, vehicleId: vehicleSelect.value }, students);

    setEnabled(personSection, !mode.isVisitor);
    if (!mode.isVisitor) {
      unregisteredNote.hidden = !mode.isUnregisteredPerson;
      setEnabled(vehicleField, !mode.isUnregisteredPerson);
      studentField.hintEl.textContent = mode.student?.name || "";
    }
    nameField.querySelector("span").textContent = mode.isVisitor ? "Visitor name" : "Full name";
    setEnabled(nameField, mode.needsTypedName);
    setEnabled(typedVehicle, mode.needsTypedVehicle);
    typeFields.sync(mode.needsTypedVehicle);
  }

  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  const close = openModal(pendingLog ? "Add details" : "Manual entry", form);
  sync();

  const blank = { studentId: "", vehicleId: "", visitorName: "", vehicleType: "", customType: "", plate: "", remarks: "", timestamp: "" };
  handleSubmit(form, (formValues) =>
    saveActivity({ values: { ...blank, ...formValues, kind }, students, pendingLog, recordedBy: session.user?.email || null }), close);
}

/* ---------------- Excel import ---------------- */

const MAX_VISIBLE_ISSUES = 8;

export function openImportModal() {
  let records = [];
  const fileInput = h("input", { type: "file", accept: ".xlsx,.xls" });
  const preview = h("div", {});
  const importButton = h("button", { class: "btn pri", disabled: true }, "Import 0 user(s)");

  function showPreview(fileName, valid, issues) {
    records = valid;
    importButton.disabled = !valid.length;
    importButton.textContent = `Import ${valid.length} user(s)`;
    mount(preview,
      fileName && h("p", { class: "mut" }, `${fileName} · ${valid.length} valid row(s) · ${issues.length} invalid row(s)`),
      issues.length > 0 && h("div", { class: "import-errors" },
        h("b", {}, "Rows needing correction"),
        issues.slice(0, MAX_VISIBLE_ISSUES).map(({ row, errors }) => h("div", {}, `Row ${row}: ${errors.join(", ")}`)),
        issues.length > MAX_VISIBLE_ISSUES && h("small", {}, `And ${issues.length - MAX_VISIBLE_ISSUES} more…`)),
      valid.length > 0 && h("p", { class: "note" }, `${valid.length} valid record(s) are ready. Existing IDs will be skipped during import.`));
  }

  fileInput.addEventListener("change", async () => {
    showPreview("", [], []);
    const file = fileInput.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) return toast("Choose an Excel .xlsx or .xls file", "err");
    try {
      const { valid, issues } = await readUserWorkbook(file);
      showPreview(file.name, valid, issues);
    } catch (error) {
      showPreview(file.name, [], []);
      toast(error.message || "Could not read workbook", "err");
    }
  });

  const form = h("form", {},
    h("p", { class: "note" }, "Upload an Excel workbook (.xlsx or .xls). The first worksheet must have one user per row. Required columns: ",
      h("b", {}, "ID, Name, Course, Email, Phone, Emergency Name, Emergency Phone, Relationship"),
      ". Year is optional for staff. Optional vehicle columns: Vehicle ID, Vehicle Type, Brand, Model, Plate, Color, Expiry."),
    field("Excel file", fileInput), preview,
    h("div", { class: "mact" }, h("button", { type: "button", class: "btn", onclick: () => close() }, "Cancel"), importButton));
  const close = openModal("Import users from Excel", form);

  handleSubmit(form, () => {
    if (!records.length) throw new Error("There are no valid rows to import");
    return importUsers(records);
  }, close, "Importing…");
}
