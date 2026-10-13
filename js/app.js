// SoundWave - Main Application
document.addEventListener('DOMContentLoaded', () => {
  const player = new SWPlayer();
  const $ = id => document.getElementById(id);
  const state = {
    currentView: 'home',
    userPlaylists: JSON.parse(localStorage.getItem('sw-playlists') || '[]'),
    isPremium: JSON.parse(localStorage.getItem('sw-premium') || 'false'),
    searchHistory: (function () {
      const h = JSON.parse(localStorage.getItem('sw-search-history') || '[]');
      // Quedarse solo con la entrada más larga cuando otra es su prefijo
      return h.filter((x, i) => {
        const nx = normStr(x);
        return !h.slice(0, i).some(p => {
          const np = normStr(p);
          return np !== nx && np.startsWith(nx);
        });
      }).slice(0, 10);
    })(),
  };

  // ─── NAVIGATION ───
  function navigateTo(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
    const el = $(`view-${view}`);
    if (el) { el.classList.add('active'); state.currentView = view; }
    document.querySelectorAll(`[data-view="${view}"]`).forEach(n => n.classList.add('active'));
    $('main-content').scrollTo(0, 0);
  }

  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.view); });
  });

  // Expose navigateTo globally so search can switch views
  window._navigateTo = navigateTo;

  // ─── SIDEBAR MOBILE ───
  function toggleSidebar() {
    const open = $('sidebar').classList.toggle('open');
    $('sidebar-backdrop').classList.toggle('show', open);
  }
  function closeSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebar-backdrop').classList.remove('show');
  }
  $('btn-mobile-menu').onclick = toggleSidebar;
  $('sidebar-backdrop').onclick = closeSidebar;
  document.addEventListener('click', e => {
    if (!$('sidebar').contains(e.target) && !$('btn-mobile-menu').contains(e.target)) {
      closeSidebar();
    }
  });

  // ─── RENDER HOME ───
  function renderHome() {
    renderQuickPicks();
    renderRecentlyPlayed();
    renderMadeForYou();
    renderPopularArtists();
    renderTopCharts();
    renderGenres();
    renderGreeting();
  }

  function renderGreeting() {
    const h = new Date().getHours();
    let greet = 'Buenas noches';
    if (h < 12) greet = 'Buenos días';
    else if (h < 19) greet = 'Buenas tardes';
    const hdr = document.querySelector('#view-home .section-header h2');
    if (hdr) hdr.textContent = `${greet}, Juan`;
  }

  function renderQuickPicks() {
    const grid = $('quick-picks');
    const picks = SW_DATA.playlists.slice(0, 6);
    grid.innerHTML = picks.map(p => `
      <div class="quick-card" data-playlist-id="${p.id}">
        <img class="quick-card-img" src="${p.cover}" alt="${p.name}" loading="lazy">
        <span class="quick-card-name">${p.name}</span>
        <button class="quick-play" aria-label="Play"><i class="fas fa-play"></i></button>
      </div>
    `).join('');
    grid.querySelectorAll('.quick-card').forEach(c => {
      c.addEventListener('click', () => openPlaylist(c.dataset.playlistId));
      c.querySelector('.quick-play').addEventListener('click', e => {
        e.stopPropagation();
        playPlaylist(c.dataset.playlistId);
      });
    });
  }

  function renderRecentlyPlayed() {
    const cont = $('recently-played');
    const ids = player.history.length ? player.history.slice(0, 8) : [1,4,6,10,13,21];
    const songs = ids.map(id => SW_DATA.songs.find(s => s.id === id)).filter(Boolean);
    cont.innerHTML = songs.map(s => musicCard(s, 'song')).join('');
    bindCardClicks(cont);
  }

  function renderMadeForYou() {
    const cont = $('made-for-you');
    const mixes = SW_DATA.playlists.slice(0, 5);
    cont.innerHTML = mixes.map(p => musicCard(p, 'playlist')).join('');
    bindCardClicks(cont);
  }

  function renderPopularArtists() {
    const cont = $('popular-artists');
    cont.innerHTML = SW_DATA.artists.map(a => `
      <div class="music-card" data-type="artist" data-id="${a.id}">
        <img class="card-img round" src="${a.img}" alt="${a.name}" loading="lazy">
        <div class="card-title">${a.name}</div>
        <div class="card-subtitle">${a.genre} • ${a.followers}</div>
      </div>
    `).join('');
  }

  function renderTopCharts() {
    const cont = $('top-charts');
    const charts = [
      {name:"Top 50 Global",cover:"https://picsum.photos/seed/tc1/300",desc:"Las más escuchadas"},
      {name:"Viral 50",cover:"https://picsum.photos/seed/tc2/300",desc:"Lo que viene"},
      {name:"Top España",cover:"https://picsum.photos/seed/tc3/300",desc:"Lo mejor de España"},
      {name:"Top LATAM",cover:"https://picsum.photos/seed/tc4/300",desc:"Ritmos latinos"},
      {name:"Top USA",cover:"https://picsum.photos/seed/tc5/300",desc:"American hits"},
    ];
    cont.innerHTML = charts.map(c => `
      <div class="music-card">
        <img class="card-img" src="${c.cover}" alt="${c.name}" loading="lazy">
        <div class="card-title">${c.name}</div>
        <div class="card-subtitle">${c.desc}</div>
        <button class="card-play-btn"><i class="fas fa-play"></i></button>
      </div>
    `).join('');
  }

  function renderGenres() {
    const grid = $('genre-grid');
    grid.innerHTML = SW_DATA.genres.map(g => `
      <div class="genre-card" style="background:${g.color}" data-genre="${g.name}">
        ${g.name}
        <i class="fas ${g.icon}"></i>
      </div>
    `).join('');
    grid.querySelectorAll('.genre-card').forEach(c => {
      c.onclick = () => { navigateTo('search'); $('search-input').value = c.dataset.genre; doSearch(c.dataset.genre); };
    });
  }

  function musicCard(item, type) {
    const isPlaylist = type === 'playlist';
    const title = isPlaylist ? item.name : item.title;
    const subtitle = isPlaylist ? item.desc : item.artist;
    const src = isPlaylist ? item.cover : coverUrl(item);
    const ytThumb = (!isPlaylist && item.audioSrc) ? `https://img.youtube.com/vi/${item.audioSrc}/mqdefault.jpg` : '';
    
    return `
      <div class="music-card" data-type="${type}" data-id="${item.id}">
        <img class="card-img" src="${src}" alt="${title}" loading="lazy" 
             onerror="this.onerror=null; if('${ytThumb}') this.src='${ytThumb}'; else this.style.display='none';">
        <div class="card-title">${title}</div>
        <div class="card-subtitle">${subtitle}</div>
        <button class="card-play-btn"><i class="fas fa-play"></i></button>
      </div>`;
  }

  function bindCardClicks(container) {
    container.querySelectorAll('.music-card').forEach(c => {
      const type = c.dataset.type;
      const id = c.dataset.id;
      c.querySelector('.card-play-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        if (type === 'playlist') playPlaylist(id);
        else playSong(parseInt(id));
      });
      c.addEventListener('click', () => {
        if (type === 'playlist') openPlaylist(id);
        else playSong(parseInt(id));
      });
    });
  }

  // ─── PLAY FUNCTIONS ───
  function playSong(songId) {
    const song = SW_DATA.songs.find(s => s.id === songId);
    if (song) player.loadQueue([song], 0);
  }

  function playPlaylist(playlistId) {
    const pl = SW_DATA.playlists.find(p => p.id === playlistId) || state.userPlaylists.find(p => p.id === playlistId);
    if (!pl) return;
    const songs = pl.songs.map(id => SW_DATA.songs.find(s => s.id === id)).filter(Boolean);
    if (songs.length) player.loadQueue(songs, 0);
  }

  function openPlaylist(playlistId) {
    let pl, songs;
    
    if (playlistId === 'liked') {
      pl = { name: 'Canciones Favoritas', desc: 'Tus canciones guardadas' };
      songs = SW_DATA.songs.filter(s => player.liked.has(s.id));
    } else if (playlistId === 'recent') {
      pl = { name: 'Escuchado Recientemente', desc: 'Tu historial de reproducción' };
      songs = player.history.map(id => SW_DATA.songs.find(s => s.id === id)).filter(Boolean);
    } else {
      pl = SW_DATA.playlists.find(p => p.id === playlistId) || state.userPlaylists.find(p => p.id === playlistId);
      if (!pl) return;
      songs = pl.songs.map(id => SW_DATA.songs.find(s => s.id === id)).filter(Boolean);
    }
    navigateTo('playlist-detail');
    $('playlist-detail-header').innerHTML = `
      <div class="playlist-detail-cover"><i class="fas fa-music"></i></div>
      <div class="playlist-detail-info">
        <span class="badge badge-new">PLAYLIST</span>
        <h1>${pl.name}</h1>
        <p>${pl.desc || ''} • ${songs.length} canciones</p>
        <div class="playlist-detail-actions">
          <button class="btn-primary" id="pd-play"><i class="fas fa-play"></i> Reproducir</button>
          <button class="btn-icon" style="font-size:1.5rem"><i class="far fa-heart"></i></button>
          <button class="btn-icon" style="font-size:1.5rem"><i class="fas fa-ellipsis-h"></i></button>
        </div>
      </div>`;
    $('playlist-detail-tracks').innerHTML = `
      <div class="track-list-header">
        <span class="t-num">#</span><span class="t-title">TÍTULO</span><span class="t-dur"><i class="far fa-clock"></i></span>
      </div>` + songs.map((s, i) => songRow(s, i + 1)).join('');

    $('pd-play').onclick = () => player.loadQueue(songs, 0);
    $('playlist-detail-tracks').querySelectorAll('.song-row').forEach(r => {
      r.addEventListener('click', () => {
        const idx = parseInt(r.dataset.index);
        player.loadQueue(songs, idx);
      });
    });
  }

  // Returns best available cover: stored cover → YouTube thumbnail → empty
  function coverUrl(s) {
    if (s.cover && s.cover.length > 10) return s.cover;
    if (s.audioSrc) return `https://img.youtube.com/vi/${s.audioSrc}/mqdefault.jpg`;
    return '';
  }

  function songRow(s, num, highlightQuery = '') {
    const src = coverUrl(s);
    const ytThumb = s.audioSrc ? `https://img.youtube.com/vi/${s.audioSrc}/mqdefault.jpg` : '';
    
    const imgHTML = src 
      ? `<img class="song-img" src="${src}" alt="${s.title}" loading="lazy" onerror="this.onerror=null; this.src='${ytThumb}';">`
      : `<div class="song-img" style="background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center"><i class="fas fa-music" style="color:var(--text-muted)"></i></div>`;

    let titleHTML = s.title;
    let artistHTML = s.artist;

    if (highlightQuery) {
      const regex = new RegExp(`(${highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      titleHTML = s.title.replace(regex, '<span class="search-highlight">$1</span>');
      artistHTML = s.artist.replace(regex, '<span class="search-highlight">$1</span>');
    }

    return `<div class="song-row" data-index="${num - 1}" data-song-id="${s.id}">
      <span class="song-num">${num}</span>
      <span class="song-play-icon"><i class="fas fa-play"></i></span>
      ${imgHTML}
      <div class="song-info"><div class="song-name">${titleHTML}</div><div class="song-artist-name">${artistHTML}</div></div>
      <span class="song-duration">${s.duration}</span>
    </div>`;
  }

  // ─── SEARCH UTILS ───
  function normStr(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function fuzzyScore(str, query) {
    str = normStr(str);
    query = normStr(query);
    if (!query) return 0;
    if (str === query) return 100;
    if (str.startsWith(query)) return 80;
    if (str.includes(query)) return 50;
    
    // Simple character overlap score
    let score = 0;
    let lastIdx = -1;
    for (let char of query) {
      const idx = str.indexOf(char, lastIdx + 1);
      if (idx !== -1) {
        score += 1;
        if (idx === lastIdx + 1) score += 2; // Consecutive characters
        lastIdx = idx;
      }
    }
    return (score / query.length) * 10;
  }

  function saveToHistory(q) {
    q = (q || '').trim();
    if (!q || q.length < 2) return;
    const nq = normStr(q);
    // No guardar prefijos: si el historial tiene "ultima vez" y buscas
    // "ultima vez anuel", reemplaza el antiguo en vez de sumar uno nuevo
    state.searchHistory = [q, ...state.searchHistory.filter(x => {
      const nx = normStr(x);
      return nx && !nq.startsWith(nx);
    })].slice(0, 10);
    localStorage.setItem('sw-search-history', JSON.stringify(state.searchHistory));
    renderSearchHistory();
  }

  // Al escribir, limpia del historial las entradas que sean prefijos de lo que
  // se está tecleando (evita que se acumulen "ultim", "ultima", "ultima vez"...)
  function pruneHistoryPrefixes(q) {
    const nq = normStr(q);
    if (nq.length < 3) return;
    const filtered = state.searchHistory.filter(x => {
      const nx = normStr(x);
      return !nx || !nq.startsWith(nx);
    });
    if (filtered.length !== state.searchHistory.length) {
      state.searchHistory = filtered;
      localStorage.setItem('sw-search-history', JSON.stringify(state.searchHistory));
      renderSearchHistory();
    }
  }

  function renderSearchHistory() {
    const cont = $('history-list');
    const wrapper = $('search-history');
    if (!state.searchHistory.length) {
      wrapper.style.display = 'none';
      return;
    }
    wrapper.style.display = 'block';
    cont.innerHTML = state.searchHistory.map(q => `
      <div class="history-item" data-query="${q}">
        <i class="far fa-clock"></i>
        <span class="history-text">${q}</span>
        <button class="btn-icon btn-remove-history" data-q="${q}"><i class="fas fa-times"></i></button>
      </div>
    `).join('');

    cont.querySelectorAll('.history-item').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('.btn-remove-history')) {
          const q = e.target.closest('.btn-remove-history').dataset.q;
          state.searchHistory = state.searchHistory.filter(x => x !== q);
          localStorage.setItem('sw-search-history', JSON.stringify(state.searchHistory));
          renderSearchHistory();
          return;
        }
        $('search-input').value = el.dataset.query;
        doSearch(el.dataset.query);
      };
    });
  }

  $('clear-history').onclick = () => {
    state.searchHistory = [];
    localStorage.setItem('sw-search-history', JSON.stringify(state.searchHistory));
    renderSearchHistory();
  };

  // ─── SEARCH ─── (Spotify-style)
  let searchTimeout;
  let quickSearchTimeout;
  const searchCache = new Map();
  let currentSearchQuery = '';
  const input = $('search-input');

  // Create Quick Results Popover
  const quickResults = document.createElement('div');
  quickResults.className = 'quick-results';
  quickResults.id = 'quick-results';
  input.parentElement.appendChild(quickResults);

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      renderBrowse();
      // Pre-warm the last history search in the background
      if (state.searchHistory && state.searchHistory[0]) {
        fetch(`/api/search?q=${encodeURIComponent(state.searchHistory[0])}`).catch(() => {});
      }
    }
  });

  input.addEventListener('input', e => {
    const q = e.target.value.trim();
    if (!q) {
      currentSearchQuery = '';
      quickResults.classList.remove('show');
      renderBrowse();
      return;
    }
    // Auto-switch to search view if not already there
    if (state.currentView !== 'search') navigateTo('search');
    $('search-history').style.display = 'none';
    showQuickResults(q);
    pruneHistoryPrefixes(q);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(q), 300);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) { doSearch(q); saveToHistory(q); }
    }
  });

  function showQuickResults(q) {
    const qLower = normStr(q);
    clearTimeout(quickSearchTimeout);
    if (qLower.length < 2) {
      quickResults.classList.remove('show');
      return;
    }
    quickSearchTimeout = setTimeout(async () => {
      if (currentSearchQuery && normStr(currentSearchQuery) === qLower) return;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        const songs = (data.results || []).slice(0, 5);
        if (!songs.length || (currentSearchQuery && normStr(currentSearchQuery) === qLower)) {
          quickResults.classList.remove('show');
          return;
        }
        quickResults.innerHTML = `
          <div class="quick-results-header">Sugerencias</div>
          ${songs.map(s => `
            <div class="quick-result-item" data-id="${s.id}">
              <img src="${coverUrl(s)}" class="quick-result-img" alt="${s.title}" onerror="this.style.display='none'">
              <div class="quick-result-info">
                <div class="quick-result-name">${s.title.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<strong>$1</strong>')}</div>
                <div class="quick-result-artist">${s.artist}</div>
              </div>
            </div>`).join('')}
        `;
        quickResults.classList.add('show');
        quickResults.querySelectorAll('.quick-result-item').forEach(el => {
          el.onclick = () => {
            const song = songs.find(s => String(s.id) === el.dataset.id);
            if (song) {
              input.value = song.title;
              currentSearchQuery = normStr(song.title);
              quickResults.classList.remove('show');
              player.loadQueue([song], 0);
            }
          };
        });
      } catch (e) {
        quickResults.classList.remove('show');
      }
    }, 250);
  }

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !quickResults.contains(e.target)) {
      quickResults.classList.remove('show');
    }
  });

  $('search-clear').onclick = () => { input.value = ''; currentSearchQuery = ''; quickResults.classList.remove('show'); renderBrowse(); };

  document.querySelectorAll('.filter-chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      const v = input.value.trim();
      if (v) doSearch(v);
    };
  });

  // Play song from search results (loads full result list as queue)
  function playSongFromSearch(songId, songList) {
    const song = SW_DATA.songs.find(s => s.id === songId);
    if (!song) return;
    if (songList && songList.length > 1) {
      const idx = songList.findIndex(s => s.id === songId);
      player.loadQueue(songList, Math.max(0, idx));
    } else {
      player.loadQueue([song], 0);
    }
  }

  // ── MAIN SEARCH (Spotify-style) ──
  async function doSearch(q) {
    if (!q || !q.trim()) return;
    const qLower = q.toLowerCase().trim();
    const activeChip = document.querySelector('.filter-chip.active');
    const filter = activeChip ? activeChip.dataset.filter : 'all';
    const resultsEl = $('search-results');
    if (!resultsEl) return;
    currentSearchQuery = qLower;
    quickResults.classList.remove('show');

    // ── Helper functions ──
    function skeletonRows(n) {
      return Array(n).fill('<div class="song-row skeleton skeleton-row"></div>').join('');
    }

    // ── Render Spotify-layout ──
    function renderResults(songs, isLoading) {
      if (!songs.length && isLoading) {
        resultsEl.innerHTML = `<div class="sr-top-grid">
          <div class="sr-left">
            <p class="sr-section-title">Buscando...</p>
            <div class="sr-top-card skeleton" style="min-height:260px"></div>
          </div>
          <div class="sr-right">
            <p class="sr-section-title">Canciones <i class="fas fa-circle-notch fa-spin" style="font-size:.8rem;opacity:.5"></i></p>
            ${skeletonRows(4)}
          </div>
        </div>`;
        return;
      }

      if (!songs.length) {
        resultsEl.innerHTML = `<div class="empty-state">
          <i class="fas fa-search"></i>
          <h3>Sin resultados para &ldquo;${q}&rdquo;</h3>
          <p>Prueba con otro nombre, artista o g&eacute;nero</p>
        </div>`;
        return;
      }

      const top = songs[0];
      const rest = songs.slice(1, 5);
      const topCover = coverUrl(top);
      const ytFallback = top.audioSrc ? `https://img.youtube.com/vi/${top.audioSrc}/mqdefault.jpg` : '';

      let html = '<div class="sr-top-grid">';

      // Left: top result
      html += `<div class="sr-left"><h3 class="sr-section-title">Resultado m&aacute;s relevante</h3>
        <div class="sr-top-card" data-song-id="${top.id}">
          <div class="sr-top-img-wrap">
            ${topCover
              ? `<img class="sr-top-img" src="${topCover}" alt="${top.title}" onerror="this.onerror=null;this.src='${ytFallback}'">`
              : `<div class="sr-top-img sr-top-img-fallback"><i class="fas fa-music"></i></div>`}
          </div>
          <div class="sr-top-title">${top.title}</div>
          <div class="sr-top-meta"><span class="sr-badge">CANCI&Oacute;N</span>&nbsp;${top.artist}</div>
          <button class="sr-top-play" data-song-id="${top.id}"><i class="fas fa-play"></i></button>
        </div>
      </div>`;

      // Right: song list
      html += `<div class="sr-right"><h3 class="sr-section-title">Canciones</h3>`;
      if (rest.length) {
        html += rest.map((s, i) => songRow(s, i + 1, q)).join('');
        if (songs.length > 5) {
          html += `<button class="sr-show-more" id="sr-show-more">Ver todas las canciones (${songs.length}) <i class="fas fa-chevron-down"></i></button>`;
        }
      }
      html += '</div></div>';

      if (songs.length > 5) {
        html += `<div class="sr-section" id="sr-all-songs" style="display:none">
          <h3 class="sr-section-title">Todas las canciones</h3>
          ${songs.map((s, i) => songRow(s, i + 1, q)).join('')}
        </div>`;
      }

      resultsEl.innerHTML = html;

      // Bind clicks
      resultsEl.querySelectorAll('.song-row').forEach(r => {
        r.onclick = e => {
          e.stopPropagation();
          const id = parseInt(r.dataset.songId);
          if (!isNaN(id)) {
            const idx = songs.findIndex(s => s.id === id);
            player.loadQueue(songs, Math.max(0, idx));
          }
        };
      });

      resultsEl.querySelectorAll('.sr-top-card').forEach(card => {
        card.onclick = e => {
          if (e.target.closest('.sr-top-play')) return;
          player.loadQueue(songs, 0);
        };
      });
      resultsEl.querySelectorAll('.sr-top-play').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); player.loadQueue(songs, 0); };
      });

      const showMore = resultsEl.querySelector('#sr-show-more');
      if (showMore) {
        showMore.onclick = () => {
          const all = resultsEl.querySelector('#sr-all-songs');
          if (all) { all.style.display = 'block'; showMore.remove(); }
        };
      }
    }

    // ── Generic message (empty / error) ──
    function renderMessage(icon, title, text, withRetry = false) {
      resultsEl.innerHTML = `<div class="empty-state">
        <i class="fas ${icon}"></i>
        <h3>${title}</h3>
        <p>${text}</p>
        ${withRetry ? `<button class="btn-primary" id="sr-retry" style="margin-top:16px"><i class="fas fa-redo"></i> Reintentar</button>` : ''}
      </div>`;
      const btn = resultsEl.querySelector('#sr-retry');
      if (btn) btn.onclick = () => doSearch(input.value.trim());
    }

    // ── Artistas (filter chips) ──
    function renderArtists(list) {
      if (!list.length) {
        renderMessage('fa-users', `Sin artistas para &ldquo;${q}&rdquo;`, 'Prueba con otro nombre');
        return;
      }
      resultsEl.innerHTML = `
        <h3 class="sr-section-title">Artistas</h3>
        <div class="browse-categories" data-view-grid="artists">
          ${list.map(a => `
            <div class="music-card" data-type="artist" data-name="${a.name}">
              <img class="card-img round" src="${a.picture}" alt="${a.name}" loading="lazy" onerror="this.style.display='none'">
              <div class="card-title">${a.name}</div>
              <div class="card-subtitle">${(a.fans/1000).toFixed(0)}K seguidores</div>
            </div>`).join('')}
        </div>`;
      resultsEl.querySelectorAll('[data-type="artist"]').forEach(card => {
        card.onclick = () => {
          setChip('songs');
          input.value = card.dataset.name;
          doSearch(card.dataset.name);
        };
      });
    }

    // ── Álbumes (filter chips) ──
    function renderAlbums(list) {
      if (!list.length) {
        renderMessage('fa-compact-disc', `Sin álbumes para &ldquo;${q}&rdquo;`, 'Prueba con otro nombre');
        return;
      }
      resultsEl.innerHTML = `
        <h3 class="sr-section-title">Álbumes</h3>
        <div class="browse-categories" data-view-grid="albums">
          ${list.map(a => `
            <div class="music-card" data-type="album" data-name="${a.title}" data-artist="${a.artist}">
              <img class="card-img" src="${a.cover}" alt="${a.title}" loading="lazy">
              <div class="card-title">${a.title}</div>
              <div class="card-subtitle">${a.artist} • ${a.tracks} canciones</div>
            </div>`).join('')}
        </div>`;
      resultsEl.querySelectorAll('[data-type="album"]').forEach(card => {
        card.onclick = () => {
          setChip('songs');
          input.value = card.dataset.name;
          doSearch(card.dataset.name);
        };
      });
    }

    // ── Playlists (locales) ──
    function renderPlaylists() {
      const all = [...SW_DATA.playlists, ...state.userPlaylists];
      const ql = normStr(q);
      const found = all.filter(p => fuzzyScore(p.name, ql) > 20 || (p.desc && fuzzyScore(p.desc, ql) > 20));
      if (!found.length) {
        renderMessage('fa-list', `Sin playlists para &ldquo;${q}&rdquo;`, 'Crea una en Tu Biblioteca');
        return;
      }
      resultsEl.innerHTML = `
        <h3 class="sr-section-title">Playlists</h3>
        <div class="browse-categories" data-view-grid="playlists">
          ${found.map(p => `
            <div class="music-card" data-type="playlist" data-id="${p.id}">
              <img class="card-img" src="${p.cover}" alt="${p.name}" loading="lazy">
              <div class="card-title">${p.name}</div>
              <div class="card-subtitle">${p.desc || ''}</div>
            </div>`).join('')}
        </div>`;
      resultsEl.querySelectorAll('[data-type="playlist"]').forEach(card => {
        card.onclick = () => openPlaylist(card.dataset.id);
      });
    }

    function setChip(filterName) {
      document.querySelectorAll('.filter-chip').forEach(x => {
        x.classList.toggle('active', x.dataset.filter === filterName);
      });
    }

    // ── Step 1: Show skeleton immediately (songs/all only) ──
    if (filter === 'all' || filter === 'songs') renderResults([], true);

    // ── Step 2: Fetch from API (Deezer) ──
    try {
      const cacheKey = qLower + '_' + filter;
      let apiSongs = searchCache.has(cacheKey) ? searchCache.get(cacheKey) : null;

      if (!apiSongs) {
        const cleanQ = q.replace(/\s+/g, ' ').trim();
        const endpoint = filter === 'artists' ? '/api/search/artists'
                       : filter === 'albums'  ? '/api/search/albums'
                       : '/api/search';
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(cleanQ)}`);
        if (currentSearchQuery !== qLower) return; // user typed something else
        if (!res.ok) throw new Error('API error ' + res.status);
        const data = await res.json();
        if (data.error) {
          renderMessage('fa-circle-exclamation', 'No hay resultados', data.error);
          return;
        }
        apiSongs = data.results || [];
        if (apiSongs.length) searchCache.set(cacheKey, apiSongs);
      }

      if (currentSearchQuery !== qLower) return;

      // Filter-specific render
      if (filter === 'artists') { renderArtists(apiSongs); return; }
      if (filter === 'albums')  { renderAlbums(apiSongs);  return; }
      if (filter === 'playlists') { renderPlaylists(); return; }

      // Merge into global pool (no duplicates)
      apiSongs.forEach(s => {
        if (!SW_DATA.songs.find(x => x.id === s.id)) SW_DATA.songs.push(s);
      });

      // Use Deezer ranking order directly — it's already relevance-sorted
      let songs = apiSongs;

      renderResults(songs, false);

      // Pre-resolve audioSrc for top 5 in parallel (fire & forget)
      const toResolve = songs.slice(0, 5).filter(s => !s.audioSrc);
      if (toResolve.length) {
        Promise.all(toResolve.map(s =>
          fetch(`/api/resolve?title=${encodeURIComponent(s.title)}&artist=${encodeURIComponent(s.artist)}`)
            .then(r => r.json())
            .then(d => { if (d.audioSrc) s.audioSrc = d.audioSrc; })
            .catch(() => {})
        ));
      }

    } catch (err) {
      console.warn('[Search] API not available:', err.message);
      if (currentSearchQuery === qLower) {
        renderMessage('fa-wifi', 'Error de conexión', 'No se pudo conectar con el servicio de música. Revisa tu conexión.', true);
      }
    }
  }

  function renderBrowse() {
    const resultsEl = $('search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = `
      <h3 class="sr-section-title" style="margin-bottom:16px">Explorar categorías</h3>
      <div class="browse-categories" id="browse-categories">
        ${SW_DATA.genres.map(g => `
          <div class="genre-card" style="background:${g.color}" data-genre="${g.name}">
            ${g.name}<i class="fas ${g.icon}"></i>
          </div>
        `).join('')}
      </div>`;
    resultsEl.querySelectorAll('.genre-card').forEach(c => {
      c.onclick = () => {
        input.value = c.dataset.genre;
        doSearch(c.dataset.genre);
        saveToHistory(c.dataset.genre);
      };
    });
    renderSearchHistory();
  }



  // ─── LIBRARY ───
  document.querySelectorAll('.lib-tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.lib-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderLibrary(t.dataset.tab);
    };
  });

  function renderLibrary(tab = 'playlists') {
    const cont = $('library-content');
    let html = '';
    if (tab === 'playlists') {
      const all = [...SW_DATA.playlists, ...state.userPlaylists];
      html = `<div class="library-grid">${all.map(p => musicCard(p, 'playlist')).join('')}</div>`;
    } else if (tab === 'artists') {
      html = `<div class="library-grid">${SW_DATA.artists.map(a => `
        <div class="music-card"><img class="card-img round" src="${a.img}" alt="${a.name}" loading="lazy"><div class="card-title">${a.name}</div><div class="card-subtitle">${a.followers} seguidores</div></div>
      `).join('')}</div>`;
    } else if (tab === 'albums') {
      const albums = [...new Map(SW_DATA.songs.map(s => [s.album, s])).values()];
      html = `<div class="library-grid">${albums.map(s => `
        <div class="music-card"><img class="card-img" src="${s.cover}" alt="${s.album}" loading="lazy"><div class="card-title">${s.album}</div><div class="card-subtitle">${s.artist}</div></div>
      `).join('')}</div>`;
    } else if (tab === 'liked') {
      const liked = SW_DATA.songs.filter(s => player.liked.has(s.id));
      if (liked.length) {
        html = liked.map((s, i) => songRow(s, i + 1)).join('');
      } else {
        html = `<div class="empty-state"><i class="far fa-heart"></i><h3>No hay canciones favoritas</h3><p>Dale ❤️ a las canciones que te gusten</p></div>`;
      }
    }
    cont.innerHTML = html;
    bindCardClicks(cont);
    cont.querySelectorAll('.song-row').forEach(r => {
      r.addEventListener('click', () => playSong(parseInt(r.dataset.songId)));
    });
  }

  // ─── AI MIX ───
  function renderAI() {
    const grid = $('mood-grid');
    grid.innerHTML = SW_DATA.moods.map(m => `
      <button class="mood-btn" data-mood="${m.name}" style="--mood-color:${m.color}">
        <span style="font-size:1.3rem">${m.emoji}</span> ${m.name}
      </button>
    `).join('');
    grid.querySelectorAll('.mood-btn').forEach(b => {
      b.onclick = () => {
        grid.querySelectorAll('.mood-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        generateAIPlaylist(b.dataset.mood);
      };
    });
  }

  function generateAIPlaylist(mood) {
    const cont = $('ai-results');
    const songIds = MOOD_SONGS[mood] || [1,2,3];
    const songs = songIds.map(id => SW_DATA.songs.find(s => s.id === id)).filter(Boolean);
    cont.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3><i class="fas fa-sparkles" style="color:var(--accent)"></i> Mix ${mood}</h3>
        <button class="btn-primary" id="ai-play-all"><i class="fas fa-play"></i> Reproducir todo</button>
      </div>
      ${songs.map((s, i) => songRow(s, i + 1)).join('')}
      <div style="margin-top:24px;padding:20px;background:var(--bg-card);border-radius:var(--radius);border:1px solid var(--glass-border)">
        <h4 style="margin-bottom:8px"><i class="fas fa-robot" style="color:var(--accent)"></i> Análisis IA</h4>
        <p style="color:var(--text-secondary);font-size:.9rem">Basado en tu estado de ánimo "${mood}", hemos seleccionado ${songs.length} canciones con BPM, tonalidad y energía optimizados para esta vibra. La IA analiza patrones de escucha y preferencias para crear el mix perfecto.</p>
      </div>`;
    $('ai-play-all').onclick = () => player.loadQueue(songs, 0);
    cont.querySelectorAll('.song-row').forEach(r => {
      r.addEventListener('click', () => {
        const idx = parseInt(r.dataset.index);
        player.loadQueue(songs, idx);
      });
    });
  }

  // ─── MODALS ───
  // Premium
  $('btn-premium').onclick = () => $('modal-premium').classList.add('show');
  $('sidebar-upgrade').onclick = e => { if (e.target.closest('.btn-upgrade')) $('modal-premium').classList.add('show'); };
  $('modal-premium-close').onclick = () => $('modal-premium').classList.remove('show');
  function renderPremium() {
    $('premium-plans').innerHTML = SW_DATA.premiumPlans.map(p => `
      <div class="plan-card ${p.popular ? 'popular' : ''}">
        ${p.popular ? '<span class="plan-badge">MÁS POPULAR</span>' : ''}
        <div class="plan-name">${p.name}</div>
        <div class="plan-price">${p.price}</div>
        <div class="plan-period">${p.period}</div>
        <ul class="plan-features">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
        <button class="btn-primary" style="width:100%;margin-top:16px" onclick="this.textContent='✓ Activado';document.getElementById('modal-premium').classList.remove('show');showToast('¡Premium activado! 🎉')">Elegir Plan</button>
      </div>
    `).join('');
  }

  // Create Playlist
  $('btn-create-playlist').onclick = () => $('modal-create-playlist').classList.add('show');
  $('modal-playlist-close').onclick = () => $('modal-create-playlist').classList.remove('show');
  $('btn-save-playlist').onclick = () => {
    const name = $('playlist-name-input').value.trim();
    if (!name) return;
    const pl = { id: 'user-' + Date.now(), name, desc: $('playlist-desc-input').value.trim(), cover: `https://picsum.photos/seed/u${Date.now()}/300`, songs: [] };
    state.userPlaylists.push(pl);
    localStorage.setItem('sw-playlists', JSON.stringify(state.userPlaylists));
    $('modal-create-playlist').classList.remove('show');
    $('playlist-name-input').value = '';
    $('playlist-desc-input').value = '';
    renderPlaylistSidebar();
    showToast(`Playlist "${name}" creada 🎶`);
  };

  function renderPlaylistSidebar() {
    const list = $('playlist-list');
    list.innerHTML = `
      <a href="#" class="playlist-item" data-playlist="liked"><i class="fas fa-heart"></i> Canciones Favoritas</a>
      <a href="#" class="playlist-item" data-playlist="recent"><i class="fas fa-clock"></i> Escuchado Recientemente</a>
      ${state.userPlaylists.map(p => `<a href="#" class="playlist-item" data-playlist="${p.id}"><i class="fas fa-music"></i> ${p.name}</a>`).join('')}
    `;
    list.querySelectorAll('.playlist-item').forEach(el => {
      el.onclick = e => { e.preventDefault(); openPlaylist(el.dataset.playlist); };
    });
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
  });

  // Lyrics Modal
  $('btn-lyrics').onclick = async () => {
    const song = player.currentSong;
    if (!song) { showToast('Reproduce una canción primero'); return; }
    $('lyrics-title').textContent = song.title;
    $('lyrics-artist').textContent = song.artist;
    $('lyrics-body').innerHTML = '<p class="lyrics-loading"><i class="fas fa-circle-notch fa-spin"></i> Buscando letra...</p>';
    $('modal-lyrics').classList.add('show');
    try {
      const res = await fetch(`/api/lyrics?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`);
      const data = await res.json();
      if (data.lyrics) {
        $('lyrics-body').textContent = data.lyrics;
      } else {
        $('lyrics-body').innerHTML = '<p class="lyrics-none">Letra no disponible para esta canción</p>';
      }
    } catch (e) {
      $('lyrics-body').innerHTML = '<p class="lyrics-none">Error al cargar la letra</p>';
    }
  };
  $('modal-lyrics-close').onclick = () => $('modal-lyrics').classList.remove('show');
  $('modal-lyrics').addEventListener('click', e => {
    if (e.target === $('modal-lyrics')) $('modal-lyrics').classList.remove('show');
  });

  // ─── PANELS ───
  $('btn-queue').onclick = () => { $('queue-panel').classList.toggle('open'); $('notif-panel').classList.remove('open'); renderQueue(); };
  $('queue-close').onclick = () => $('queue-panel').classList.remove('open');
  $('btn-notifications').onclick = () => { $('notif-panel').classList.toggle('open'); $('queue-panel').classList.remove('open'); };

  function renderQueue() {
    const list = $('queue-list');
    if (!player.queue.length) { list.innerHTML = '<div class="empty-state"><i class="fas fa-list"></i><h3>Cola vacía</h3></div>'; return; }
    list.innerHTML = player.queue.map((s, i) => `
      <div class="song-row ${i === player.currentIndex ? 'playing' : ''}" data-index="${i}">
        <span class="song-num">${i + 1}</span>
        <img class="song-img" src="${s.cover}" alt="${s.title}">
        <div class="song-info"><div class="song-name">${s.title}</div><div class="song-artist-name">${s.artist}</div></div>
        <span class="song-duration">${s.duration}</span>
      </div>
    `).join('');
  }

  function renderNotifications() {
    $('notif-list').innerHTML = SW_DATA.notifications.map(n => `
      <div class="notif-item">
        <i class="fas ${n.icon}"></i>
        <div class="notif-item-content"><h4>${n.title}</h4><p>${n.text}</p><small style="color:var(--text-muted)">${n.time}</small></div>
      </div>
    `).join('');
  }

  // ─── ADMIN ───
  $('btn-admin').onclick = () => {
    window.open('admin/index.html', '_blank');
  };

  // ─── FULLSCREEN PLAYER ───
  $('btn-fullscreen').onclick = () => {
    let np = document.querySelector('.now-playing-full');
    if (!np) {
      np = document.createElement('div');
      np.className = 'now-playing-full';
      document.body.appendChild(np);
    }
    const song = player.currentSong;
    if (!song) return;
    np.innerHTML = `
      <button class="btn-icon np-close"><i class="fas fa-chevron-down" style="font-size:1.5rem"></i></button>
      <div class="np-cover"><img src="${song.cover}" alt="${song.title}"></div>
      <div class="np-title">${song.title}</div>
      <div class="np-artist">${song.artist}</div>
      <div class="eq-container">${'<div class="eq-bar"></div>'.repeat(5)}</div>`;
    np.classList.add('show');
    np.querySelector('.np-close').onclick = () => np.classList.remove('show');
  };

  // ─── TRACK CHANGE LISTENER ───
  document.addEventListener('sw-track-change', () => {
    renderQueue();
    // Highlight playing song rows
    document.querySelectorAll('.song-row').forEach(r => {
      r.classList.toggle('playing', parseInt(r.dataset.songId) === player.currentSong?.id);
    });
  });

  // ─── INIT ───
  renderHome();
  renderBrowse();
  renderLibrary();
  renderAI();
  renderPremium();
  renderNotifications();
  renderPlaylistSidebar();
  // ─── KEYBOARD SHORTCUTS ───
  document.addEventListener('keydown', e => {
    // Avoid shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        player.togglePlay();
        break;
      case 'k':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          navigateTo('search');
          $('search-input').focus();
        }
        break;
      case 'ArrowRight':
        player.ytPlayer.seekTo(player.ytPlayer.getCurrentTime() + 10);
        break;
      case 'ArrowLeft':
        player.ytPlayer.seekTo(player.ytPlayer.getCurrentTime() - 10);
        break;
      case 'l':
        const song = player.currentSong;
        if (song) {
          player.toggleLike(song.id);
          showToast(player.liked.has(song.id) ? 'Añadido a favoritos' : 'Eliminado de favoritos');
        }
        break;
    }
  });

  // Set volume bar initial
  $('volume-fill').style.width = '70%';
});
