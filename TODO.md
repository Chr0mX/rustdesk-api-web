# TODO

- Redesign the `_admin` panel (this app) to better match the bundled
  webclient's design (see `resources/web` in `rustdesk-api`, currently the
  "RustDesk Web Client V2 Preview" build). The two are visually
  inconsistent right now - different layout language, color scheme, and
  component styling - even though a user bounces between them constantly
  (peer list -> "Web Client" button -> remote session, and back).
- `src/views/settings/license.vue` is a stale "ComingSoon" placeholder with
  no real implementation - needs either an actual License settings UI or
  to come out of the settings menu.
