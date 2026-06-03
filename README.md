# docrawl

`docrawl` is a lightweight Node.js CLI for crawling documentation sites and converting them into Markdown with [`defuddle`](https://github.com/kepano/defuddle).

It is built for static and server-rendered docs sites such as Docusaurus, VitePress, MkDocs, GitBook exports, and Obsidian Publish. It does not run a browser and does not execute page JavaScript.

## Why

`docrawl` is useful when you want to:

- turn docs sites into Markdown for LLM context
- build local knowledge bases
- feed content into RAG pipelines
- archive clean docs content without a browser dependency

## Requirements

- Node.js `>= 20`

## Install

Run without installing:

```bash
npx docrawl --help
```

Install globally:

```bash
npm install -g docrawl
```

Then run:

```bash
docrawl --help
```

## Local setup

```bash
npm install
```

## Development

Build:

```bash
npm run build
```

Run the CLI from the project workspace:

```bash
npm run start -- --help
```

Run tests:

```bash
npm test
```

## CLI

### `crawl`

```bash
docrawl crawl <url> [options]
```

Examples:

```bash
# Crawl a docs section into ./output
docrawl crawl https://docs.example.com/guide/

# Run a smaller smoke test first
docrawl crawl https://docs.example.com/guide/ --max-pages 10 --depth 1 --verbose

# Merge everything into one file
docrawl crawl https://docs.example.com/guide/ --single-file --output ./context.md

# Crawl the full hostname, not only the seed path subtree
docrawl crawl https://docs.example.com --domain --max-pages 200
```

Options:

```txt
-o, --output <path>  Output directory or file path
-s, --single-file    Merge all pages into one Markdown file
    --domain         Crawl the whole hostname, not just the seed path
    --depth <n>      Maximum crawl depth
    --max-pages <n>  Maximum pages to process (default: 500)
    --concurrency <n> Concurrent requests (default: 3)
    --delay <ms>     Delay between requests per worker (default: 500)
    --lang <code>    Preferred language, BCP 47
    --no-sitemap     Disable sitemap discovery
    --include <glob> Include URL glob pattern, repeatable
    --exclude <glob> Exclude URL glob pattern, repeatable
    --verbose        Verbose progress logging
```

### `parse`

```bash
docrawl parse <url> [options]
```

Examples:

```bash
# Parse one page as Markdown
docrawl parse https://docs.example.com/guide/intro

# Parse one page as JSON
docrawl parse https://docs.example.com/guide/intro --json
```

Options:

```txt
-j, --json      Output full JSON response
    --lang <code> Preferred language, BCP 47
```

## Output

### Separate files

By default, `docrawl crawl` writes one Markdown file per successful page and a `manifest.json`.

Example layout:

```txt
output/
├── getting-started/
│   ├── introduction.md
│   └── quickstart.md
└── manifest.json
```

Each Markdown file includes frontmatter with fields such as:

- `title`
- `sourceUrl`
- `finalUrl`
- `canonicalUrl`
- `crawledAt`
- `depth`
- `wordCount`
- `contentHash`

### Single file

With `--single-file`, `docrawl` writes:

- one merged Markdown file
- one adjacent manifest file named like `<name>.manifest.json`

The merged file includes a table of contents and one section per successful page.

Example:

```bash
docrawl crawl https://docs.example.com --single-file --output ./context.md
```

Produces:

```txt
context.md
context.manifest.json
```

## Current limitations

`docrawl` currently does not handle:

- JavaScript-rendered SPAs that need browser execution
- login-gated or authenticated content
- asset downloading
- `robots.txt` compliance
- resumable crawls
- incremental recrawls
- full navigation reconstruction
