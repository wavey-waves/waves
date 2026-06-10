# Database Schema

MongoDB via Mongoose. Three models, all with `{ timestamps: true }` (adds `createdAt` / `updatedAt`). All three carry an `expiresAt` field with a TTL index (`index: { expires: 0 }`) so documents are auto-deleted by MongoDB once `expiresAt` passes.

## Users (`models/user.model.js`, collection `users`)

Registered as `mongoose.model("Users", ...)`.

| Field | Type | Constraints / default |
| --- | --- | --- |
| `userName` | String | required, **unique**, trimmed, minlength 1 |
| `password` | String | optional (only set for non-anonymous users; stored bcrypt-hashed) |
| `color` | String | required, trimmed |
| `isAnonymous` | Boolean | default `false` |
| `expiresAt` | Date | TTL index (`expires: 0`); set by a pre-save hook (see below) |
| `createdAt`, `updatedAt` | Date | from `timestamps` |

**TTL behavior** — a `pre('save')` hook sets `expiresAt` on every save:

- anonymous user → `now + 7 days`
- registered user → `now + 365 days` (1 year)

## Rooms (`models/room.model.js`, collection `rooms`)

Registered as `mongoose.model("Rooms", ...)`.

| Field | Type | Constraints / default |
| --- | --- | --- |
| `roomName` | String | required, **unique**, trimmed |
| `code` | String | **unique + sparse** (null allowed), uppercased, `length: 6` |
| `members` | [ObjectId → `Users`] | array of member refs |
| `createdByIp` | String | optional |
| `isCustomRoom` | Boolean | default `false` |
| `expiresAt` | Date | default `now + 40 days`; TTL index (`expires: 0`) |
| `createdAt`, `updatedAt` | Date | from `timestamps` |

> The global room is **not** persisted as a `Rooms` document — `global-room` is implicit. Network rooms (`network-<subnet>`) and custom rooms (`custom-<CODE>`) are created on demand.

### `generateUniqueCode()` static

```js
roomSchema.statics.generateUniqueCode = async function () {
  let code, exists = true;
  while (exists) {
    code = Math.random().toString(36).substring(2, 8).toUpperCase(); // 6 chars
    exists = !!(await this.findOne({ code }));
  }
  return code;
};
```

Loops until it finds a code not already in `rooms`. Used by `createRoom` (the resulting `roomName` is `custom-<code>`).

## Message (`models/message.model.js`, collection `messages`)

Registered as `mongoose.model("Message", ...)`.

| Field | Type | Constraints / default |
| --- | --- | --- |
| `senderId` | ObjectId → `Users` | required |
| `room` | String | required, default `"global-room"` |
| `text` | String | optional |
| `reactions` | [reaction sub-doc] | default `[]`, with a custom validator (see below) |
| `expiresAt` | Date | default `now + 31 days`; TTL index (`expires: 0`) |
| `createdAt`, `updatedAt` | Date | from `timestamps` |

### Reactions sub-schema

Each entry in `reactions`:

| Field | Type | Constraints / default |
| --- | --- | --- |
| `userId` | ObjectId → `Users` | required |
| `emoji` | String | required |
| `createdAt` | Date | default `Date.now` |

**One-reaction-per-user validator** — the `reactions` array has a validator that fails if any `userId` appears more than once:

```js
validate: {
  validator: (reactions) => {
    const userIds = reactions.map(r => r.userId.toString());
    return userIds.length === new Set(userIds).size;
  },
  message: 'Each user can only have one reaction per message'
}
```

The `reactToMessage` controller enforces the same rule procedurally: toggling the same emoji removes it; reacting with a new emoji first strips any existing reaction from that user, then pushes the new one. So at most one reaction per user per message.

## TTL summary

| Model | `expiresAt` set to | Where set |
| --- | --- | --- |
| Users (anonymous) | `now + 7 days` | `pre('save')` hook |
| Users (registered) | `now + 365 days` | `pre('save')` hook |
| Rooms | `now + 40 days` | schema default |
| Message | `now + 31 days` | schema default |

Note: user `expiresAt` is recomputed on **every save** by the hook, so re-saving a registered user refreshes the 1-year window. Room/message `expiresAt` is only set at document creation via the default (not refreshed on later saves).

## Manual message cleanup

Separate from TTL: `DELETE /api/messages/cleanup` keeps only the latest **1000** messages per room (`NO_OF_MESSAGES`), deleting older ones. See [API.md](./API.md).
