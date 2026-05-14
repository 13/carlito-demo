# <img src="assets/carlito.png" height="30" /> carlito — Solution Suggestions

AI-powered solution suggestions for new tickets based on the historical ticket archive.
Runs entirely locally — no cloud, no data leaves the organisation.

<p align="center">
  <img src="assets/screenshot1.png" width="640" />
</p>

## Architecture

```
scraper/scrape_gvcc.py  →  scraper/data/tickets.jsonl
                                       ↓
                           backend/ingest.py  (embeddings → ChromaDB)
                                       ↓
Chrome extension  ←────  backend/main.py  (FastAPI :8000/search)
```

## Project structure

```
carlito/
├── scraper/
│   ├── scrape_gvcc.py          # Playwright scraper for helpdesk.gvcc.net
│   ├── inspect_selectors.py    # Helper: inspect CSS selectors on a live page
│   ├── requirements.txt
│   ├── Dockerfile
│   └── data/
│       ├── tickets.jsonl       # scraped tickets (output)
│       ├── links_checkpoint.jsonl
│       └── links_progress.json
├── backend/
│   ├── main.py                 # FastAPI server  →  GET /health, POST /search
│   ├── ingest.py               # generate embeddings and store in ChromaDB
│   ├── requirements.txt
│   ├── Dockerfile
│   └── chroma_db/              # vector database (created by ingest.py)
├── extension/
│   ├── manifest.json
│   ├── content.js
│   └── styles.css
├── docker-compose.yml
└── .env                        # KY2_USER / KY2_PASS  (do not commit!)
```

---

## Quick start with Docker (recommended)

### Prerequisites
- Docker Desktop

### 1. Set credentials

Edit `.env` in the project root:

```
KY2_USER=your_username
KY2_PASS=your_password
```

### 2. Build images

```bash
docker compose build
```

### 3. Scrape tickets

```bash
docker compose run --rm scraper
```

- Crawls all solved tickets from helpdesk.gvcc.net
- Writes to `scraper/data/tickets.jsonl`
- Resumable: restart after a crash and the checkpoint is loaded automatically
- `MAX_PAGES` in `scrape_gvcc.py` limits the number of pages scraped (0 = all)

### 4. Generate embeddings

```bash
docker compose run --rm api python ingest.py
```

- Downloads the language model on first run (~420 MB, cached in a Docker volume)
- Already-indexed IDs are skipped automatically (incremental)

### 5. Start the API

```bash
docker compose up -d api
```

Test:
```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "printer not reachable 0x00000709", "n": 5}'
```

---

## Manual setup (without Docker)

### Prerequisites
- Python 3.11 or 3.12 (not 3.13/3.14 — missing pre-built wheels for chromadb)
- Chrome

### Scraper

```bash
cd scraper
pip install -r requirements.txt
playwright install chromium

set KY2_USER=your_username
set KY2_PASS=your_password
python scrape_gvcc.py
```

### Backend

```bash
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python ingest.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## Install the Chrome extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **"Load unpacked"** → select the `extension/` folder
4. Open any ticket on helpdesk.gvcc.net → the sidebar appears automatically

The sidebar appears on all incident pages (`uid=RegIncident`) regardless of status
(Solved, In Progress, New, etc.).

**Sidebar controls:**
- ▼ / ▲ — minimise / restore
- ↻ — re-run search
- × — close
- Drag the header — reposition the panel freely

---

## Indexing new tickets

After a new scraping run:

```bash
# Docker
docker compose run --rm scraper
docker compose run --rm api python ingest.py

# Manual
python scraper/scrape_gvcc.py
cd backend && python ingest.py
```

Already-indexed tickets are skipped automatically.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Login fails | Check `KY2_USER` / `KY2_PASS` in `.env` |
| Sidebar does not appear | Is the API running? → open `http://localhost:8000/health` |
| Sidebar does not appear (II) | Reload the extension in `chrome://extensions/` |
| Ticket links return 403 | Rebuild ChromaDB: delete `backend/chroma_db/` and re-run `ingest.py` |
| Poor suggestions | Scrape more tickets; set `MAX_PAGES = 0` in `scrape_gvcc.py` for a full crawl |
| `chroma-hnswlib` build error | Python 3.13/3.14 not supported — switch to Python 3.12 or use Docker |
