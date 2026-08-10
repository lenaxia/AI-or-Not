# Images

The game pulls randomly from two folders:

- `images/ai/` — AI-generated images
- `images/real/` — real photos

The backend reads filenames, derives an opaque ID (HMAC), and serves each image
through `/api/img/[id]` so the source folder/filename is **never exposed** to
the browser. Players cannot tell where an image came from by inspecting source.

## Adding images

Drop image files into either folder. Supported types:

`.jpg` `.jpeg` `.png` `.webp` `.gif` `.avif` `.bmp` `.svg`

You need **at least 2 images in each folder** to play. More is better.

### Suggested sources

**Real photos** (check each source's license/terms before scraping):

- [500px](https://500px.com) — high-quality photography
- [Flickr](https://flickr.com) — Creative Commons via the [Flickr API](https://www.flickr.com/services/api/)
- [Unsplash](https://unsplash.com/developers) / [Pexels](https://www.pexels.com/api/) — free stock
- [Wikimedia Commons](https://commons.wikimedia.org)

**AI images:**

- [r/StableDiffusion](https://www.reddit.com/r/StableDiffusion/),
  [r/midjourney](https://www.reddit.com/r/midjourney/) via the Reddit API
- [Civitai](https://civitai.com)
- Generate your own with Stable Diffusion / Midjourney / DALL·E

### The included files

The `*.svg` files shipped here are labeled placeholders so the app runs on first
launch. **Delete them** once you add real images — otherwise the game is trivial
(the label is visible). Consider automating ingestion with a scraper; a future
`scripts/` folder can hold those once API keys are configured.
