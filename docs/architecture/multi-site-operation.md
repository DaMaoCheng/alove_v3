# Multi-Site Operation Architecture

> 历史状态：本文保留早期多站点架构设计和数据演进背景。当前长期产品规则请看 [站点上下文规范](../design/01-navigation-and-site-context.md)。尤其是本文“邀请码优先于路径”的早期提案已不代表当前实现：现在显式站点路径固定上下文，邀请码仅在当前站点内校验。

## Goal

AIOVE needs to support multiple independently operated site groups under one shared backend. Users, creator characters, default mascot characters, invites, and future ads must all resolve through a stable site identity.

This is not a country model and not just a language model. A site is a business grouping with its own URL slug, creator roster, default mascot, and future marketing configuration.

## Confirmed Product Rules

- Every user belongs to exactly one site.
- A user's site decides their default landing path and which creator characters they can see.
- Logged-in non-admin users cannot freely browse another site's user-facing pages. If they enter another site's path, they are redirected back to their own site path.
- Site assignment priority during registration is:
  1. Invite link or invite code owner site.
  2. Current URL site slug.
  3. IP/browser fallback mapping.
  4. Admin-configured default site.
- Users migrated from independent stores will be imported with an explicit site assignment.
- Ordinary users create common characters. Common characters are searchable and visible across all sites without approval.
- Creator accounts can create creator characters. Creator characters are site-specific influencer characters.
- Ordinary users cannot see the Creator category on the create-character page.
- Creator accounts can see the Creator category, but can create only one creator character.
- Admins are exempt from creator restrictions and can see/configure all sites and all character kinds.
- A creator character never migrates between sites. If an influencer moves, create a new account and new character rather than reusing old data.
- Mascots are real AI character records and are permanently activated for users. Users cannot delete their mascot contact.
- Product API and commerce recommendation ability are out of scope for the first implementation phase.

## Core Concepts

### Site

A site is a stable business group.

Example:

```txt
sites.id          = site_latam
sites.name        = AIOVE Latam
sites.slug        = latam
sites.language    = es
sites.currency    = MXN
```

User-facing URL:

```txt
https://alove.fans/latam
```

Internal references use `site_id`, not the display name or slug.

### Character Kind

Add an explicit character kind to `ai_characters`:

```txt
common   - globally visible ordinary/common characters
creator  - site-specific influencer characters
mascot   - site mascot characters that are auto-activated
```

Rules:

- `common`: `site_id` is null.
- `creator`: `site_id` is required.
- `mascot`: can have `site_id`; a global fallback mascot can have null site.

### Mascot As AI Character

Mascots should be stored in `ai_characters`, not a separate chat object system. This reuses existing avatar, prompt, opening line, chat, memory, activation, and contact list behavior.

Sites bind a default mascot character:

```txt
sites.default_mascot_character_id = char_chispa
```

On registration, activate that mascot through `user_character_activations` with a special source type.

## Proposed Database Changes

### `sites`

```sql
CREATE TABLE sites (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(96) NOT NULL,
  slug VARCHAR(96) NOT NULL,
  default_language VARCHAR(32) NULL,
  currency VARCHAR(16) NULL,
  default_mascot_character_id VARCHAR(64) NULL,
  product_api_url VARCHAR(512) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  site_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_sites_slug (slug),
  KEY idx_sites_default_status (is_default, site_status)
);
```

`product_api_url` can be added now as inert configuration or deferred. Since product API is out of scope, it can remain nullable and unused.

### `users`

Add:

```sql
site_id VARCHAR(64) NULL
```

Indexes:

```sql
KEY idx_users_site_status (site_id, account_status)
```

Later, after migration/import is complete and default assignment is stable, make `site_id` operationally required at the service layer. A DB-level NOT NULL can be delayed to avoid blocking old seed rows during development.

### `ai_characters`

Add:

```sql
character_kind VARCHAR(32) NOT NULL DEFAULT 'common'
site_id VARCHAR(64) NULL
```

Indexes:

```sql
KEY idx_ai_characters_kind_site_status (character_kind, site_id, character_status, visibility)
KEY idx_ai_characters_owner_kind (owner_uid, character_kind)
```

Backfill suggestions:

- Category `creator` seeds can become `creator` only after assigning a site.
- Non-creator demo characters default to `common`.
- Mascot seed(s) should be created explicitly when implementing site defaults.

### `user_character_activations`

Use existing table. Add or standardize source metadata:

```txt
source_type = mascot_auto
source_ref  = sites.id
```

