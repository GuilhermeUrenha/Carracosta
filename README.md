# Carracosta
Music / Radio player Discord bot.

## Roadmap

* [x] Fully fix radio handler and message class
  * [x] Dettach radio selector / Simplify radio logic
* [x] Fix VoiceState / VoiceChannel change handler
* [x] Fully transition to class functions
* [x] Video chapter descriptions
  * [x] Embed descriptions -> songInfo.chapters (Current becomes bold?)
* [x] prepareSong -> next music on the queue
  * [x] prepareSong list -> in case skip while preparing
* [x] Class file separation
* [x] music file lifetime handler
* [x] Change queue_update to use interaction if possible
* [x] Music recommendations
  * [ ] Automatic recommendation queue fill system
  * [GET /recommendations](https://developer.spotify.com/documentation/web-api/reference/get-recommendations)
  * [GET /recommendations/available-genre-seeds](https://developer.spotify.com/documentation/web-api/reference/get-recommendation-genres)
* [x] New icons
  * [Solar Outline](https://www.svgrepo.com/collection/solar-outline-icons/)
* [x] Request bot to send music file attachment
* [x] Maybe progress bar? .setDescription
* [ ] Add more logging (cleared messages, re-check guilds refresh, check cleared music files, idk)
  * [ ] logger function ffs
* [x] Components class
* [ ] Button ask for ephemeral select to choose song from playlist to send to first and play immediately
* [ ] save queue to file
* [ ] maybe lite-esque db infra.? (guilds, queue)
  * [ ] fn to serialize db data into json map and all
* [ ] re-attempt connection on disc. -> sep. function
* [ ] ACRCloud music recognition (Slash Command)
* [ ] Playlists
  * [ ] Playlist button -> menu similar to radio -> select_menu, save, load, delete
  * [ ] Save playlists -> modal? -> ask for name/desc. -> confirm (filter out radio/files just in case)
  * saved per guild
* [ ] Play files
* [x] Soundcloud
* [x] Deezer
* [ ] Web Dashboard
* [ ] Package bot project into .exe
  * [ ] package into background service