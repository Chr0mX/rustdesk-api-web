# TODO

- Redesign the `_admin` panel (this app) to better match the bundled
  webclient's design. The two are visually inconsistent - different layout
  language, color scheme, and component styling - even though a user
  bounces between them constantly (peer list -> "Web Client" button ->
  remote session, and back). A design mockup was provided (Ant Design Pro
  demo template re-skinned with RustDesk branding - static export only, not
  a working backend integration, so only the login page and the page/route
  inventory could actually be seen).
  - [x] Login page (`src/views/login/login.vue`): restyled to match the
    mockup - light background, centered logo/wordmark, icon-prefixed
    inputs, and reused the existing dark-mode switch + language dropdown
    (previously only in the authenticated layout header) top-right, same
    placement as the mockup.
  - [x] Global primary color (`src/styles/style.scss`): switched from
    Element Plus's stock `#409eff` to `#1677ff`, matching both the mockup
    and the webclient's own branding blue.
  - [ ] Main authenticated layout shell (sidebar + header,
    `src/layout/`): not started. The mockup's route list
    (`Settings/{License,Ldap,Smtp,Relay,Token,Oidc,Strategy,Others}`,
    `RoleList`, `GroupList`, `ControlRole`, `DeviceGroupList`, `AuditList`
    split into Conn/File/Alarm/Console, etc.) is a noticeably larger
    RBAC/settings surface than this app currently has - worth deciding
    whether to actually build out that IA or just restyle the existing
    page set before taking this further.
  - [ ] Individual page content (tables, forms, cards) not yet touched.
- `src/views/settings/license.vue` is a stale "ComingSoon" placeholder with
  no real implementation - needs either an actual License settings UI or
  to come out of the settings menu.
