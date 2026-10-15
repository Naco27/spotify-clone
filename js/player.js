// SoundWave - Player Engine
class SWPlayer {
  constructor() {
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.shuffle = false;
    this.repeat = 0; // 0=off, 1=all, 2=one
    this.volume = 0.7;
    this.liked = new Set(JSON.parse(localStorage.getItem('sw-liked') || '[]'));
    this.history = JSON.parse(localStorage.getItem('sw-history') || '[]');
    this.ytPlayer = null;
    this.ytReady = false;
    this.progressInterval = null;
    this.audio = document.getElementById('audio-player');
    this.audio.volume = this.volume;
    
    // Initialize YouTube API
    const initYT = () => {
      this.ytPlayer = new YT.Player('youtube-player', {
        height: '1',
        width: '1',
        playerVars: {
          'autoplay': 1,
          'controls': 0,
          'disablekb': 1,
          'fs': 0,
          'playsinline': 1,
          'origin': window.location.origin
        },
        events: {
          'onReady': (e) => {
            console.log("YouTube Player Ready");
            this.ytReady = true;
            e.target.setVolume(this.volume * 100);
          },
          'onStateChange': (e) => this._onYtStateChange(e),
          'onError': (e) => this._onYtError(e)
        }
      });
    };

    if (window.YT && window.YT.Player) {
      initYT();
    } else {
      window.onYouTubeIframeAPIReady = initYT;
    }
    
    // Audio Element events
    if (this.audio) {
      this.audio.addEventListener('timeupdate', () => this._updateProgress());
      this.audio.addEventListener('ended', () => this._onEnded());
    }
    
    this._bindEvents();
  }

  _bindEvents() {
    const $ = id => document.getElementById(id);
    $('btn-play').onclick = () => this.togglePlay();
    $('btn-next').onclick = () => this.next();
    $('btn-prev').onclick = () => this.prev();
    $('btn-shuffle').onclick = () => this.toggleShuffle();
    $('btn-repeat').onclick = () => this.toggleRepeat();
    $('player-like').onclick = () => this.toggleLike();

    // Progress bar
    const pb = $('progress-bar');
    pb.addEventListener('click', e => {
      const pct = e.offsetX / pb.offsetWidth;
      const song = this.queue[this.currentIndex];
      
      if (song && song.previewUrl && !song.audioSrc) {
        if (this.audio && this.audio.duration) {
          this.audio.currentTime = pct * this.audio.duration;
          this._updateProgress();
        }
        return;
      }
      
      if (!this.ytReady || !this.ytPlayer) return;
      const dur = this.ytPlayer.getDuration();
      if (dur) {
        this.ytPlayer.seekTo(pct * dur, true);
        this._updateProgress();
      }
    });

    // Volume
    const vb = $('volume-bar');
    vb.addEventListener('click', e => {
      this.volume = Math.max(0, Math.min(1, e.offsetX / vb.offsetWidth));
      if (this.ytReady) {
        this.ytPlayer.setVolume(this.volume * 100);
        if (this.volume > 0 && this.ytPlayer.isMuted()) {
          this.ytPlayer.unMute();
        }
      }
      this._updateVolume();
    });
    $('btn-volume').onclick = () => {
      if (!this.ytReady) return;
      if (this.ytPlayer.isMuted() || this.volume === 0) {
        this.ytPlayer.unMute();
        if (this.volume === 0) this.volume = 0.5;
        this.ytPlayer.setVolume(this.volume * 100);
        $('btn-volume').innerHTML = '<i class="fas fa-volume-up"></i>';
      } else {
        this.ytPlayer.mute();
        $('btn-volume').innerHTML = '<i class="fas fa-volume-mute"></i>';
      }
      this._updateVolume();
    };

    // Fullscreen Now Playing
    const npFull = $('now-playing-full');
    const openNp = () => { if (this.queue[this.currentIndex]) npFull.classList.add('show'); };
    const closeNp = () => npFull.classList.remove('show');
    $('player-track-info').onclick = openNp;
    $('np-close').onclick = closeNp;
    $('np-play').onclick = () => this.togglePlay();
    $('np-prev').onclick = () => this.prev();
    $('np-next').onclick = () => this.next();
    $('np-shuffle').onclick = () => { this.toggleShuffle(); $('np-shuffle').classList.toggle('active'); };
    $('np-repeat').onclick = () => { this.toggleRepeat(); $('np-repeat').classList.toggle('active'); };

    // NP progress bar
    const npPb = $('np-progress-bar');
    npPb.addEventListener('click', e => {
      const pct = e.offsetX / npPb.offsetWidth;
      const song = this.queue[this.currentIndex];
      if (song && song.previewUrl && !song.audioSrc) {
        if (this.audio && this.audio.duration) {
          this.audio.currentTime = pct * this.audio.duration;
          this._updateProgress();
        }
        return;
      }
      if (!this.ytReady || !this.ytPlayer) return;
      const dur = this.ytPlayer.getDuration();
      if (dur) {
        this.ytPlayer.seekTo(pct * dur, true);
        this._updateProgress();
      }
    });
  }

