# Gmail Subject Renamer

Chrome extension that lets you **locally rename email subject lines** in Gmail.  
All renames are stored in your browser only — nothing is sent to any server, and the original sender never sees the change.

---

## Installation (developer mode)

1. Open **Chrome** → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder (`rename-subject-gmail/`)
5. Open [Gmail](https://mail.google.com) — the extension is active

---

## How to use

| Step | Action                                                        |
| ---- | ------------------------------------------------------------- |
| 1    | Open any email thread in Gmail                                |
| 2    | Click the **✏️** button that appears next to the subject line |
| 3    | Type your new subject in the popup and press **Save**         |
| 4    | To undo, click ✏️ again → **Reset to original**               |

Renamed subjects in the inbox list are shown in _italic_ with a small ✏️ indicator.

---

## How it works

- A **content script** runs on `mail.google.com` and watches the Gmail SPA via `MutationObserver`.
- When you open a thread, it checks `chrome.storage.local` for a saved rename keyed by Gmail's **thread ID**.
- Renames are applied client-side by replacing the visible text node — **no Gmail API, no network calls**.
- List view rows are matched via the `data-thread-id` attribute Gmail puts on each `<tr>`.

---

## Permissions

| Permission                          | Reason                                 |
| ----------------------------------- | -------------------------------------- |
| `storage`                           | Save your custom subject names locally |
| `host_permissions: mail.google.com` | Inject the content script into Gmail   |

No other permissions are requested.

---

## Files

```
rename-subject-gmail/
├── manifest.json   – Extension manifest (MV3)
├── content.js      – Main logic: observer, rename, modal
├── content.css     – Styles for the button and modal
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
