(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const audio = $('#audio');
  let hls = null;

  const state = {
    authed: false,
    queue: [],
    index: -1,
    currentTrack: null,
    likedIds: new Set(),
    waveform: null,
    anonymous: false,
  };

  function fmtTime(msOrSec, isMs = false) {
    const s = Math.floor(isMs ? msOrSec / 1000 : msOrSec);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function artworkUrl(track, size = 'large') {
    const raw = track.artwork_url || (track.user && track.user.avatar_url) || '';
    if (!raw) return '';
    return `/media?u=${encodeURIComponent(raw.replace('-large', `-${size}`))}`;
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
    }
    return res.json();
  }

  async function init() {
    try {
      const status = await api('/api/status');
      state.authed = status.authed;
      if (status.authed) {
        showApp(status);
      } else {
        showLogin(status.auth_error === 'invalid_token'
          ? 'Сохранённый токен недействителен. Вставьте новый.'
          : null);
      }
    } catch {
      showLogin('Сервер недоступен.');
    }
  }

  function showLogin(error) {
    $('#login-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    if (error) {
      $('#login-error').textContent = error;
      $('#login-error').classList.remove('hidden');
    }
  }

  function showApp(status) {
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    state.anonymous = !status.authed;
    if (status.authed) {
      $('#user-block').classList.remove('hidden');
      $('#user-name').textContent = status.username || '';
      if (status.avatar_url) $('#user-avatar').src = `/media?u=${encodeURIComponent(status.avatar_url)}`;
      loadLikedIds();
      loadView('feed');
    } else {
      $$('.personal').forEach((el) => el.classList.add('hidden'));
      loadView('search');
    }
  }

  $('#login-btn').addEventListener('click', async () => {
    const token = $('#token-input').value.trim();
    if (!token) return;
    $('#login-error').classList.add('hidden');
    try {
      const r = await api('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      showApp({ authed: true, username: r.profile.username, avatar_url: r.profile.avatar_url });
    } catch (e) {
      $('#login-error').textContent = 'Неверный токен. Проверьте значение oauth_token.';
      $('#login-error').classList.remove('hidden');
    }
  });
  $('#token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-btn').click(); });

  $('#anon-btn').addEventListener('click', () => showApp({ authed: false }));

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/token', { method: 'DELETE' }).catch(() => {});
    location.reload();
  });

  async function loadLikedIds() {
    try {
      const data = await api('/api/me/likes');
      for (const item of data.collection || []) {
        const t = item.track || item;
        if (t && t.id) state.likedIds.add(t.id);
      }
    } catch {}
    try {
      const local = await api('/api/local-likes');
      for (const id of local.ids || []) state.likedIds.add(id);
    } catch {}
  }

  $$('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadView(btn.dataset.view));
  });

  function setActiveNav(view) {
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

  async function loadView(view, arg) {
    setActiveNav(view);
    $('#playlist-grid').classList.add('hidden');
    $('#empty-state').classList.add('hidden');
    $('#loading').classList.remove('hidden');
    $('#track-list').innerHTML = '';

    const titles = { feed: 'Лента', likes: 'Лайки', playlists: 'Плейлисты', search: 'Поиск', playlist: 'Плейлист' };
    $('#view-title').textContent = titles[view] || '';

    try {
      if (view === 'feed') {
        try {
          const home = await api('/api/feed-home');
          renderShelves(home.shelves || []);
          $('#loading').classList.add('hidden');
          return;
        } catch {
          const data = await api('/api/feed');
          const tracks = (data.collection || [])
            .map((item) => item.track || item.origin || (item.playlist ? null : item))
            .filter((t) => t && t.title && t.duration);
          renderTracks(tracks);
        }
      } else if (view === 'likes') {
        const data = await api('/api/me/likes');
        const tracks = (data.collection || []).map((i) => i.track || i).filter((t) => t && t.title);
        renderTracks(tracks);
      } else if (view === 'playlists') {
        const data = await api('/api/me/playlists');
        renderPlaylists(data.collection || []);
        $('#loading').classList.add('hidden');
        return;
      } else if (view === 'playlist') {
        const data = await api(`/api/playlists/${arg}`);
        $('#view-title').textContent = data.title || 'Плейлист';
        renderTracks((data.tracks || []).filter((t) => t && t.title));
      } else if (view === 'sysplaylist') {
        const data = await api(`/api/system-playlist?u=${encodeURIComponent(arg)}`);
        $('#view-title').textContent = data.title || 'Подборка';
        renderTracks((data.tracks || []).filter((t) => t && t.title));
      } else if (view === 'search') {
        const q = $('#search-input').value.trim();
        if (q) {
          const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
          renderTracks(data.collection || []);
        } else {
          $('#track-list').innerHTML = '';
        }
      }
    } catch (e) {
      $('#track-list').innerHTML = `<div id="empty-state">Ошибка: ${e.message}</div>`;
    }
    $('#loading').classList.add('hidden');
  }

  function renderPlaylists(playlists) {
    const grid = $('#playlist-grid');
    grid.classList.remove('hidden');
    grid.innerHTML = '';
    if (!playlists.length) {
      $('#empty-state').classList.remove('hidden');
      return;
    }
    for (const pl of playlists) {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      const art = pl.artwork_url
        ? `/media?u=${encodeURIComponent(pl.artwork_url.replace('-large', '-t300x300'))}`
        : '';
      card.innerHTML = `
        ${art ? `<img src="${art}">` : '<img alt="">'}
        <div class="pl-title"></div>
        <div class="pl-count">${pl.track_count || 0} треков</div>`;
      card.querySelector('.pl-title').textContent = pl.title || 'Без названия';
      card.addEventListener('click', () => loadView('playlist', pl.id));

      if (!art) {
        const img = card.querySelector('img');
        api(`/api/playlists/${pl.id}`)
          .then((d) => {
            const first = (d.tracks || []).find((t) => t && t.artwork_url);
            if (first) img.src = `/media?u=${encodeURIComponent(first.artwork_url.replace('-large', '-t300x300'))}`;
          })
          .catch(() => {});
      }

      grid.appendChild(card);
    }
  }

  function renderShelves(shelves) {
    const list = $('#track-list');
    list.innerHTML = '';
    $('#view-meta').textContent = '';
    if (!shelves.length) {
      $('#empty-state').classList.remove('hidden');
      return;
    }
    $('#empty-state').classList.add('hidden');
    for (const shelf of shelves) {
      if (/recently played/i.test(shelf.title || '')) continue;
      const section = document.createElement('section');
      section.className = 'shelf';
      const h = document.createElement('h3');
      h.className = 'shelf-title';
      h.textContent = shelf.title;
      const scroll = document.createElement('div');
      scroll.className = 'shelf-scroll';

      const shelfTracks = shelf.items.filter((i) => i.type === 'track').map((i) => i.track);

      shelf.items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'shelf-card';
        let art = '';
        let title = '';
        let sub = '';
        if (item.type === 'track') {
          art = artworkUrl(item.track, 't300x300');
          title = item.track.title;
          sub = (item.track.user && item.track.user.username) || '';
        } else {
          art = item.artwork ? `/media?u=${encodeURIComponent(item.artwork)}` : '';
          title = item.title;
          sub = item.subtitle || '';
        }
        card.innerHTML = `
          ${art ? `<img src="${art}" alt="">` : '<img alt="">'}
          <div class="sc-title"></div>
          <div class="sc-sub"></div>`;
        card.querySelector('.sc-title').textContent = title || '—';
        card.querySelector('.sc-sub').textContent = sub;

        card.addEventListener('click', () => {
          if (item.type === 'track') {
            const idx = shelfTracks.findIndex((t) => t.id === item.track.id);
            if (idx >= 0) playQueue(shelfTracks, idx);
          } else if (item.type === 'playlist') {
            loadView('playlist', item.id);
          } else if (item.type === 'sysplaylist') {
            loadView('sysplaylist', item.urn);
          }
        });
        scroll.appendChild(card);
      });

      section.appendChild(h);
      section.appendChild(scroll);
      list.appendChild(section);
    }
  }

  function renderTracks(tracks) {
    const list = $('#track-list');
    list.innerHTML = '';
    $('#view-meta').textContent = tracks.length ? `${tracks.length} трек(ов)` : '';
    if (!tracks.length) {
      $('#empty-state').classList.remove('hidden');
      return;
    }
    $('#empty-state').classList.add('hidden');

    tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      row.className = 'track-row' + (state.currentTrack && state.currentTrack.id === track.id ? ' playing' : '');
      row.dataset.trackId = track.id;
      row.innerHTML = `
        <img class="track-art" src="${artworkUrl(track)}" alt="">
        <div class="track-meta">
          <div class="track-title"></div>
          <div class="track-artist"></div>
        </div>
        <span class="eq"><i></i><i></i><i></i></span>
        <div class="track-duration">${fmtTime(track.duration || 0, true)}</div>
        <button class="track-like ${state.likedIds.has(track.id) ? 'liked' : ''}" title="Лайк">
          ${state.likedIds.has(track.id) ? '♥' : '♡'}
        </button>`;
      row.querySelector('.track-title').textContent = track.title || '—';
      row.querySelector('.track-artist').textContent = (track.user && track.user.username) || '';

      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-like')) return;
        if (e.target.closest('.track-art')) { openArtModal(track); return; }
        playQueue(tracks, idx);
      });

      const likeBtn = row.querySelector('.track-like');
      if (state.anonymous) likeBtn.classList.add('hidden');
      likeBtn.addEventListener('click', () => toggleLike(track, likeBtn));

      list.appendChild(row);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  async function toggleLike(track, btn) {
    const liked = state.likedIds.has(track.id);
    try {
      const r = await api(`/api/likes/${track.id}`, { method: liked ? 'DELETE' : 'POST' });
      if (liked) state.likedIds.delete(track.id);
      else state.likedIds.add(track.id);
      btn.classList.toggle('liked', !liked);
      btn.textContent = !liked ? '♥' : '♡';
      if (!liked) burstHearts(btn);
      if (r && r.local) {
        toast('SC ограничил лайки в сторонних клиентах — сохранил локально');
      } else {
        toast(liked ? 'Убрано из лайков' : 'Добавлено в лайки');
      }
      if (state.currentTrack && state.currentTrack.id === track.id) updatePlayerLike();
    } catch (e) {
      console.error('like failed', e);
      toast('Не удалось поставить лайк');
    }
  }

  function burstHearts(btn) {
    for (let i = 0; i < 6; i++) {
      const p = document.createElement('span');
      p.className = 'heart-particle';
      p.textContent = '♥';
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 70}px`);
      p.style.setProperty('--dy', `${-30 - Math.random() * 50}px`);
      p.style.setProperty('--rt', `${(Math.random() - 0.5) * 90}deg`);
      btn.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
  }

  let searchTimer = null;
  $('#search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadView('search'), 300);
  });

  function playQueue(tracks, idx) {
    state.queue = tracks;
    state.index = idx;
    playCurrent();
    renderQueue();
  }

  function renderQueue() {
    const list = $('#queue-list');
    list.innerHTML = '';
    state.queue.forEach((t, i) => {
      const item = document.createElement('div');
      item.className = 'queue-item' + (i === state.index ? ' playing' : '');
      item.textContent = `${i + 1}. ${t.title}`;
      item.addEventListener('click', () => { state.index = i; playCurrent(); renderQueue(); });
      list.appendChild(item);
    });
  }

  let playSeq = 0;
  let failStreak = 0;

  async function playCurrent() {
    const seq = ++playSeq;
    const track = state.queue[state.index];
    if (!track) return;
    state.currentTrack = track;
    state.waveform = null;

    if (hls) { hls.destroy(); hls = null; }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    $('#player-title').textContent = track.title || '—';
    $('#player-artist').textContent = (track.user && track.user.username) || '';
    const art = artworkUrl(track, 't300x300');
    if (art) {
      $('#player-artwork').src = art;
      $('#player-artwork').classList.remove('hidden');
      $('#player').style.setProperty('--player-art', `url("${art}")`);
      $('#player').classList.add('has-art');
    } else {
      $('#player').classList.remove('has-art');
    }
    $('#time-total').textContent = fmtTime(track.duration || 0, true);
    updatePlayerLike();
    $$('.track-row').forEach((r) => {
      r.classList.toggle('playing', state.currentTrack && r.dataset.trackId === String(track.id));
    });
    drawWaveform();

    if (track.waveform_url) {
      fetch(`/media?u=${encodeURIComponent(track.waveform_url)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.samples && state.currentTrack === track) {
            state.waveform = data.samples;
            drawWaveform();
          }
        })
        .catch(() => {});
    }

    try {
      const stream = await api(`/api/stream/${track.id}`);
      if (seq !== playSeq) return;
      audio.volume = Number($('#volume').value);
      if (stream.type === 'hls' && window.Hls && Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(stream.url);
        hls.attachMedia(audio);
      } else {
        audio.src = stream.url;
      }
      try {
        await audio.play();
      } catch (err) {
        if (err && err.name !== 'AbortError') throw err;
      }
      if (seq === playSeq) failStreak = 0;
    } catch (e) {
      if (seq !== playSeq) return;
      console.error('playback failed', e);
      $('#player-title').textContent = `${track.title} — ошибка, пропускаю`;
      if (++failStreak < 3) setTimeout(() => { if (seq === playSeq) next(); }, 1200);
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: (track.user && track.user.username) || '',
        artwork: art ? [{ src: art, sizes: '300x300' }] : [],
      });
      navigator.mediaSession.setActionHandler('previoustrack', prev);
      navigator.mediaSession.setActionHandler('nexttrack', next);
    }
  }

  function updatePlayerLike() {
    const liked = state.currentTrack && state.likedIds.has(state.currentTrack.id);
    $('#like-btn').classList.toggle('liked', !!liked);
    $('#like-btn').textContent = liked ? '♥' : '♡';
  }

  function next() {
    if (!state.queue.length) return;
    state.index = (state.index + 1) % state.queue.length;
    playCurrent();
    renderQueue();
  }

  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (state.index > 0) {
      state.index--;
      playCurrent();
      renderQueue();
    }
  }

  $('#play-btn').addEventListener('click', () => {
    if (audio.paused) audio.play(); else audio.pause();
  });
  $('#next-btn').addEventListener('click', next);
  $('#prev-btn').addEventListener('click', prev);
  $('#like-btn').addEventListener('click', () => {
    if (state.currentTrack && !state.anonymous) toggleLike(state.currentTrack, $('#like-btn'));
  });
  const savedVolume = Number(localStorage.getItem('sv_volume'));
  if (!Number.isNaN(savedVolume) && localStorage.getItem('sv_volume') !== null) {
    $('#volume').value = savedVolume;
  }
  audio.volume = Number($('#volume').value);
  $('#volume').addEventListener('input', (e) => {
    audio.volume = Number(e.target.value);
    localStorage.setItem('sv_volume', e.target.value);
  });

  audio.addEventListener('play', () => { $('#play-btn').textContent = '⏸'; document.body.classList.remove('paused'); });
  audio.addEventListener('pause', () => { $('#play-btn').textContent = '▶'; document.body.classList.add('paused'); });
  audio.addEventListener('ended', next);
  audio.addEventListener('timeupdate', () => {
    $('#time-current').textContent = fmtTime(audio.currentTime);
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    $('#waveform-progress').style.width = pct + '%';
    $('#pacman').style.left = pct + '%';
  });

  $('#waveform-wrap').addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  function drawWaveform() {
    const canvas = $('#waveform');
    const wrap = $('#waveform-wrap');
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const samples = state.waveform;
    const bars = 120;
    const max = samples ? Math.max(...samples, 1) : 1;
    const barW = w / bars;

    for (let i = 0; i < bars; i++) {
      let v;
      if (samples) {
        const idx = Math.floor((i / bars) * samples.length);
        v = samples[idx] / max;
      } else {
        v = 0.15 + 0.1 * Math.sin(i * 0.7);
      }
      const bh = Math.max(2, v * (h - 4));
      ctx.fillStyle = samples ? '#55555f' : '#3a3a44';
      ctx.fillRect(i * barW + 1, (h - bh) / 2, barW - 2, bh);
    }
  }
  window.addEventListener('resize', drawWaveform);

  function fmtCount(n) {
    if (n == null) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function openArtModal(track) {
    if (!track) return;
    const art = artworkUrl(track, 't500x500');
    $('#modal-art').src = art || artworkUrl(track, 't300x300');
    $('#modal-title').textContent = track.title || '—';
    $('#modal-artist').textContent = (track.user && track.user.username) || '';
    const stats = [];
    if (track.duration) stats.push(`Длительность <b>${fmtTime(track.duration, true)}</b>`);
    if (track.playback_count != null) stats.push(`Прослушивания <b>${fmtCount(track.playback_count)}</b>`);
    if (track.likes_count != null) stats.push(`Лайки <b>${fmtCount(track.likes_count)}</b>`);
    if (track.genre) stats.push(`Жанр <b>${track.genre}</b>`);
    if (track.created_at) stats.push(`Дата <b>${new Date(track.created_at).toLocaleDateString('ru-RU')}</b>`);
    $('#modal-stats').innerHTML = stats.join('<span>·</span>');
    const desc = (track.description || '').trim();
    $('#modal-desc').textContent = desc;
    $('#modal-desc').classList.toggle('hidden', !desc);
    $('#art-modal').classList.add('open');
  }

  function closeArtModal() {
    $('#art-modal').classList.remove('open');
  }

  $('#player-artwork').addEventListener('click', () => openArtModal(state.currentTrack));
  $('#modal-close').addEventListener('click', closeArtModal);
  $('#art-modal').addEventListener('click', (e) => {
    if (e.target.id === 'art-modal') closeArtModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (audio.paused) audio.play(); else audio.pause();
        break;
      case 'ArrowLeft': audio.currentTime = Math.max(0, audio.currentTime - 5); break;
      case 'ArrowRight': audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
      case 'KeyN': next(); break;
      case 'KeyP': prev(); break;
      case 'Escape': closeArtModal(); break;
    }
  });

  init();

  (() => {
    const cv = document.getElementById('dots-bg');
    const ctx = cv.getContext('2d');
    const GAP = 26;
    const RADIUS = 150;
    let dots = [];
    let mx = -9999, my = -9999;

    function build() {
      const dpr = window.devicePixelRatio || 1;
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      for (let x = GAP / 2; x < innerWidth; x += GAP)
        for (let y = GAP / 2; y < innerHeight; y += GAP)
          dots.push({ x, y, lift: 0 });
    }

    window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });
    window.addEventListener('mouseout', () => { mx = my = -9999; });
    window.addEventListener('resize', build);

    function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const d of dots) {
        const dx = d.x - mx, dy = d.y - my;
        const dist = Math.hypot(dx, dy);
        const target = dist < RADIUS ? 1 - dist / RADIUS : 0;
        d.lift += (target - d.lift) * 0.12;
        const lift = d.lift;
        const r = 1 + lift * 1.6;
        if (lift > 0.02) {
          ctx.fillStyle = `rgba(255, ${Math.round(120 + lift * 60)}, ${Math.round(40 * (1 - lift))}, ${0.15 + lift * 0.6})`;
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        }
        ctx.beginPath();
        ctx.arc(d.x + dx / (dist || 1) * lift * 10, d.y - lift * 22, r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }
    build();
    tick();
  })();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