  loadQueue(songs, startIndex = 0) {
    this.queue = [...songs];
    this.currentIndex = startIndex;
    this._playCurrent();
  }

  _playCurrent() {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return;
    const song = this.queue[this.currentIndex];
    this._updateUI(song);
    
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    if (song.audioSrc) {
      if (this.ytReady && this.ytPlayer) {
        this.audio.pause();
        this._loadYtWithFallback(song);
        this.isPlaying = true;
        this.progressInterval = setInterval(() => this._updateProgress(), 500);
      } else {
        console.warn("YouTube player not ready yet, retrying...");
        setTimeout(() => this._playCurrent(), 500);
        return;
      }
    } else {
      // Resolve missing audioSrc on the fly
      this._resolveAndPlay(song);
      return;
    }
    
    this._updatePlayBtn();
    this._addToHistory(song.id);
    document.dispatchEvent(new CustomEvent('sw-track-change', { detail: song }));
  }

  async _loadYtWithFallback(song) {
    this.ytPlayer.loadVideoById(song.audioSrc);
    this._ytRetried = false;
    this._ytRetryCount = 0;
  }

  async _resolveAndPlay(song) {
    showToast('Buscando audio...', 'fa-sync fa-spin', 4000);
    try {
      const res = await fetch(`/api/resolve?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`);
      const data = await res.json();
      if (data.audioSrc) {
        song.audioSrc = data.audioSrc;
        song.previews = data.previews || [];
        this._playCurrent();
      } else {
        this._playPreview(song, data.previews || this._previewListFor(song));
      }
    } catch (e) {
      console.error("Resolution error:", e);
      this._playPreview(song, this._previewListFor(song));
    }
  }

  _previewListFor(song) {
    const list = [];
    if (song.previewUrl && !list.includes(song.previewUrl)) list.push(song.previewUrl);
    (song.previews || []).forEach(u => { if (u && !list.includes(u)) list.push(u); });
    return list;
  }

  _playPreview(song, previews) {
    if (!this.audio) return;
    if (!previews || !previews.length) {
      showToast('No se encontró fuente de audio', 'fa-exclamation-triangle');
      return;
    }
    const url = previews[0];
    this._previewList = previews.slice(1);
    this.audio.src = url;
    this.audio.play()
      .then(() => {
        this.isPlaying = true;
        this._updatePlayBtn();
        showToast('Reproduciendo vista previa oficial');
      })
      .catch(() => {
        if (this._previewList && this._previewList.length) {
          this._playPreview(song, this._previewList);
        } else {
          showToast('No se pudo reproducir la vista previa', 'fa-exclamation-triangle');
        }
      });
  }

