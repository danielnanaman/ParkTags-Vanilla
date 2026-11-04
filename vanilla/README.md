# STI ParkTags (vanilla HTML / CSS / JavaScript)

No framework, no build step, no `npm install`. Firebase and the Excel reader load from CDNs.

## Run it

Browsers block ES modules on `file://`, so serve the folder over HTTP:

```bash
python3 -m http.server 8080      # then open http://localhost:8080
# or: npx serve .
```

It also deploys as-is to GitHub Pages, Netlify, Firebase Hosting, etc. (hash routing, so no server rewrites needed).

## Pages (one file per nav item)

```
js/pages/
  dashboard.js   activities.js   users.js   cards.js   accounts.js   archive.js   (admin nav)
  gate.js        activities.js                                                    (guard nav)
  login.js       profile.js     (profile opens from Users)
```

Each page is `export default function (container, params)`: it renders itself, subscribes to live data,
and returns a cleanup function that the router calls when you navigate away.

## Shared modules

| File | Contents |
|---|---|
| `js/firebase.js` | Firebase init (SDK version is one constant) |
| `js/constants.js` | DB paths, nav links, option lists |
| `js/utils.js` | `h()` DOM helper, dates, validation, row builders, filters, Excel parsing |
| `js/data.js` | Live reads (`subscribeActivities`, `subscribeUsers`, `subscribeArchive`) |
| `js/services.js` | Every Firebase write, including archive and restore |
| `js/auth.js` | Sign-in state and role lookup |
| `js/ui.js` | Toast, modal, confirm, table, pager, filter bar, layout, shared columns |
| `js/modals.js` | Add user, edit profile, vehicle, manual entry, Excel import |
| `js/router.js` / `js/main.js` | Hash router with role guards / entry point |

## Archive (admin only)

**Archive** in the nav lists removed users, vehicles, gate cards and accounts, each with a **Restore** button.
Restoring a user brings back their vehicles as *Not parked*; a vehicle can only be restored while its owner is active;
a restore never overwrites live data (a conflicting ID shows an error). No database rule changes are needed.

## Notes

- Text is inserted through `h()` (DOM nodes / text nodes), never `innerHTML`, so user-entered names can't inject markup.
- `database.rules.json` and the Excel import template are unchanged.
