import { subscribeActivities } from "../data.js";
import { openAddUserModal } from "../modals.js";
import { activityColumns, layout, skeleton, stat, table, userColumns } from "../ui.js";
import { breakdownText, buildVehicleRows, countByBucket, countParkedUsers, countVehicles, h, mount, recentlyRegistered } from "../utils.js";

const RECENT_LIMIT = 5;

export default function dashboardPage(app) {
  let data = null;
  let showDenied = false;

  const alertSlot = h("div");
  const statsSlot = h("div", { class: "stats" });
  const activitySlot = h("div", {}, skeleton());
  const usersSlot = h("div", {}, skeleton());
  const deniedToggle = h("input", { type: "checkbox", onchange: (e) => { showDenied = e.target.checked; draw(); } });

  const { root, body } = layout("Dashboard", [h("button", { class: "btn pri", onclick: openAddUserModal }, "+ Add user")]);
  body.append(
    alertSlot, statsSlot,
    h("section", { class: "card" },
      h("h2", {}, "Recent parking activity", h("span", {}, h("label", { class: "chk" }, deniedToggle, " Show denied"), " ", h("a", { href: "#/activities" }, "See all →"))),
      activitySlot),
    h("section", { class: "card" }, h("h2", {}, "Recently registered users ", h("a", { href: "#/users" }, "See all →")), usersSlot));
  app.replaceChildren(root);

  function draw() {
    const loaded = !!data;
    const value = (n) => (loaded ? n : "…");
    const { activities = [], users = [] } = data || {};
    const pending = activities.filter((r) => r.needs_details).length;

    mount(alertSlot, pending > 0 && h("a", { class: "alert", href: "#/manual-entries" }, `⚠ ${pending} pending manual ${pending === 1 ? "entry" : "entries"} →`));
    const parkedVehicles = buildVehicleRows(data?.students).filter((v) => v.parked);
    mount(statsSlot,
      stat("Registered users", value(users.length), { href: "#/users" }),
      stat("Users currently parked", value(countParkedUsers(users)), { href: "#/parked-users" }),
      stat("Vehicles registered", value(countVehicles(users)), { href: "#/vehicles" }),
      stat("Parked Vehicles", value(parkedVehicles.length), { href: "#/parked-vehicles", sub: loaded ? breakdownText(countByBucket(parkedVehicles)) : "" }));
    if (!loaded) return;
    mount(activitySlot, table(activityColumns, activities.filter((r) => showDenied || r.granted).slice(0, RECENT_LIMIT), "No activity yet."));
    mount(usersSlot, table(userColumns, recentlyRegistered(users, RECENT_LIMIT), "No users yet."));
  }

  draw();
  return subscribeActivities((next) => { data = next; draw(); });
}