Deletion/removal logic must protect activations with `source_type = mascot_auto`.

## Routing And Site Resolution

### Site Context

Introduce a server-side site resolver:

Input sources:

- Path slug: first URL segment, e.g. `/latam`.
- Invite code/referral code.
- Logged-in user session.
- IP/browser fallback.
- Default site.

Outputs:

```js
{
  siteId,
  slug,
  source: 'session' | 'invite' | 'path' | 'geo' | 'default'
}
```

### Logged-In Redirect Rules

For authenticated non-admin users:

- If URL site slug matches `users.site_id`, allow.
- If URL site slug differs, redirect to their assigned site slug.
- Root `/` redirects to assigned site slug.

For admin users:

- Admin console can view all sites.
- User-facing preview can later support explicit preview site selection.

## Registration And Import Rules

### Registration

When creating a user, determine `site_id` in this order:

1. Invite/referral code owner site.
2. Current path slug.
3. IP/browser fallback mapping.
4. Default site.

Then:

1. Insert user with `site_id`.
2. Create billing account.
3. Activate default mascot for that site.
4. Continue existing session/cookie flow.

### Invite Rule

Existing `referral_code` / `used_referral_code` can be reused.

If B registers with A's invite code:

```txt
B.site_id = A.site_id
B.used_referral_code = A.referral_code
```

### Independent Store Migration

Import script should require at least:

```txt
email, nickname, auth method/password strategy, site_slug
```

The script resolves `site_slug` to `sites.id` and inserts `users.site_id`.

## Character Visibility Rules

Public list/search should return:

```sql
WHERE character_status = 'published'
  AND visibility = 'public'
  AND (
    character_kind = 'common'
    OR (character_kind = 'creator' AND site_id = current_user_site_id)
  )
```

Mascots should not appear in public discover/search by default unless explicitly requested.

Character detail should reject access to another site's creator character for non-admin users.

Contact list should protect mascot auto-activation and avoid showing unavailable cross-site creator contacts after site changes. Since influencer migration is not supported, normal user site changes should be rare and admin-controlled.

## Create Character Rules

### Ordinary User

- Creator category hidden.
- Submitted characters become `character_kind = common`.
- `site_id = null`.
- Public characters are visible/searchable across all sites.

### Creator Account

- Creator category visible.
- Submitted creator character becomes `character_kind = creator`.
- `site_id = users.site_id`.
- Enforce one creator character per creator account.
- Creator cannot self-manage/delete after creation.

### Admin

- Creator category visible.
- No one-character restriction.
- Admin can assign or edit character site in admin pages.

## Admin Console Changes

### Navigation

Replace current single AI role page with:

- `网红角色`
- `通用角色`
- `站点管理`
- `看板娘管理`

Keep product API and ads out of first implementation unless explicitly requested.

### Site Management

List/edit:

- name
- slug
- default language
- currency
- default mascot character
- default site flag
- status

No country flag UI.

### Creator Characters Page

- Site filter.
- Columns: character, role, site, status, chats, actions.
- Create/edit requires site.
- Admin only.

### Common Characters Page

- No site column.
- Columns: character, role, status, chats, actions.
- Admin only.

### Account Management

Add site column and editable site assignment.

Changing a user's site should be admin-only and should show confirmation because it affects:

- login redirect
- creator visibility
- invite inheritance
- mascot assignment

For first phase, after site change:

- Ensure new site's mascot is active.
- Do not migrate old creator role data.
- Optionally hide old-site creator contacts via visibility checks.

## Mascot Rules

A site must resolve to exactly one default mascot:

1. `sites.default_mascot_character_id`
2. system default mascot if site does not set one

On registration/import:

- Activate resolved mascot.
- Activation is permanent.
- User cannot delete it.

If admin changes a site's default mascot later, existing users are not automatically migrated unless a separate batch operation is built.

## Out Of Scope For First Phase

- Product API integration.
- Real ad delivery and CTR tracking.
- Dynamic AI product recommendation.
- Old slug redirect mapping.
- Country flag UI.
- Cross-site creator migration.

## Recommended First Implementation Slice

1. Add site data model and seed default sites.
2. Add `users.site_id` and `ai_characters.character_kind/site_id`.
3. Add site resolver and registration assignment.
4. Add mascot auto-activation.
5. Update public character list/search filtering.
6. Update create-character category visibility and creator limit.
7. Split admin role management into creator/common pages.
8. Add basic site management and account site assignment.

This slice gives the platform a real multi-site foundation without touching product API or ad delivery yet.
