# Query String Arguments in NesTrisChamps

## Context

NesTrischamps is a web application and uses standard [query string arguments](https://en.wikipedia.org/wiki/Query_string) to give some control to users. For example some arguments allow renderers to change background, or disable tetris sound.

When loading a url, query string arguments are key/value pairs, separated by the character `&`, like this: `name=yobi&state=online`.

The query string as a whole is appended to the page url after the character `?` for example: `https://nestrischamps.io/view/ctwc23/SECRET?name=yobi&state=online`.


## Capture page arguments

The capture page (a.k.a. producer page) supports some query string arguments as follows:

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `disable_half_height`  | `0`: Deinterlace the input by halving the capture size before processing<br>`1`: DON'T deinterlace the input by halving the capture size before processing | `0` | Changing this value will change the capture size and thus breaks the calibration. You need to calibrate from scratch. |
| `tts`  | `0`: DON'T speak Twitch chat message<br>`1`: Use browser's [Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) to speak Twitch chat messages | `0` | |
| `webcam_audio` | `0`: DON'T send audio stream with player webcam feed<br>`1`: Send audio input with player webcam feed| `0` | |


## Global view arguments

Caveat: global args apply to **MOST** layouts, but some layouts may not understand the values

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `bg`  | `0`: Transparent background<br>`1`: Gold Tetris blocks on a black background<br>`2`: green NTC name moving accross the screen<br>`3`: Rainbow NTC name moving the screen<br>`4`: Wavy green NTC name moving across the screen <br>`5`: NTC trophies (not working well)| `1` | In OBS, prefer to set `bg=0` to save on resources on the browser source. |
| `tetris_sound` | `0`: DON'T play tetris sounds<br>`1`: Play tetris sounds| `1` | Some Layout defaults to `0` instead, use `1` explicitly to activate (e.g. `jdish` layout) |
| `tetris_flash` | `0`: NO Flash<br>`1`: Classic flash<br>`2`: Fade Flash<br>`3`: Swipe Flash<br>`4`: Explode Flash | `2` | Classic Flash may cause discomfort for viewers with light sensitivity |
| `avatar` | `0`: NO avatar underneath the playfield<br>`1`: Show avatars underneath the playfield | `1` | Avatar images are taken from Twitch<br>Avatar images can be overridden to custom images in the admin page |
| `video` | `0`: DON'T display player video<br>`1`: Play player video | `1` | Even if video is not set to zero, video only show if users agree to share their video in their producer page |
| `buffer_time` | An integer value representing the number of milliseconds for frames to be buffered before they are rendered. E.g. `500` | `0` (i.e. buffer is not used) | A buffer can be useful if the network is not very stable and rendering is choppy. Note that putting in a large value for `buffer_time` can cause the gameplay to be perceivably delayed compared to the player video feed, and look "weird" (player reacts before the thing they were doing happens!). |
| `combot` | `0`: No commentary bot<br>`1`: Activate commentary bot | `0` | Commentary bot uses the browser [Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) to give score updates for the first match in an NTC room (between player 1 and 2)|
| `lang` | `en`: Commentary bot in English<br>`fr`: Commentary bot in French | `en` | This argument controls the `combot` (see above)|
| `srabbit` | `0`: DON'T show Stack Rabbit placement recommendations<br>`1`: Show Stack Rabbit placement recommendations | `0` | |
| `srabbit_input_speed` | `2`<br>`6`<br>`7`<br>`8`<br>`10`<br>`11`<br>`12`<br>`13`<br>`13_5`<br>`14`<br>`15`<br>`18`<br>`20`<br>`24`<br>`30` | `12` | This controls the tapping speed in Hz Stack Rabbit assumes to give recommendations.|
| `srabbit_playout_length` | `0`: Stack Rabbit checks NO piece beyond current and preview <br>`1`: Stack Rabbit checks 1 piece beyond current and preview<br>`2`: Stack Rabbit checks 2 pieces beyond current and preview<br>`3`: Stack Rabbit checks 3 pieces beyond current and preview | `2` | This lets StackRabbit play out more possible combinations of future pieces into the board to give its recommendation. The higher the number the number the slower it gets.|



## Layout-specific arguments

### CTWC1080_2matches

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `cycle_tdiff` | An integer value representing the time in second before the score differential changes from score diff to tetris diff. E.g. `5` | `5` | To disable cycling, set to `0` |
| `match` | `{not set}`: show match 1 and wait for admin command to switch view<br>`0`: always show first match<br>`1`: always show second match<br>`both`: always show both matches | `{not set}` | Warning: Setting to `0`, `1`, `both` ignores admin commands to switch view!|
| `qual` | `0`: Show score/tetris diff and runways<br>`1`: DON'T show score/tetris diff and runways | `0` | `qual=1` activates "qual mode". Not showing the score/tetris diff helps indicate the players are NOT competing, they are just playing their games independently |
| `runway` | `0`: DON'T show runways<br>`1`: Always show runways| `1` ||



### CTWC23

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `cycle_tdiff` | An integer value representing the time in second before the score differential changes from score diff to tetris diff. E.g. `5` | `5` | To disable cycling, set to `0` |
| `curtain` | `{not set}`: use the default NTC curtain<br>`0`: CTWC DAS logo with experion sponsor logo<br>`1`: CTWC logo<br>`2`: CTWC logo with GFuel sponsor logo<br>`3`: CTWC logo with Red Bull sponsor logo<br>`4`: CTWC Singapore logo<br>`5`: CTWC DAS with Experion logo and url   | `{not set}` | Do not use CTWC logos without permission. Do not display "sponsored" curtain unless the company is actually sponsoring the event |
| `runways` | `{not set}`: DON'T show runways<br>`1`: Always show runways<br>`transitions`: Show runways 10 lines before transitions and on chase downs<br>`{duration},{interval}`: show the runways for `duration` seconds, every `interval` seconds (e.g. `10,60`)| `{not set}` ||
| `rbox` | `bottom`: Show runways box at the bottom<br>`top`: Show runways box at the top| `bottom` ||
| `style` | `roll`: Show runways for level `19`, `29`, `39`<br>`das`: show runways for level `19`, `29` | `roll` | |
| `qual` | `0`: Show score/tetris diff and runways<br>`1`: DON'T show score/tetris diff and runways | `0` | `qual=1` activates "qual mode". Not showing the score/tetris diff helps indicate the players are NOT competing, they are just playing their games independently |
| `seed` | `0`: Don't show the seed underneath the player name<br>`1`: Show the seed underneath the player name | `1` | Players' seeds can be set by convention by prepending number-dot-space to the player name. E.g. `1. Dog` or `22. Yobi` |
| `match` | `{not set}`: show match 1 and wait for admin command to switch view<br>`0`: always show first match<br>`1`: always show second match<br>`both`: always show both matches | `{not set}` | Warning: Setting to `0`, `1`, `both` ignores admin commands to switch view!|
| `simultris` | An integer value representing the time difference in milliseconds where 2 tetrises are considered "simulatenous" | `0` | Shows an animated graphic "Simul-Tetris!" above the player cams. If the argument is omitted, or set to `0`, the graphic will not be displayed. Recommended value is `120` milliseconds. |
| `invisible` | `0`: Don't draw invisible ghost blocks as ghost blocks <br>`1`: With invisible tetris, draw the invisible blocks as ghost blocks | `0` | This setting is only useful if the game is played in Invisible Tetris mode |
| `heartpos` | `0`: bottom, vertical<br>`1`: next to LV/TRT, vertical<br>`2`: next to Lines/next, vertical<br>`3`: next to score, horizontal<br>`4`: under flag, horizontal | `0` | This setting affect the position of hearts in the 2-match view |
| `hearts` | `0`: Standard heart graphic<br>`1`: Canadian Flag Leaves for hearts| `0` | This setting controls how hearts are rendered |
| `srabbit_rate` | `0`: No placement ratings<br>`1`: Show placement ratings | `0` | This only works if `srabbit=1` is added |
| `bracket` | Controls the seed shimmer effect, box border color, and CTWC curtaib logo. Value can be:<br>`gold`: for gold bracket<br>`silver`: for silver bracket<br>`bronze`: for bronze bracket | `{not set}` | When not set, shows the main CTWC logo |

### CTWC23x4

Same query string arguments as CTWC23, with `match` updated for 4 concurrent matches:

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `match` | `{not set}`: show match 1 and wait for admin command to switch view<br>`0`: always show match 1<br>`1`: always show match 2<br>`2`: always show match 3<br>`3`: always show match 4<br>`all`: always show all 4 matches | `{not set}` | Warning: Setting `match` ignores admin commands to switch view!|

### League

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `cycle_tdiff` | An integer value representing the time in second before the score differential changes from score diff to tetris diff. E.g. `5` | `5` | To disable cycling, set to `0` |
| `qual` | `0`: Show score/tetris diff and runways<br>`1`: DON'T show score/tetris diff and runways | `0` | `qual=1` activates "qual mode". Not showing the score/tetris diff helps indicate the players are NOT competing, they are just playing their games independently |
| `simultris` | An integer value representing the time difference in milliseconds where 2 tetrises are considered "simulatenous" | `0` | Shows an animated graphic "Simul-Tetris!" above the player cams. If the argument is omitted, or set to `0`, the graphic will not be displayed. Recommended value is `120` milliseconds. |
| `invisible` | `0`: Don't draw invisible ghost blocks as ghost blocks <br>`1`: With invisible tetris, draw the invisible blocks as ghost blocks | `0` | This setting is only useful if the game is played in Invisible Tetris mode |

### Tagteams
| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `players` | `1-1`: show 1v1<br>`1-2`: show 1v2<br>`2-1`: show 2v1<br>`2-2`: show 2v2 | `2-2` | |
| `video` | `0`: Remove player cam box<br>`1`: Show video normally | `1` | |

### Pairs
| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `pairs` | `2`: show 2 pairs<br>`3`: show 3 pairs<br>`4`: show 4 pairs | `4` | |
| `rtrt` | `0`: DON'T show Running Tetris Rate graph<br>`1`: Show Running Tetris Rate Graph | `1` | |

### Boss
| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `party` | `2`: Party of 2 against the boss<br>`3`: Party of 3 against the boss<br>`4`: Party of 3 against the boss<br>`5`: Party of 5 against the boss<br>`6`: Party of 6 against the boss<br>`7`: Party of 7 against the boss | `6` | |

### Iberiaqual
| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `border` | `{not set}`: standard NTC box borders<br>`1`: Transparent box border<br>`2`: Thin box border | `{not set}` | |
| `players` | `2`: Show 2 concurrent players<br>`3`: Show 3 concurrent players<br>`4`: Show 4 concurrent players<br>`5`: Show 5 concurrent players | `4` | |

### Battleroyale
| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `players` | `2`: Show 2 concurrent players<br>`3`: Show 3 concurrent players<br>`4`: Show 4 concurrent players<br>`5`: Show 5 concurrent players<br>`6`: Show 6 concurrent players<br>`7`: Show 7 concurrent players<br>`8`: Show 8 concurrent players | `8` | |
| `rtrt` | `0`: DON'T show Running Tetris Rate graph<br>`1`: Show Running Tetris Rate Graph | `1` | |

### Jdish

| Argument  | Possible values | Default | Notes |
| --- | --- | --- | --- |
| `left` | `0`: Show gameplay rendering on the right<br>`1`: Show gameplay rendering on the left | `0` | |


## Finding query string arguments

NestrisChamps is open source, so query string arguments can be found in code. Use the one liner below at the root of the codebase to find all flags by file:
```bash
git grep -E -i -o "QueryString\.get\('[^']+'\)" | sed -E -e "s/^(.+):.+'([^']+)'.+\$/\1:\2/" | sort | uniq
```
And then check the source files to see what the flag actually do.