  async _onYtError(e) {
    // Error codes: 2=invalid ID, 5=HTML5, 100=not found, 101/150=embed not allowed
    console.warn('YouTube error code:', e.data);
    const song = this.queue[this.currentIndex];
    if (!song) return;

    this._ytRetryCount = (this._ytRetryCount || 0) + 1;
    
    // Stop after several failed attempts to prevent infinite loops
    if (this._ytRetryCount > 4) {
      console.error(`Playback failed for "${song.title}" after 4 retries.`);
      showToast(`"${song.title}" no disponible en este momento`, 'fa-exclamation-circle');
      this.isPlaying = false;
      this._updatePlayBtn();
      return;
    }

    // Inform user of the recovery attempt
    const msg = this._ytRetryCount === 1 ? 'Buscando versión alternativa...' : `Reintentando búsqueda (${this._ytRetryCount}/4)...`;
    showToast(msg, 'fa-sync fa-spin');

    // Build progressively broader queries
    const queries = [
      `${song.title} ${song.artist} topic`,
      `${song.title} ${song.artist} official audio`,
      `${song.title} ${song.artist} lyrics`,
      `${song.title} ${song.artist}`,
      `${song.artist} ${song.title}`
    ];
    const query = queries[Math.min(this._ytRetryCount - 1, queries.length - 1)];

    try {
      // Use the resolve API for precision or search for variety
      const endpoint = this._ytRetryCount % 2 === 0 
        ? `/api/resolve?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}&retry=${this._ytRetryCount}`
        : `/api/search?q=${encodeURIComponent(query)}&retrying=${this._ytRetryCount}`;
      
      const res = await fetch(endpoint);
      const data = await res.json();
      
      // Look for a new source in results (search) or directly (resolve)
      const newSource = data.audioSrc || (data.results && data.results.find(r => r.audioSrc && r.audioSrc !== song.audioSrc)?.audioSrc);
      
      if (newSource && newSource !== song.audioSrc) {
        console.log(`Retry ${this._ytRetryCount}: found alternative ${newSource}`);
        song.audioSrc = newSource;
        this.ytPlayer.loadVideoById(song.audioSrc);
        this.isPlaying = true;
      } else if (this._ytRetryCount < 4) {
        // Recurse to next strategy immediately if this one yielded no new source
        setTimeout(() => this._onYtError(e), 300);
      } else {
        showToast(`No se encontró una versión reproducible de "${song.title}"`, 'fa-exclamation-triangle');
      }
    } catch(err) {
      console.error('Fallback search failed:', err);
      if (this._ytRetryCount < 4) {
        setTimeout(() => this._onYtError(e), 500);
      }
    }
  }

  _onYtStateChange(event) {
    // YT.PlayerState.ENDED = 0
    // YT.PlayerState.PLAYING = 1
    // YT.PlayerState.PAUSED = 2
    if (event.data === YT.PlayerState.ENDED) {
      this._onEnded();
    } else if (event.data === YT.PlayerState.PLAYING) {
      this.isPlaying = true;
      this._updatePlayBtn();
      
      // Update duration when video actually starts playing
      const dur = this.ytPlayer.getDuration();
      if (dur > 0) {
        document.getElementById('time-total').textContent = this._fmt(dur);
      }
    } else if (event.data === YT.PlayerState.PAUSED) {
      this.isPlaying = false;
      this._updatePlayBtn();
    }
  }

  togglePlay() {
    if (this.queue.length === 0) return;
    
    const song = this.queue[this.currentIndex];
    if (song && song.previewUrl && !song.audioSrc) {
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) {
        this.audio.play();
      } else {
        this.audio.pause();
      }
      this._updatePlayBtn();
      return;
    }

