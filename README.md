# Daily Spin

A small installable web app (PWA) that suggests albums to listen to, based on filters you choose and the music you already own.

**Live site: https://jgmiller3405-coder.github.io/daily-spin/**

## Install on iPhone

Open the link above in **Safari**, tap Share, then **Add to Home Screen**.

## Using it

- **Library**: import the albums you own, either pasted as `Artist - Album` lines or from a CSV/TXT/JSON file. A CSV can have the columns `artist, album, genre, vocals, vibe, format`. "Auto-fill genre & artwork" looks up genre and cover art on iTunes. Tap Edit on an album to set its vocals, vibe and format.
- **Today**: pick genre, vocals, tempo/vibe, format and era, and choose whether to hear from new artists, artists in your library, or both. It suggests albums you don't own, favouring artists whose tags overlap your library's genres.
- **New**: recent album releases for a genre.

Your library is stored in your browser only. Use "Export backup" to save a copy.

## How it works

Plain HTML, CSS and JavaScript with no build step. Suggestions come from [MusicBrainz](https://musicbrainz.org) (community tags, so vibe and vocals matching is approximate) and cover art from the Cover Art Archive. Genre and artwork lookups use the iTunes Search API. MusicBrainz allows about one request per second, so each pick takes around 10 seconds.
