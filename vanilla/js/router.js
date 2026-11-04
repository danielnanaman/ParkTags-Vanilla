// Hash router with role guards. Each page is a function (container, params) that renders itself
// and returns an optional cleanup function (used to unsubscribe from live data).
import { HOME } from "./constants.js";
import { logout, session } from "./auth.js";
import { h } from "./utils.js";
import accounts from "./pages/accounts.js";
import activities from "./pages/activities.js";
import archive from "./pages/archive.js";
import cards from "./pages/cards.js";
import dashboard from "./pages/dashboard.js";
import gate from "./pages/gate.js";
import login from "./pages/login.js";
import profile from "./pages/profile.js";
import users from "./pages/users.js";

const ADMIN = ["admin"];
const STAFF = ["admin", "guard"];

const ROUTES = [
  { path: "/gate", roles: STAFF, page: gate },
  { path: "/activities", roles: STAFF, page: activities },
  { path: "/dashboard", roles: ADMIN, page: dashboard },
  { path: "/users", roles: ADMIN, page: users },
  { path: "/users/:id", roles: ADMIN, page: profile },
  { path: "/cards", roles: ADMIN, page: cards },
  { path: "/accounts", roles: ADMIN, page: accounts },
  { path: "/archive", roles: ADMIN, page: archive },
];

function matchRoute(path) {
  for (const route of ROUTES) {
    const pattern = new RegExp(`^${route.path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
    const match = path.match(pattern);
    if (match) return { route, params: Object.fromEntries(Object.entries(match.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)])) };
  }
  return null;
}

const redirect = (path) => { if (location.hash !== `#${path}`) location.hash = `#${path}`; };
const screen = (...children) => h("div", { class: "login" }, children);

let cleanup = null;

export function route() {
  cleanup?.();
  cleanup = null;
  const app = document.getElementById("app");
  const path = location.hash.slice(1).split("?")[0] || "/";

  if (!session.ready) return app.replaceChildren(screen(h("div", { class: "skel", style: "width:240px" })));
  if (!session.user) return path === "/" ? login(app) : redirect("/");

  if (!HOME[session.role]) {
    return app.replaceChildren(screen(h("div", { class: "card" },
      h("h2", {}, "Access pending"),
      h("p", { class: "mut" }, `${session.user.email} can’t use the web app yet. Ask an administrator to assign a role.`),
      h("button", { class: "btn", onclick: logout }, "Log out"))));
  }

  const match = matchRoute(path);
  if (!match || !match.route.roles.includes(session.role)) return redirect(HOME[session.role]);
  cleanup = match.route.page(app, match.params) || null;
}