    if (!this.ytReady) return;
    if (this.isPlaying) {
      this.ytPlayer.pauseVideo();
    } else {
      this.ytPlayer.playVideo();
    }
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.shuffle) {
      this.currentIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    }
    this._playCurrent();
  }

  prev() {
    if (this.queue.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
    this._playCurrent();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    document.getElementById('btn-shuffle').classList.toggle('active', this.shuffle);
    showToast(this.shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado');
  }

  toggleRepeat() {
    this.repeat = (this.repeat + 1) % 3;
    const btn = document.getElementById('btn-repeat');
    btn.classList.toggle('active', this.repeat > 0);
    const labels = ['Repetir desactivado', 'Repetir todo', 'Repetir una'];
    showToast(labels[this.repeat]);
  }

  toggleLike() {
    const song = this.queue[this.currentIndex];
    if (!song) return;
    if (this.liked.has(song.id)) { this.liked.delete(song.id); } else { this.liked.add(song.id); }
    localStorage.setItem('sw-liked', JSON.stringify([...this.liked]));
    const btn = document.getElementById('player-like');
    btn.classList.toggle('liked', this.liked.has(song.id));
    btn.innerHTML = this.liked.has(song.id) ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
    showToast(this.liked.has(song.id) ? 'Añadida a Favoritas ❤️' : 'Eliminada de Favoritas');
  }

  _onEnded() {
    if (this.repeat === 2) { 
      this.ytPlayer.seekTo(0); 
      this.ytPlayer.playVideo(); 
      return; 
    }
    if (this.repeat === 1 || this.currentIndex < this.queue.length - 1) { 
      this.next(); 
      return; 
    }
    this.isPlaying = false;
    this._updatePlayBtn();
  }

  _updateUI(song) {
    document.getElementById('player-title').textContent = song.title;
    document.getElementById('player-artist').textContent = song.artist;
    const cover = document.getElementById('player-cover');
    const ytThumb = song.audioSrc ? `https://img.youtube.com/vi/${song.audioSrc}/mqdefault.jpg` : '';
    const coverHtml = `<img src="${song.cover}" alt="${song.title}" onerror="this.onerror=null; this.src='${ytThumb}';">`;
    cover.innerHTML = coverHtml;

    // Fullscreen now-playing
    const npTitle = document.getElementById('np-title');
    const npArtist = document.getElementById('np-artist');
    const npCover = document.getElementById('np-cover');
    const npBg = document.getElementById('np-bg');
    if (npTitle) npTitle.textContent = song.title;
    if (npArtist) npArtist.textContent = song.artist;
    if (npCover) npCover.innerHTML = coverHtml;
    if (npBg && song.cover) npBg.style.backgroundImage = `url(${song.cover})`;

    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('time-current').textContent = '0:00';
    document.getElementById('time-total').textContent = song.duration;
    const npTimeTotal = document.getElementById('np-time-total');
    const npTimeCurrent = document.getElementById('np-time-current');
    const npProgressFill = document.getElementById('np-progress-fill');
    if (npTimeTotal) npTimeTotal.textContent = song.duration;
    if (npTimeCurrent) npTimeCurrent.textContent = '0:00';
    if (npProgressFill) npProgressFill.style.width = '0%';
    const btn = document.getElementById('player-like');
    btn.classList.toggle('liked', this.liked.has(song.id));
    btn.innerHTML = this.liked.has(song.id) ? '<i class="fas fa-heart"></i>' : '<i class="far fa-heart"></i>';
    document.title = `${song.title} • ${song.artist} — SoundWave`;
  }

  _updatePlayBtn() {
    const icon = this.isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    document.getElementById('btn-play').innerHTML = icon;
    const npPlay = document.getElementById('np-play');
    if (npPlay) npPlay.innerHTML = icon;
  }

  _updateProgress() {
    const song = this.queue[this.currentIndex];
    const npFill = document.getElementById('np-progress-fill');
    const npCur = document.getElementById('np-time-current');
    if (song && song.previewUrl && !song.audioSrc) {
      if (!this.audio.duration) return;
      const pct = (this.audio.currentTime / this.audio.duration) * 100;
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('time-current').textContent = this._fmt(this.audio.currentTime);
      if (npFill) npFill.style.width = pct + '%';
      if (npCur) npCur.textContent = this._fmt(this.audio.currentTime);
      return;
    }

    if (!this.ytReady || !this.isPlaying) return;
    const currentTime = this.ytPlayer.getCurrentTime();
    const duration = this.ytPlayer.getDuration();
    if (!duration) return;
    
    const pct = (currentTime / duration) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('time-current').textContent = this._fmt(currentTime);
    if (npFill) npFill.style.width = pct + '%';
    if (npCur) npCur.textContent = this._fmt(currentTime);
  }

  _updateVolume() {
    document.getElementById('volume-fill').style.width = (this.volume * 100) + '%';
    if (this.audio) {
       this.audio.volume = this.volume;
       this.audio.muted = (this.volume === 0);
    }
  }

  _fmt(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  _addToHistory(id) {
    this.history = [id, ...this.history.filter(x => x !== id)].slice(0, 30);
    localStorage.setItem('sw-history', JSON.stringify(this.history));
  }

  get currentSong() { return this.queue[this.currentIndex] || null; }
}

function showToast(msg, icon = 'fa-check-circle', duration = 2500) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<i class="fas ${icon}"></i> ${msg}`;
  c.appendChild(t);
  
  // Animate in
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
  });

  setTimeout(() => { 
    t.style.opacity = '0'; 
    t.style.transform = 'translateY(20px)'; 
    setTimeout(() => t.remove(), 300); 
  }, duration);
}
