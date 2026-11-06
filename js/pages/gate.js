import { subscribeActivities } from "../data.js";
import { activityColumns, layout, skeleton, stat, table } from "../ui.js";
import { breakdownText, buildVehicleRows, countByBucket, h, mount, today } from "../utils.js";

const LATEST_LIMIT = 8;
export default function gatePage(app) {
  let data = null;

  const alertSlot = h("div");
  const statsSlot = h("div", { class: "stats" });
  const latestSlot = h("div", {}, skeleton());

  const { root, body } = layout("Gate", [h("a", { class: "btn pri", href: "#/manual-entries" }, "Manual entries")]);
  body.append(
    alertSlot, statsSlot,
    h("section", { class: "card" }, h("h2", {}, "Latest activity ", h("a", { href: "#/activities" }, "See all →")), latestSlot));
  app.replaceChildren(root);

  function draw() {
    const loaded = !!data;
    const value = (n) => (loaded ? n : "…");
    const { activities = [], students = {} } = data || {};
    const pending = activities.filter((r) => r.needs_details).length;
    const parked = buildVehicleRows(students).filter((v) => v.parked);

    mount(alertSlot, pending > 0 && h("a", { class: "alert", href: "#/manual-entries" }, `⚠ ${pending} pending manual ${pending === 1 ? "entry" : "entries"} →`));
    mount(statsSlot,
      stat("Pending manual entries", value(pending), { href: "#/manual-entries", go: "Review entries →" }),
      stat("Vehicles parked", value(parked.length), { href: "#/parked-vehicles", sub: loaded ? breakdownText(countByBucket(parked)) : "" }),
      stat("Today’s activity", value(activities.filter((r) => r.date === today()).length), { href: "#/activities?range=today", go: "View today’s activity →" }));
    if (!loaded) return;
    mount(latestSlot, table(activityColumns, activities.filter((r) => r.granted).slice(0, LATEST_LIMIT), "No activity yet."));
  }

  draw();
  return subscribeActivities((next) => { data = next; draw(); });
}
