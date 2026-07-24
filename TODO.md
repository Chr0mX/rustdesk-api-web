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
  - [x] Main authenticated layout shell (`src/layout/`): header switched
    from a hardcoded-dark background to the theme-aware
    `--el-bg-color`/`--el-text-color-primary` (so it's actually white in
    light mode and correctly follows the dark-mode toggle, which it didn't
    before - it was just always dark), matching the mockup's light-header
    convention. Sidebar kept dark (already matches Ant Design Pro's classic
    "dark sidebar + light header" look) but its active-item color now
    follows the shared primary color instead of a separately hardcoded
    `#409eff`.
  - [ ] Individual page content (tables, forms, cards) not yet touched -
    still using whatever ad hoc styling each page already had.
  - [ ] The mockup's route list
    (`Settings/{License,Ldap,Smtp,Relay,Token,Oidc,Strategy,Others}`,
    `RoleList`, `GroupList`, `ControlRole`, `DeviceGroupList`, `AuditList`
    split into Conn/File/Alarm/Console, etc.) is a noticeably larger
    RBAC/settings surface than this app currently has - worth deciding
    whether to actually build out that IA or just keep restyling the
    existing page set.
- `src/views/settings/license.vue` is a stale "ComingSoon" placeholder with
  no real implementation - needs either an actual License settings UI or
  to come out of the settings menu.
