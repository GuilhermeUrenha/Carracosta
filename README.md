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
* [ ] Music recommendations
  * [GET /recommendations](https://developer.spotify.com/documentation/web-api/reference/get-recommendations)
  * [GET /recommendations/available-genre-seeds](https://developer.spotify.com/documentation/web-api/reference/get-recommendation-genres)
* [ ] ACRCloud music recognition (Slash Command)
* [ ] Web Dashboard
* [x] Request bot to send music file attachment