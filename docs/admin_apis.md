# Admin APIs

## Remote Procedure Calls (RPC)

Commands to control the match room can be sent as individual RPC calls. The commands mimic the websocket frames used internally by the application.

### Endpoint

**POST** `/api/host/rpc`

### Headers

- `x-ntc-secret`: `<PLAYER_SECRET>`
- `Content-Type`: `application/json`

### Body Format

The RPC syntax requires a JSON array payload where the first element is the command name, followed by its arguments.

```json
["command_name", <arg1>, <arg2>, ...]
```

### Supported Commands

Below is the list of currently supported RPC commands and their effects.

*Note: `player_index` is zero-based. Player 1 in the room is index `0`, player 2 is index `1`, etc.*

#### `setDisplayName`
Sets the display name for a specific player.
- **Format:** `["setDisplayName", <player_index>, "<name>"]`
- **Example:** `["setDisplayName", 0, "Jacob"]`

#### `setCountryCode`
Sets the country code (2-letter ISO code for the flag) for a specific player.
- **Format:** `["setCountryCode", <player_index>, "<country_code>"]`
- **Example:** `["setCountryCode", 0, "SG"]`

#### `setVictories`
Sets the number of victories (current score) for a specific player.
- **Format:** `["setVictories", <player_index>, <num_victories>]`
- **Example:** `["setVictories", 0, 2]`

#### `resetVictories`
Resets the victories for all players in the match room to 0.
- **Format:** `["resetVictories"]`
- **Example:** `["resetVictories"]`

#### `setBestOf`
Sets the "Best Of" target for the match (e.g., Best of 5, Best of 7).
- **Format:** `["setBestOf", <best_of_count>]`
- **Example:** `["setBestOf", 7]`

#### `setMatch`
Controls which match is displayed in the view, primarily used when concurrent matches are active.
- **Format:** `["setMatch", <match_config>]`
  - Valid `<match_config>` values:
    - 2-match layouts: `0` (Match 1), `1` (Match 2), `"both"` (Show both matches).
    - 4-match layouts: `0` (Match 1), `1` (Match 2), `2` (Match 3), `3` (Match 4), `"all"` (Show all 4 matches).
- **Example:** `["setMatch", "both"]` or `["setMatch", "all"]`

---

## Example Usage with cURL

```bash
# Set display name for player 1 (index 0) to "Jacob"
curl -X POST http://localhost:5001/api/host/rpc \
  -H "x-ntc-secret: PLAYER1" \
  -H "Content-Type: application/json" \
  -d '["setDisplayName", 0, "Jacob"]'

# Reset victories for all players
curl -X POST http://localhost:5001/api/host/rpc \
  -H "x-ntc-secret: PLAYER1" \
  -H "Content-Type: application/json" \
  -d '["resetVictories"]'
```

> [!NOTE]
> The system currently reuses the existing player secret for player identification (that are used for the views). However, since secrets are readable from the DB, this is not ideal for API bearer tokens that can trigger mutations. A separate "proper" API token might be introduced in the future.
