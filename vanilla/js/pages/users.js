import { subscribeUsers } from "../data.js";
import { openAddUserModal, openImportModal } from "../modals.js";
import { YEAR_MAX, YEAR_MIN } from "../constants.js";
import { chips, createPager, filterBar, layout, skeleton, table, userColumns } from "../ui.js";
import { defaultUserFilters, filterUsers, h, mount } from "../utils.js";

const YEAR_LEVELS = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => String(YEAR_MIN + i));

const FILTER_FIELDS = [
  { key: "kind", label: "Type", type: "select", options: [["all", "Students and staff"], ["student", "Students"], ["staff", "Staff"]] },
  { key: "course", label: "Course / Dept", type: "select", options: [["all", "All"]] },
  { key: "year", label: "Year level", type: "select", options: [["all", "All"], ...YEAR_LEVELS.map((y) => [y, `Year ${y}`])] },
  { key: "from", label: "Registered from", type: "date" },
  { key: "to", label: "To", type: "date" },
];

export default function usersPage(app) {
  let users = null;

  const filters = filterBar({ placeholder: "Search name, ID or email…", fields: FILTER_FIELDS, defaults: defaultUserFilters, onChange: () => draw() });
  const pager = createPager(() => draw());
  const chipsSlot = h("div");
  const tableSlot = h("div", {}, skeleton());

  const { root, body } = layout("Registered users", [
    h("button", { class: "btn", onclick: openImportModal }, "Import Excel"),
    h("button", { class: "btn pri", onclick: openAddUserModal }, "+ Add user"),
  ]);
  body.append(h("div", { class: "card" }, filters.node, chipsSlot, tableSlot, pager.node));
  app.replaceChildren(root);

  function draw() {
    if (!users) return pager.slice([]);
    const matching = filterUsers(users, filters.state.query, filters.state.filters);
    const pageRows = pager.slice(matching);
    mount(chipsSlot, chips([
      ["Total", users.length],
      ["Students", users.filter((u) => u.kind === "student").length],
      ["Staff", users.filter((u) => u.kind === "staff").length],
      ["Matching", matching.length],
    ]));
    mount(tableSlot, table(userColumns, pageRows, "No users match your filters."));
  }

  draw();
  return subscribeUsers(({ users: next }) => {
    users = next;
    const courses = [...new Set(users.map((u) => u.course).filter(Boolean))].sort();
    filters.setOptions("course", [["all", "All"], ...courses.map((c) => [c, c])]);
    draw();
  });
}
