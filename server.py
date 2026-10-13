import http.server
import socketserver
import urllib.parse
import urllib.request
import urllib.error
import re
import json
import threading
import os
import sys
import time
import unicodedata
import concurrent.futures

PORT = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else '8000'))

# ── Persistent caches ──────────────────────────────────────────────────────────
SEARCH_CACHE_FILE  = 'search_cache.json'
RESOLVE_CACHE_FILE = 'resolve_cache.json'

def _load(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

search_cache  = _load(SEARCH_CACHE_FILE)
resolve_cache = _load(RESOLVE_CACHE_FILE)

_search_lock  = threading.Lock()
_resolve_lock = threading.Lock()

def _save_search():
    with _search_lock:
        with open(SEARCH_CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(search_cache, f, ensure_ascii=False)

def _save_resolve():
    with _resolve_lock:
        with open(RESOLVE_CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(resolve_cache, f, ensure_ascii=False)

# ── Normalize: remove accents, lowercase ──────────────────────────────────────
def norm(s):
    if not s:
        return ''
    nfkd = unicodedata.normalize('NFKD', s.lower())
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

def strip_accents(s):
    if not s:
        return ''
    nfkd = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

def collapse_ws(s):
    return re.sub(r'\s+', ' ', (s or '').strip())

# ── Query rewriting: improve Deezer results for known tricky queries ───────────
QUERY_REWRITES = [
    # (pattern_in_norm_query, replacement_query_for_deezer)
    (r'ultima\s*vez.*anuel',      'la ultima vez anuel aa'),
    (r'anuel.*ultima\s*vez',      'la ultima vez anuel aa'),
    (r'bonita.*jeei',             'bonita jeeiph'),
    (r'jeei.*bonita',             'bonita jeeiph'),
]

def rewrite_query(q):
    nq = norm(q)
    for pattern, replacement in QUERY_REWRITES:
        if re.search(pattern, nq):
            return replacement
    # Generic cleanup
    nq = re.sub(r'\b(de|del|la|el|los|las)\b', ' ', nq)
    return re.sub(r'\s+', ' ', nq).strip() or q

# ── Hardcoded overrides (checked before everything) ───────────────────────────
def hardcoded_vid(title, artist):
    tl = norm(title)
    al = norm(artist)
    if tl == 'china' and 'anuel' in al:
        return 'Hbi4T-vQ7qY'
    if 'bonita' in tl:
        if 'remix 2' in tl:
            return 'mXTkqCHrz9k'
        if 'remix' not in tl and 'jee' in al:
            return '4XWxi2mQkcE'
    if 'ultima vez' in tl and ('anuel' in al or 'bad' in al or 'bunny' in al or 'hunny' in al):
        return '6DuvxZ-NReA'
    return None

# ── Inyección de resultados que Deezer no indexa bien ─────────────────────────
INJECTED_TRACKS = [
    {
        'id': 'injected_ultima_vez_anuel',
        'title': 'La Última Vez',
        'artist': {'name': 'Anuel AA'},
        'album': {'title': 'Las Leyendas Nunca Mueren 2'},
        'duration': 215,
        'preview': '',
        'rank': 999999,
        'source': 'inject',
    }
]

def inject_known_tracks(raw_q, tracks):
    """Añade canciones conocidas que los proveedores no indexan correctamente."""
    nq = norm(raw_q)
    existing = {(norm(x.get('title', '')), norm((x.get('artist') or {}).get('name', ''))) for x in tracks}
    injected = []
    for t in INJECTED_TRACKS:
        key = (norm(t['title']), norm(t['artist']['name']))
        if key in existing:
            continue
        tl = norm(t['title'])
        al = norm(t['artist']['name'])
        if tl in nq or al in nq or nq in tl or nq in al:
            injected.append(t)
    return tracks + injected

# ── YouTube helpers ────────────────────────────────────────────────────────────
_YT_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
_VID_RE = re.compile(r'"videoId":"([a-zA-Z0-9_-]{11})"')

def yt_search_one(query, timeout=3.5):
    """Return first videoId found (no embeddability check — instant)."""
    url = f'https://www.youtube.com/results?search_query={urllib.parse.quote(query)}'
    try:
        req = urllib.request.Request(url, headers=_YT_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html = r.read().decode('utf-8', errors='ignore')
        ids = list(dict.fromkeys(_VID_RE.findall(html)))  # deduplicated, order preserved
        return ids[0] if ids else None
    except Exception:
        return None

def yt_resolve(title, artist, timeout=4.0):
    """Try multiple YouTube strategies in PARALLEL and return first result."""
    strategies = [
        f'{title} {artist} topic',
        f'{title} {artist} official audio',
        f'{title} {artist} lyrics',
        f'{title} {artist}',
    ]
    result = [None]
    done   = threading.Event()

    def try_strategy(s):
        if done.is_set(): return
        vid = yt_search_one(s, timeout=timeout)
        if vid and not done.is_set():
            result[0] = vid
            done.set()

    threads = [threading.Thread(target=try_strategy, args=(s,), daemon=True)
               for s in strategies]
    for t in threads: t.start()
    done.wait(timeout=timeout + 1)
    return result[0]

# ── Format Deezer track → our dict ────────────────────────────────────────────
def fmt(track, vid=None, genre='Pop', title_ov=None, artist_ov=None):
    sec = track.get('duration', 0)
    album = track.get('album') or {}
    return {
        'id':         track.get('id'),
        'title':      title_ov  or track.get('title', ''),
        'artist':     artist_ov or (track.get('artist') or {}).get('name', ''),
        'album':      album.get('title', ''),
        'duration':   f'{sec//60}:{sec%60:02d}',
        'genre':      genre,
        'cover':      album.get('cover_xl') or album.get('cover_big', ''),
        'audioSrc':   vid,
        'previewUrl': track.get('preview') or '',
    }

# ── Relevance ranking (Spotify-style) ──────────────────────────────────────────
_STOPWORDS = {'de', 'del', 'la', 'el', 'los', 'las', 'the', 'a', 'an', 'y', 'and',
              'feat', 'ft', 'con', 'with', 'remix', 'official'}

# Markers that mean "not the original studio recording"
_NON_ORIGINAL = {'remix', 'remastered', 'cover', 'karaoke', 'live', 'instrumental',
                 'acoustic', 'unplugged', 'edit', 'demo', 'bootleg', 'medley'}
_NON_ORIGINAL_PHRASES = ['sped up', 'slowed', '8d audio', 'nightcore', 'mashup',
                         'tiktok version', 'type beat', 'backing track', 'piano version',
                         'guitar version', 'music box', 'lullaby', 'ringtone', 'parody',
                         'made famous', 'in the style of', 'originally performed',
                         'originally by', 'as made famous', 'playback', 'version by']

# Words that signal a cover / karaoke / re-upload rather than the original track
_JUNK_WORDS = [
    'cover', 'karaoke', 'instrumental', 'tribute', 'made famous', 'in the style of',
    'originally performed', 'originally by', 'backing track', 'type beat', 'parody',
    'lullaby', 'ringtone', 'music box', 'piano version', 'guitar version',
    '8d audio', 'sped up', 'slowed', 'nightcore', 'mashup', 'playback',
    'tiktok version', 'version by', 'as made famous',
]

def _tokens(text):
    return [t for t in re.split(r'[^a-z0-9]+', norm(text)) if t]

def _content_tokens(text):
    toks = [t for t in _tokens(text) if t not in _STOPWORDS]
    return toks or _tokens(text)

def relevance_score(track, raw_q, dz_q):
    """Higher = closer to what the user actually meant (title + artist match)."""
    title  = track.get('title', '')
    artist = (track.get('artist') or {}).get('name', '')
    album  = (track.get('album') or {}).get('title', '')

    q_tokens = _content_tokens(raw_q) or _content_tokens(dz_q)
    if not q_tokens:
        return 0.0

    title_t  = _tokens(title)
    title_l  = norm(title)
    artist_t = _content_tokens(artist)
    artist_l = norm(artist)
    album_l  = norm(album)

    # How many query words appear in the title
    covered = sum(1 for tok in q_tokens if tok in title_l)

    # Long/whacky titles ("Artist - Song reupload") get penalised
    extra = max(0, len(title_t) - len(q_tokens))

    # Artist words that appear in the query AND are not already words of the title.
    # (A query like "blinding lights" is fully a title; "lights" in the artist name
    #  must NOT count as an artist signal.)
    true_artist_tokens = [tok for tok in artist_t if tok in q_tokens and tok not in title_t]
    artist_match = len(true_artist_tokens) / max(1, len(artist_t))

    # Precision: how much of the title is actually relevant
    precision = covered / max(1, len(title_t))

    score = (6.0 * artist_match) + (4.0 * covered) - (3.0 * extra) + (2.0 * precision)

    if covered == 0 and artist_match < 0.5:
        score -= 5.0
    if norm(artist) and (norm(artist) in norm(raw_q) or norm(raw_q) in norm(artist)):
        score += 4.0

    # Penalise covers / karaoke / re-uploads
    haystack = f'{title_l} {album_l}'
    if any(w in haystack for w in _JUNK_WORDS):
        score -= 8.0

    # Prioritise the ORIGINAL recording: penalise live/remix/cover versions
    # unless the user explicitly asked for them
    q_l = norm(raw_q)
    if not any(m in q_l for m in _NON_ORIGINAL):
        title_tokens = set(_tokens(title))
        if title_tokens & _NON_ORIGINAL:
            score -= 3.0
        elif any(p in title_l for p in _NON_ORIGINAL_PHRASES):
            score -= 3.0

    return score

def rerank(tracks, raw_q, dz_q):
    """Sort by relevance first, then Deezer popularity (rank), then position."""
    scored = [(relevance_score(t, raw_q, dz_q), t.get('rank') or 0, -i, t)
              for i, t in enumerate(tracks)]
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return [s[3] for s in scored]

# ── Deezer fetch with rate-limit handling ────────────────────────────────────
def deezer_search(q, kind='track', limit=10, retries=1):
    """Query Deezer. Returns (items, error). Handles 403 rate-limit once."""
    url = (f'https://api.deezer.com/search/{kind}'
           f'?q={urllib.parse.quote(q)}&limit={limit}&order=RANKING')
    req = urllib.request.Request(url, headers=_YT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=2.0) as r:
            data = json.loads(r.read().decode())
            items = data.get('data', []) if isinstance(data, dict) else []
            return items, None
    except urllib.error.HTTPError as e:
        if e.code == 403 and retries > 0:
            time.sleep(1)
            return deezer_search(q, kind, limit, retries - 1)
        return [], f'Deezer HTTP {e.code}'
    except Exception as e:
        return [], str(e)

# ── iTunes Search API (second provider, no key required) ─────────────────────
def itunes_search(term, limit=10):
    """Query iTunes Search API. Returns (items, error)."""
    url = (f'https://itunes.apple.com/search?term={urllib.parse.quote(term)}'
           f'&media=music&entity=song&limit={limit}')
    req = urllib.request.Request(url, headers=_YT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=2.0) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return [], f'iTunes HTTP {e.code}'
    except Exception as e:
        return [], str(e)
    items = []
    for t in data.get('results', []):
        ms = int(t.get('trackTimeMillis') or 0)
        cover = (t.get('artworkUrl100') or '').replace('100x100bb', '1000x1000bb')
        items.append({
            'id':      t.get('trackId'),
            'title':   t.get('trackName', ''),
            'artist':  {'name': t.get('artistName', '')},
            'album':   {'title': t.get('collectionName', ''), 'cover_xl': cover, 'cover_big': cover},
            'duration': ms // 1000,
            'preview': t.get('previewUrl', ''),
            'rank':    0,
            'source':  'itunes',
        })
    return items, None

def merge_results(dz_list, it_list):
    """Combine providers, dedupe by (title, artist), keep the richest record."""
    merged, order = {}, []
    for t in list(dz_list or []) + list(it_list or []):
        key = f"{norm(t.get('title', ''))} - {norm((t.get('artist') or {}).get('name', ''))}"
        if key.strip(' -'):
            if key not in merged:
                merged[key] = dict(t)
                order.append(key)
            else:
                cur = merged[key]
                cur_album = cur.get('album') or {}
                new_album = t.get('album') or {}
                for f in ('cover_xl', 'cover_big'):
                    if not cur_album.get(f) and new_album.get(f):
                        cur_album[f] = new_album[f]
                if not cur.get('preview') and t.get('preview'):
                    cur['preview'] = t['preview']
                if not cur.get('duration') and t.get('duration'):
                    cur['duration'] = t['duration']
                cur['rank'] = max(cur.get('rank') or 0, t.get('rank') or 0)
                if not cur.get('audioSrc') and t.get('audioSrc'):
                    cur['audioSrc'] = t['audioSrc']
    return [merged[k] for k in order]

def collect_previews(title, artist):
    """Find official 30s preview URLs for a track from the search cache."""
    ck = f"{norm(title)} - {norm(artist)}"
    previews = []
    for cached in search_cache.values():
        if not isinstance(cached, list):
            continue
        for s in cached:
            s_artist = (s.get('artist') or {}).get('name', '') if isinstance(s.get('artist'), dict) else s.get('artist', '')
            if f"{norm(s.get('title',''))} - {norm(s_artist)}" == ck:
                url = s.get('preview') or s.get('previewUrl') or ''
                if url and url not in previews:
                    previews.append(url)
    return previews

def query_variants(raw_q):
    """Ordered list of query forms to try: as typed → without accents → rewritten."""
    raw_q = collapse_ws(raw_q)
    variants = [raw_q]
    no_acc = collapse_ws(strip_accents(raw_q))
    if no_acc.lower() not in variants and no_acc.lower() != raw_q.lower():
        variants.append(no_acc)
    rw = rewrite_query(raw_q)
    if rw.lower() not in variants and rw.lower() != raw_q.lower():
        variants.append(rw)
    return variants

# ── HTTP handler ───────────────────────────────────────────────────────────────
class Handler(http.server.SimpleHTTPRequestHandler):

    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── /api/search ────────────────────────────────────────────────────────────
    def handle_search(self, qs):
        raw_q = collapse_ws(qs.get('q', [''])[0])
        if not raw_q:
            self._json({'results': []}); return

        cache_k = norm(raw_q)

        # Cache hit?
        with _search_lock:
            if cache_k in search_cache:
                self._json({'results': search_cache[cache_k]}); return

# Try query variants in order until we have enough candidates
        tracks, pending_error, seen_variants = [], None, set()

        # Variantes progresivas: quitar palabras de a una (tipo Spotify)
        base_variants = query_variants(raw_q)
        words = collapse_ws(raw_q).split()
        progressive = []
        if len(words) > 1:
            for i in range(len(words) - 1, 0, -1):
                progressive.append(' '.join(words[:i]))
        all_variants = base_variants + [v for v in progressive if v not in base_variants]

        # Ronda 1: Deezer primero; iTunes solo si Deezer no bastó
        dz_items, dz_err = deezer_search(raw_q)
        tracks = merge_results(dz_items, [])
        it_items, it_err = [], None
        if len(tracks) < 6:
            it_items, it_err = itunes_search(raw_q)
            tracks = merge_results(tracks, it_items or [])

        # Ronda 2 (solo si hace falta): 1 variante en paralelo
        if len(tracks) < 3:
            for variant in all_variants[1:]:
                if variant in seen_variants:
                    continue
                seen_variants.add(variant)
                d2, _ = [], None
                i2, _ = [], None
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
                    f_d = ex.submit(deezer_search, variant)
                    f_i = ex.submit(itunes_search, variant)
                    d2, _ = f_d.result()
                    i2, _ = f_i.result()
                tracks = merge_results(tracks, merge_results(d2 or [], i2 or []))
                if len(tracks) >= 6:
                    break

        tracks = inject_known_tracks(raw_q, tracks)
        if not tracks:
            err = dz_err or it_err or pending_error
            self._json({'results': [],
                        'error': err or f'sin resultados para "{raw_q}"'}); return

        # Rank by how well title/artist match the query (drop covers & duplicates)
        tracks = rerank(tracks, raw_q, raw_q)

        seen, unique = set(), []
        for t in tracks:
            key = f"{norm(t.get('title', ''))} - {norm((t.get('artist') or {}).get('name', ''))}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(t)
        tracks = unique[:12]

        # Build results with hardcoded overrides + resolve cache lookup
        results = []
        for t in tracks:
            title  = t.get('title', '')
            artist = (t.get('artist') or {}).get('name', '')
            vid    = hardcoded_vid(title, artist)
            if not vid:
                ck = f"{norm(title)} - {norm(artist)}"
                with _resolve_lock:
                    vid = resolve_cache.get(ck)
            results.append(fmt(t, vid))

        # Cache & respond
        with _search_lock:
            search_cache[cache_k] = results
        threading.Thread(target=_save_search, daemon=True).start()
        self._json({'results': results})

        # Background-resolve top 5 without audioSrc so next play is instant
        def bg_resolve_top():
            for track in results[:5]:
                if track.get('audioSrc'): continue
                title  = track['title']
                artist = track['artist']
                ck     = f"{norm(title)} - {norm(artist)}"
                with _resolve_lock:
                    if ck in resolve_cache: continue
                vid = yt_resolve(title, artist, timeout=5.0)
                if vid:
                    track['audioSrc'] = vid
                    with _resolve_lock:
                        resolve_cache[ck] = vid
                    threading.Thread(target=_save_resolve, daemon=True).start()

        threading.Thread(target=bg_resolve_top, daemon=True).start()

    # ── /api/search/artists ────────────────────────────────────────────────────
    def handle_artists(self, qs):
        raw_q = collapse_ws(qs.get('q', [''])[0])
        if not raw_q:
            self._json({'results': []}); return
        items, err = deezer_search(raw_q, kind='artist', limit=12)
        if err:
            self._json({'results': [], 'error': err}); return
        results = [{
            'id':     a.get('id'),
            'name':   a.get('name', ''),
            'picture': a.get('picture_xl') or a.get('picture_big') or a.get('picture', ''),
            'fans':   a.get('nb_fan', 0),
        } for a in items]
        # Keep only names that actually match the query, then most popular first
        q_toks = _content_tokens(raw_q)
        matched = [a for a in results
                   if any(t in norm(a['name']) for t in q_toks)]
        if matched:
            matched.sort(key=lambda a: a.get('fans') or 0, reverse=True)
            results = matched
        self._json({'results': results})

    # ── /api/search/albums ─────────────────────────────────────────────────────
    def handle_albums(self, qs):
        raw_q = collapse_ws(qs.get('q', [''])[0])
        if not raw_q:
            self._json({'results': []}); return
        items, err = deezer_search(raw_q, kind='album', limit=12)
        if err:
            self._json({'results': [], 'error': err}); return
        results = [{
            'id':     a.get('id'),
            'title':  a.get('title', ''),
            'artist': (a.get('artist') or {}).get('name', ''),
            'cover':  a.get('cover_xl') or a.get('cover_big') or a.get('cover', ''),
            'tracks': a.get('nb_tracks', 0),
        } for a in items]
        self._json({'results': results})

    # ── /api/resolve ───────────────────────────────────────────────────────────
    def handle_resolve(self, qs):
        title  = qs.get('title',  [''])[0].strip()
        artist = qs.get('artist', [''])[0].strip()
        if not title:
            self._json({'error': 'title required'}, 400); return

        # Hardcoded overrides first
        vid = hardcoded_vid(title, artist)
        if not vid:
            # Cache
            ck = f"{norm(title)} - {norm(artist)}"
            with _resolve_lock:
                vid = resolve_cache.get(ck)

        if not vid:
            # Parallel YouTube search
            vid = yt_resolve(title, artist, timeout=5.0)
            if vid:
                with _resolve_lock:
                    resolve_cache[ck] = vid
                threading.Thread(target=_save_resolve, daemon=True).start()

        if vid:
            # Also attach official previews as playback fallback
            payload = {'audioSrc': vid, 'previews': collect_previews(title, artist)}
            self._json(payload)
        else:
            # No full audio available → offer official 30s previews
            previews = collect_previews(title, artist)
            if previews:
                self._json({'audioSrc': None, 'previews': previews,
                            'note': 'solo vista previa oficial (30s)'})
            else:
                self._json({'error': 'not found'}, 404)

    # ── /api/lyrics ──────────────────────────────────────────────────────────
    def handle_lyrics(self, qs):
        title  = qs.get('title',  [''])[0].strip()
        artist = qs.get('artist', [''])[0].strip()
        if not title:
            self._json({'error': 'title required'}, 400); return
        url = (f'https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}'
               f'/{urllib.parse.quote(title)}')
        req = urllib.request.Request(url, headers=_YT_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=3.5) as r:
                data = json.loads(r.read().decode())
            lyrics = (data.get('lyrics') or '').strip()
            self._json({'lyrics': lyrics})
        except Exception:
            self._json({'lyrics': '', 'error': 'letra no disponible'})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs     = urllib.parse.parse_qs(parsed.query)
        if   parsed.path == '/api/search':        self.handle_search(qs)
        elif parsed.path == '/api/search/artists': self.handle_artists(qs)
        elif parsed.path == '/api/search/albums':  self.handle_albums(qs)
        elif parsed.path == '/api/resolve':       self.handle_resolve(qs)
        elif parsed.path == '/api/lyrics':        self.handle_lyrics(qs)
        else: super().do_GET()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'SoundWave running at http://localhost:{PORT}')
    httpd.serve_forever()
