# DevDeck — Mac + iPhone 14 Coding Companion PWA

Turn an iPhone 14 (mounted in landscape next to your Mac) into an OLED-optimized hardware macro deck, live system monitor, port killer, git launch controller, and local webhook inspector over Wi-Fi with **zero cloud dependencies**.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Both Workspaces (`mac-bridge` + `iphone-pwa`)
```bash
npm run dev
```
This starts:
- **`mac-bridge`** on `http://<LAN_IP>:4747` (WebSocket `/ws`, REST `/api/*`, Webhook listener `/hook/*`)
- **`iphone-pwa`** on `http://<LAN_IP>:3000` (Next.js App Router PWA)

### 3. Pair Your iPhone 14
1. Ensure your iPhone and Mac are on the **same Wi-Fi network**.
2. Point the iPhone Camera at the **QR code** printed in your Mac terminal — it opens DevDeck and pairs automatically.
   - Alternatively, open `http://<LAN_IP>:3000` in Safari and type the **6-digit PIN** shown in the terminal.
3. In Safari, tap **Share → Add to Home Screen** and launch DevDeck in **landscape mode** for the full borderless OLED experience with Screen Wake Lock.

---

## macOS Permissions Setup

For full macOS hardware & shortcut control, grant these permissions to the terminal app running `npm run dev` (e.g., Terminal, iTerm2, Warp, or VS Code):

1. **Accessibility (Required for Shortcuts, Auto-Paste, Brightness & Scroll Dial)**
   - Open **System Settings → Privacy & Security → Accessibility**.
   - Enable your terminal application.
2. **Automation (System Events / Spotify / Music)**
   - On first use, macOS will prompt to allow your terminal to control **System Events**, **Spotify**, or **Music**. Click **Allow**.
3. **Optional: macOS Focus / Do Not Disturb Shortcut**
   - In the Apple **Shortcuts** app, create two shortcuts named:
     - `DevDeck Focus On` (Action: *Turn Do Not Disturb On*)
     - `DevDeck Focus Off` (Action: *Turn Do Not Disturb Off*)
   - If these shortcuts aren't created, Deep Work Focus automatically falls back to muting Mac audio during Pomodoro sessions.

---

## Configuration & Local Storage

- **Persisted Config:** `mac-bridge/data/config.json` stores your pairing token, custom macros, profiles, snippets, log presets, and `projectDir` (defaults to the repo root; override with `DEVDECK_PROJECT_DIR=/path/to/repo`).
- **Desk Scans:** Photos snapped in **Hardware Tools → Desk Scanner** are compressed and saved to `mac-bridge/scans/`, and the absolute file path is copied to your Mac clipboard.
- **Webhook & API Ticker:** Send any local HTTP request to `http://<LAN_IP>:4747/hook/<anything>`:
  ```bash
  curl -X POST http://127.0.0.1:4747/hook/stripe \
    -H "Content-Type: application/json" \
    -d '{"event":"payment_intent.succeeded","amount":4900}'
  ```

---

## Antigravity MCP Integration (`notify_iphone`)

DevDeck includes a lightweight local stdio MCP server at `mac-bridge/dist/mcp/server.js` exposing `notify_iphone(title, message, status)` so Antigravity agents can push live task-complete alerts or interactive **Accept / Reject** approval cards directly to your iPhone 14.

1. Build the bridge once: `npm run build -w mac-bridge`
2. Add DevDeck to your Antigravity MCP config (`~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "devdeck": {
      "command": "node",
      "args": ["/Users/youssefhalawanyy/HELPER/mac-bridge/dist/mcp/server.js"]
    }
  }
}
```

Supported `status` values: `"info"`, `"success"`, `"warning"`, `"error"`, `"approval"` (adds one-tap **Accept ⌘↵** / **Reject ⌘⌫** buttons on the iPhone notification card).

---

## Useful Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Run `mac-bridge` and `iphone-pwa` simultaneously |
| `npm run typecheck` | Run TypeScript checks across both workspaces |
| `npm run build` | Production build for both `mac-bridge` and `iphone-pwa` |

---

## Security Model

- All WebSocket connections (`/ws?token=...`) and `/api/*` endpoints require the locally generated 32-byte pairing token.
- `/api/pair` is rate-limited and exchanges the terminal's 6-digit PIN for the session token.
- Arbitrary unauthenticated shell execution is never permitted: macros execute only by `macroId` looked up in `mac-bridge/data/config.json`, shortcuts are strictly whitelisted, and port kills verify the target PID against active local dev ports.
