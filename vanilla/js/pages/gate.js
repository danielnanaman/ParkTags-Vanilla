import { subscribeActivities } from "../data.js";
import { openActivityModal } from "../modals.js";
import { activityColumns, layout, skeleton, stat, table, withAddDetails } from "../ui.js";
import { countParkedVehicles, h, mount, today } from "../utils.js";

const LATEST_LIMIT = 8;

export default function gatePage(app) {
  let data = null;
  const openEntry = (pendingLog = null) => data && openActivityModal({ students: data.students, pendingLog });

  const pendingColumns = withAddDetails([
    { header: "Time", render: (r) => r.time },
    { header: "Card", render: (r) => r.card_uid || "N/A" },
    { header: "Direction", render: (r) => r.label },
    { header: "Reader", render: (r) => r.reader || "N/A" },
  ], openEntry);

  const statsSlot = h("div", { class: "stats" });
  const pendingSlot = h("div", {}, skeleton());
  const latestSlot = h("div", {}, skeleton());

  const { root, body } = layout("Gate", [h("button", { class: "btn pri", onclick: () => openEntry() }, "+ Manual entry")]);
  body.append(
    statsSlot,
    h("section", { class: "card" }, h("h2", {}, "Gate card entries needing details"), pendingSlot),
    h("section", { class: "card" }, h("h2", {}, "Latest activity ", h("a", { href: "#/activities" }, "See all →")), latestSlot));
  app.replaceChildren(root);

  function draw() {
    const value = (n) => (data ? n : "…");
    const { activities = [], students = {} } = data || {};
    const pending = activities.filter((r) => r.needs_details);
    mount(statsSlot,
      stat("Needs details", value(pending.length)),
      stat("Vehicles parked", value(countParkedVehicles(students))),
      stat("Today’s activity", value(activities.filter((r) => r.date === today()).length)));
    if (!data) return;
    mount(pendingSlot, table(pendingColumns, pending, "All gate entries have details."));
    mount(latestSlot, table(activityColumns, activities.filter((r) => r.granted).slice(0, LATEST_LIMIT), "No activity yet."));
  }

  draw();
  return subscribeActivities((next) => { data = next; draw(); });
}
