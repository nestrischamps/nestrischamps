# User APIs

User APIs are authenticated using the `x-ntc-secret` header matching the user's secret.

## Headers

- `x-ntc-secret`: `<PLAYER_SECRET>`

---

## Score Endpoints

### Get Scores History

Fetch paginated score history for the authenticated user.

- **GET** `/api/user/scores`

### Get Score Details

Fetch detailed metrics for a specific score owned by the user.

- **GET** `/api/user/scores/:id`

### Update Score Competition Flag

Toggle the competition flag for a score owned by the user.

- **PUT** `/api/user/scores/:id/competition/:mode`

#### Parameters

- `:id`: ID of the score/game.
- `:mode`: `1` to set as competition score; `0` to set as regular score.

#### Example Usage with cURL

```bash
# Set score 123 as competition score
curl -X PUT http://localhost:5001/api/user/scores/123/competition/1 \
  -H "x-ntc-secret: PLAYER1"

# Set score 123 as non-competition score
curl -X PUT http://localhost:5001/api/user/scores/123/competition/0 \
  -H "x-ntc-secret: PLAYER1"
```
