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
* [ ] Maybe progress bar? .setDescription
* [ ] Add more logging (cleared messages, re-check guilds refresh, check cleared music files, idk)
  * [ ] logger function ffs
* [x] Components class
* [ ] ACRCloud music recognition (Slash Command)
* [ ] Save playlists -> ask for name -> conclude
  * [ ] List playlists
* [ ] Play files
* [x] Soundcloud
* [x] Deezer
* [ ] Web Dashboard
* [ ] Package bot project into .exe
  * [ ] package into background service