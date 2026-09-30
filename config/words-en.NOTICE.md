# config/words-en.txt

English word frequencies used by `lib/segment.ts` to split hashtags written as one lowercase run ("nationalcoffeeday" → "national coffee day").

- Source: `content/2018/en/en_50k.txt` from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave, built from the [OpenSubtitles 2018](http://opus.nlpl.eu/OpenSubtitles2018.php) corpus. Downloaded 2026-09-30.
- Change: kept only lines that are a lowercase word of letters a–z and its count (46,717 of the 50,000 lines), dropping contractions such as `'s`.
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as the source's content is. This file alone is under that license; it doesn't change the license of the rest of the repository.
