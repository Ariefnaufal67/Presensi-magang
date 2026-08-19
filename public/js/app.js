/* ==========================================================================
   Presensi — App Logic
   Frontend vanilla JS untuk halaman login, badge peserta, dan kiosk admin.
   Mengonsumsi endpoint serverless di /api/[...route].js
   ========================================================================== */
(function(){
  // ---------- helpers ----------
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function initials(name){ return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase(); }
  function formatTanggal(tk){
    const d = new Date(tk + 'T00:00:00');
    return d.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  }
  async function api(path, options){
    const res = await fetch(path, options);
    let data = {};
    try{ data = await res.json(); }catch(e){}
    return { ok: res.ok, status: res.status, data };
  }

  let currentPeserta = null;
  let currentAdmin = null;
  let scanner = null;

  // ---------- nav ----------
  const viewLogin = document.getElementById('view-login');
  const viewBadge = document.getElementById('view-badge');
  const viewKiosk = document.getElementById('view-kiosk');
  const whoRow = document.getElementById('whoRow');

  function hideAll(){
    [viewLogin, viewBadge, viewKiosk].forEach(v=>v.classList.remove('active'));
    stopScanner();
  }
  function goLogin(){
    hideAll();
    currentPeserta = null; currentAdmin = null;
    whoRow.style.display = 'none';
    document.getElementById('loginNim').value='';
    document.getElementById('loginUser').value='';
    document.getElementById('loginPass').value='';
    document.getElementById('pesertaLoginError').innerHTML='';
    document.getElementById('adminLoginError').innerHTML='';
    viewLogin.classList.add('active');
  }
  document.getElementById('logoutBtn').addEventListener('click', goLogin);

  // ---------- login mode toggle ----------
  document.querySelectorAll('.segmented button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.segmented button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('formPeserta').style.display = btn.dataset.mode==='peserta' ? 'block':'none';
      document.getElementById('formAdmin').style.display = btn.dataset.mode==='admin' ? 'block':'none';
    });
  });

  // ---------- admin login ----------
  document.getElementById('submitAdminLogin').addEventListener('click', async ()=>{
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const err = document.getElementById('adminLoginError');
    err.innerHTML = '';
    const { ok, data } = await api('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ role:'admin', username, password })
    });
    if(ok && data.ok){
      currentAdmin = data.admin;
      hideAll();
      whoRow.style.display='flex';
      document.getElementById('whoami').textContent = 'Admin · ' + currentAdmin.username;
      viewKiosk.classList.add('active');
      await renderKiosk();
      startScanner();
    } else {
      err.innerHTML = `<div class="login-error">${escapeHtml((data && data.message) || 'Gagal login.')}</div>`;
    }
  });

  // ---------- peserta login ----------
  document.getElementById('submitPesertaLogin').addEventListener('click', async ()=>{
    const nim = document.getElementById('loginNim').value.trim();
    const err = document.getElementById('pesertaLoginError');
    err.innerHTML = '';
    const { ok, data } = await api('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ role:'peserta', nim })
    });
    if(ok && data.ok){
      currentPeserta = data.peserta;
      hideAll();
      whoRow.style.display='flex';
      document.getElementById('whoami').textContent = currentPeserta.nama;
      document.getElementById('badgeGreeting').textContent = 'Halo, ' + currentPeserta.nama;
      renderCard(currentPeserta);
      viewBadge.classList.add('active');
      loadHistory(currentPeserta.id);
      loadIzinRiwayat(currentPeserta.id);
      const today = new Date();
      const minDate = new Date(today); minDate.setDate(minDate.getDate() - 3);
      document.getElementById('izinTanggal').min = minDate.toISOString().slice(0,10);
      document.getElementById('izinTanggal').value = today.toISOString().slice(0,10);
      resetIzinBuktiInput();
    } else {
      err.innerHTML = `<div class="login-error">${escapeHtml((data && data.message) || 'NIM / ID tidak ditemukan.')}</div>`;
    }
  });

  // ---------- badge (peserta) ----------
  function renderCard(p){
    document.getElementById('avatarInit').textContent = initials(p.nama);
    document.getElementById('idcardName').textContent = p.nama;
    document.getElementById('idcardId').textContent = p.id + ' · ' + p.nim;
    const qrBox = document.getElementById('idcardQr');
    qrBox.innerHTML = '';
    new QRCode(qrBox, { text: 'KARTU|'+p.id, width:150, height:150, colorDark:'#3A2A1C', colorLight:'#ffffff', correctLevel: QRCode.CorrectLevel.M });
  }

  async function loadHistory(pesertaId){
    const body = document.getElementById('historyBody');
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Memuat riwayat…</td></tr>';
    const { ok, data } = await api('/api/history?pesertaId=' + encodeURIComponent(pesertaId));
    if(!ok || !data.history || data.history.length===0){
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Belum ada riwayat kehadiran.</td></tr>';
      return;
    }
    body.innerHTML = data.history.map(r=>{
      const statusPill = `<span class="pill ${statusPillClass(r.statusMasuk)}">${r.statusMasuk}</span>`;
      const pulangCell = r.sumber === 'izin'
        ? '<span class="pill dash">—</span>'
        : r.jamPulang
          ? `${r.jamPulang}${r.pulangManual ? ' <span class="pill dash">manual</span>' : ''}`
          : '<span class="pill dash">belum pulang</span>';
      return `<tr><td>${formatTanggalSingkat(r.tanggal)}</td><td class="mono">${r.jamMasuk || '—'}</td><td>${statusPill}</td><td class="mono">${pulangCell}</td></tr>`;
    }).join('');
  }
  function statusPillClass(status){
    if(status==='Tepat waktu') return 'tepat';
    if(status==='Terlambat') return 'terlambat';
    if(status==='Izin' || status==='Sakit' || status==='Cuti') return 'izin';
    return 'dash';
  }
  function formatTanggalSingkat(tk){
    const d = new Date(tk + 'T00:00:00');
    return d.toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'});
  }

  // ---------- izin (peserta) ----------
  let izinBuktiDataUrl = null;

  function resetIzinBuktiInput(){
    izinBuktiDataUrl = null;
    document.getElementById('izinBukti').value = '';
    document.getElementById('izinBuktiPreviewWrap').style.display = 'none';
  }

  function compressImage(file, maxWidth){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error('Gagal membaca file.'));
      reader.onload = ()=>{
        const img = new Image();
        img.onerror = ()=>reject(new Error('File bukan gambar yang valid.'));
        img.onload = ()=>{
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('izinBukti').addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    const msg = document.getElementById('izinSubmitMsg');
    msg.innerHTML = '';
    if(!file) { resetIzinBuktiInput(); return; }
    try{
      izinBuktiDataUrl = await compressImage(file, 900);
      const preview = document.getElementById('izinBuktiPreview');
      preview.src = izinBuktiDataUrl;
      document.getElementById('izinBuktiPreviewWrap').style.display = 'block';
    }catch(err){
      izinBuktiDataUrl = null;
      msg.innerHTML = `<div class="msg-err">${escapeHtml(err.message || 'Gagal memproses gambar.')}</div>`;
    }
  });

  document.getElementById('submitIzin').addEventListener('click', async ()=>{
    const tanggal = document.getElementById('izinTanggal').value;
    const jenis = document.getElementById('izinJenis').value;
    const alasan = document.getElementById('izinAlasan').value.trim();
    const msg = document.getElementById('izinSubmitMsg');
    msg.innerHTML = '';
    if(!currentPeserta) return;
    const { ok, data } = await api('/api/izin', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pesertaId: currentPeserta.id, tanggal, jenis, alasan, buktiFoto: izinBuktiDataUrl })
    });
    if(ok && data.ok){
      document.getElementById('izinAlasan').value = '';
      resetIzinBuktiInput();
      msg.innerHTML = '<div class="msg-ok">Pengajuan izin terkirim, menunggu persetujuan admin.</div>';
      loadIzinRiwayat(currentPeserta.id);
    } else {
      msg.innerHTML = `<div class="msg-err">${escapeHtml((data && data.message) || 'Gagal mengajukan izin.')}</div>`;
    }
  });

  function buktiThumbHtml(buktiFoto){
    if(!buktiFoto) return '';
    return `<div class="bukti-thumb" onclick="openImageModal(this.querySelector('img').src)"><img src="${buktiFoto}" alt="Bukti"></div>`;
  }

  const imgModalOverlay = document.getElementById('imgModalOverlay');
  const imgModalImg = document.getElementById('imgModalImg');
  function openImageModal(src){
    imgModalImg.src = src;
    imgModalOverlay.classList.add('show');
  }
  window.openImageModal = openImageModal;
  function closeImageModal(){
    imgModalOverlay.classList.remove('show');
    imgModalImg.src = '';
  }
  document.getElementById('imgModalClose').addEventListener('click', closeImageModal);
  imgModalOverlay.addEventListener('click', (e)=>{ if(e.target === imgModalOverlay) closeImageModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeImageModal(); });

  async function loadIzinRiwayat(pesertaId){
    const el = document.getElementById('izinRiwayatList');
    el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Memuat…</div>';
    const { ok, data } = await api('/api/izin?pesertaId=' + encodeURIComponent(pesertaId));
    if(!ok || !data.izin || data.izin.length===0){
      el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Belum ada pengajuan izin.</div>';
      return;
    }
    el.innerHTML = data.izin.map(r=>{
      const statusClass = r.status==='Disetujui' ? 'izin' : r.status==='Ditolak' ? 'ditolak' : 'menunggu';
      const susulanTag = r.susulan ? ' <span class="pill dash">susulan</span>' : '';
      return `<div class="izin-item">
        <div class="izin-item-top">
          <span>${escapeHtml(r.jenis)} · ${formatTanggalSingkat(r.tanggal)}${susulanTag}</span>
          <span class="pill ${statusClass}">${escapeHtml(r.status)}</span>
        </div>
        <div class="izin-item-alasan">${escapeHtml(r.alasan)}</div>
        ${buktiThumbHtml(r.buktiFoto)}
      </div>`;
    }).join('');
  }

  // ---------- kiosk (admin) ----------
  async function renderKiosk(){
    const s = await api('/api/settings');
    if(s.ok){
      document.getElementById('jamMasuk').value = s.data.jamMasuk;
      document.getElementById('toleransi').value = s.data.toleransi;
    }
    await refreshToday();
    await refreshRoster();
    await refreshIzinPending();
    await refreshStats();
    await refreshAdminList();
  }

  let statsPeriodDays = 14;
  document.getElementById('statsPeriodTabs').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-days]');
    if(!btn) return;
    document.querySelectorAll('#statsPeriodTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    statsPeriodDays = parseInt(btn.dataset.days, 10);
    refreshStats();
  });

  let statsChartInstance = null;
  async function refreshStats(){
    const { ok, data } = await api('/api/stats?days=' + statsPeriodDays);
    if(!ok) return;
    document.getElementById('statTotalHadir').textContent = data.ringkasan.totalHadir;
    document.getElementById('statPersenTepat').textContent = data.ringkasan.persenTepatWaktu===null ? '–' : data.ringkasan.persenTepatWaktu + '%';
    document.getElementById('statTotalTerlambat').textContent = data.ringkasan.totalTerlambat;
    document.getElementById('statTotalIzin').textContent = data.ringkasan.totalIzin;

    const labels = data.daily.map(d => new Date(d.tanggal+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short'}));
    const ctx = document.getElementById('statsChart').getContext('2d');
    if(statsChartInstance) statsChartInstance.destroy();
    statsChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Tepat waktu', data:data.daily.map(d=>d.tepat), backgroundColor:'#5C7A34', stack:'s' },
          { label:'Terlambat', data:data.daily.map(d=>d.terlambat), backgroundColor:'#8A3F2C', stack:'s' },
          { label:'Izin/Sakit/Cuti', data:data.daily.map(d=>d.izin), backgroundColor:'#C98A1F', stack:'s' }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ stacked:true, ticks:{ color:'#8A6F52', font:{size:10} }, grid:{ display:false } },
          y:{ stacked:true, beginAtZero:true, ticks:{ color:'#8A6F52', font:{size:10}, precision:0 }, grid:{ color:'#DEC49A' } }
        },
        plugins:{ legend:{ labels:{ color:'#8A6F52', font:{size:10.5}, boxWidth:10, padding:10 } } }
      }
    });

    const rankEl = document.getElementById('statsPeringkat');
    if(!data.peringkat.length){
      rankEl.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Belum ada data kehadiran di periode ini.</div>';
    } else {
      rankEl.innerHTML = data.peringkat.slice(0,8).map((r,i)=>`
        <div class="rank-row">
          <div class="rank-num">${i+1}</div>
          <div>
            <div class="rank-name">${escapeHtml(r.nama)}</div>
            <div class="rank-sub">${r.hadir} hadir · ${r.tepat} tepat waktu · ${r.terlambat} telat${r.izin?` · ${r.izin} izin`:''}</div>
          </div>
          <div class="rank-pct" style="margin-left:auto;">${r.persenTepatWaktu===null?'–':r.persenTepatWaktu+'%'}</div>
        </div>
      `).join('');
    }
  }

  let izinFilterStatus = 'Menunggu';
  document.getElementById('izinFilterTabs').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-status]');
    if(!btn) return;
    document.querySelectorAll('#izinFilterTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    izinFilterStatus = btn.dataset.status;
    refreshIzinPending();
  });

  async function refreshIzinPending(){
    const { ok, data } = await api('/api/izin?status=' + encodeURIComponent(izinFilterStatus));
    if(!ok) return;
    renderIzinPending(data.izin || []);
  }
  function renderIzinPending(list){
    const el = document.getElementById('izinPendingList');
    const countTag = document.getElementById('izinPendingCount');
    if(list.length===0){
      countTag.style.display = 'none';
      el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Tidak ada pengajuan di kategori ini.</div>';
      return;
    }
    countTag.style.display = 'inline-block';
    countTag.textContent = list.length;
    el.innerHTML = '';
    list.forEach(r=>{
      const item = document.createElement('div');
      item.className = 'izin-item';
      const susulanTag = r.susulan ? ' <span class="pill dash">susulan</span>' : '';
      const statusClass = r.status==='Disetujui' ? 'izin' : r.status==='Ditolak' ? 'ditolak' : 'menunggu';
      item.innerHTML = `
        <div class="izin-item-top">
          <span>${escapeHtml(r.nama)}</span>
          <span class="pill izin">${escapeHtml(r.jenis)}</span>
        </div>
        <div class="izin-item-meta">${formatTanggalSingkat(r.tanggal)}${susulanTag} · <span class="pill ${statusClass}" style="margin-left:2px;">${escapeHtml(r.status)}</span></div>
        <div class="izin-item-alasan">${escapeHtml(r.alasan)}</div>
        ${buktiThumbHtml(r.buktiFoto)}
      `;

      if(r.status === 'Menunggu'){
        const actions = document.createElement('div');
        actions.className = 'izin-item-actions';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'mini-btn approve';
        approveBtn.textContent = 'Setujui';
        approveBtn.addEventListener('click', async ()=>{
          const { ok, data } = await api('/api/izin-approve', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ izinId: r.id })
          });
          if(ok && data.ok){
            await refreshIzinPending();
            await refreshToday();
          } else {
            alert((data && data.message) || 'Gagal menyetujui izin.');
          }
        });
        actions.appendChild(approveBtn);

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'mini-btn';
        rejectBtn.textContent = 'Tolak';
        rejectBtn.addEventListener('click', async ()=>{
          const { ok, data } = await api('/api/izin-reject', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ izinId: r.id })
          });
          if(ok && data.ok){
            await refreshIzinPending();
          } else {
            alert((data && data.message) || 'Gagal menolak izin.');
          }
        });
        actions.appendChild(rejectBtn);

        item.appendChild(actions);
      }

      el.appendChild(item);
    });
  }

  async function refreshToday(){
    const { ok, data } = await api('/api/today');
    if(!ok) return;
    document.getElementById('tanggalHariIni').textContent = formatTanggal(data.tanggal);
    renderLog(data.log || []);
  }
  function renderLog(log){
    const body = document.getElementById('logBody');
    if(log.length===0){
      body.innerHTML = '<tr class="empty-row"><td colspan="4">Belum ada aktivitas scan hari ini.</td></tr>';
    } else {
      body.innerHTML = log.slice().reverse().map(r=>{
        const rows = [];
        if(r.sumber === 'izin'){
          rows.push(`<tr><td>${escapeHtml(r.nama)}</td><td class="mono">—</td><td><span class="pill izin">${escapeHtml(r.statusMasuk)}</span></td><td><span class="pill dash">disetujui admin</span></td></tr>`);
          return rows.join('');
        }
        rows.push(`<tr><td>${escapeHtml(r.nama)}</td><td class="mono">${r.jamMasuk}</td><td><span class="pill masuk">Masuk</span></td><td><span class="pill ${r.statusMasuk==='Tepat waktu'?'tepat':'terlambat'}">${r.statusMasuk}</span></td></tr>`);
        if(r.jamPulang){
          rows.push(`<tr><td>${escapeHtml(r.nama)}</td><td class="mono">${r.jamPulang}</td><td><span class="pill pulang">Pulang</span></td><td>${r.pulangManual ? '<span class="pill dash">manual</span>' : '<span class="pill dash">—</span>'}</td></tr>`);
        }
        return rows.join('');
      }).join('');
    }
    const hadir = log.filter(r=>r.sumber !== 'izin');
    const masuk = hadir.length;
    const pulang = hadir.filter(r=>r.jamPulang).length;
    document.getElementById('statMasuk').textContent = masuk;
    document.getElementById('statPulang').textContent = pulang;
  }

  async function refreshRoster(){
    const { ok, data } = await api('/api/roster');
    if(!ok) return;
    renderRoster(data.roster || []);
  }
  function renderRoster(roster){
    const el = document.getElementById('rosterList');
    if(roster.length===0){
      el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Belum ada peserta terdaftar.</div>';
      return;
    }
    el.innerHTML = '';
    roster.forEach(p=>{
      const row = document.createElement('div');
      row.className = 'roster-item';

      const left = document.createElement('div');
      left.className = 'roster-left';
      const asalLine = p.asalKampus && p.asalKampus !== '-' ? `<span class="nim">${escapeHtml(p.asalKampus)}</span>` : '';
      left.innerHTML = `<span>${escapeHtml(p.nama)}</span><span class="nim">${p.id} · ${escapeHtml(p.nim)}</span>${asalLine}`;
      row.appendChild(left);

      const actions = document.createElement('div');
      actions.className = 'roster-actions';

      const markBtn = document.createElement('button');
      markBtn.className = 'mini-btn';
      markBtn.textContent = 'Tandai Pulang';
      markBtn.title = 'Tandai pulang manual (tanpa scan)';
      markBtn.addEventListener('click', async ()=>{
        const { ok, data } = await api('/api/mark-pulang', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ pesertaId: p.id })
        });
        if(ok && data.ok){
          await refreshToday();
        } else {
          alert((data && data.message) || 'Gagal menandai pulang.');
        }
      });
      actions.appendChild(markBtn);

      const del = document.createElement('button');
      del.className='icon-btn'; del.textContent='✕'; del.title='Hapus peserta';
      del.addEventListener('click', async ()=>{
        await api('/api/roster?id=' + encodeURIComponent(p.id), { method:'DELETE' });
        await refreshRoster();
      });
      actions.appendChild(del);

      row.appendChild(actions);
      el.appendChild(row);
    });
  }

  document.getElementById('addPeserta').addEventListener('click', async ()=>{
    const nama = document.getElementById('newNama').value.trim();
    const nim = document.getElementById('newNim').value.trim();
    const asalKampus = document.getElementById('newAsalKampus').value.trim();
    if(!nama) return;
    const { ok, data } = await api('/api/roster', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ nama, nim, asalKampus })
    });
    if(ok && data.ok){
      document.getElementById('newNama').value=''; document.getElementById('newNim').value=''; document.getElementById('newAsalKampus').value='';
      renderRoster(data.roster);
    }
  });

  document.getElementById('saveSettings').addEventListener('click', async ()=>{
    const jamMasuk = document.getElementById('jamMasuk').value || '08:00';
    const toleransi = parseInt(document.getElementById('toleransi').value) || 0;
    await api('/api/settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jamMasuk, toleransi })
    });
    const btn = document.getElementById('saveSettings');
    const orig = btn.textContent; btn.textContent = 'Tersimpan ✓';
    setTimeout(()=> btn.textContent = orig, 1200);
  });

  document.getElementById('saveCredentials').addEventListener('click', async ()=>{
    const username = document.getElementById('newAdminUser').value.trim();
    const password = document.getElementById('newAdminPass').value;
    const msg = document.getElementById('credentialMsg');
    if(!currentAdmin){ return; }
    const { ok, data } = await api('/api/credentials', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ oldUsername: currentAdmin.username, username, password })
    });
    if(ok && data.ok){
      document.getElementById('newAdminUser').value='';
      document.getElementById('newAdminPass').value='';
      msg.innerHTML = '<div class="msg-ok">Kredensial berhasil diganti. Gunakan yang baru saat login berikutnya.</div>';
      currentAdmin = { username };
      document.getElementById('whoami').textContent = 'Admin · ' + currentAdmin.username;
      await refreshAdminList();
    } else {
      msg.innerHTML = `<div class="msg-err">${escapeHtml((data && data.message) || 'Gagal mengganti kredensial.')}</div>`;
    }
  });

  // ---------- kelola daftar admin ----------
  async function refreshAdminList(){
    const { ok, data } = await api('/api/admins');
    if(!ok) return;
    renderAdminList(data.admins || []);
  }
  function renderAdminList(admins){
    const el = document.getElementById('adminAccList');
    if(admins.length===0){
      el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);">Belum ada akun admin lain.</div>';
      return;
    }
    el.innerHTML = '';
    admins.forEach(a=>{
      const row = document.createElement('div');
      row.className = 'roster-item';
      const isSelf = currentAdmin && a.username === currentAdmin.username;
      row.innerHTML = `<span>${escapeHtml(a.username)}${isSelf ? ' <span class="pill dash">kamu</span>' : ''}</span>`;
      if(!isSelf){
        const del = document.createElement('button');
        del.className='icon-btn'; del.textContent='✕'; del.title='Hapus admin ini';
        del.addEventListener('click', async ()=>{
          const { ok, data } = await api('/api/admins?username=' + encodeURIComponent(a.username), { method:'DELETE' });
          if(ok && data.ok){
            renderAdminList(data.admins);
          } else {
            alert((data && data.message) || 'Gagal menghapus admin.');
          }
        });
        row.appendChild(del);
      }
      el.appendChild(row);
    });
  }
  document.getElementById('addAdminAcc').addEventListener('click', async ()=>{
    const username = document.getElementById('newAdminAccUser').value.trim();
    const password = document.getElementById('newAdminAccPass').value;
    const msg = document.getElementById('addAdminMsg');
    const { ok, data } = await api('/api/admins', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, password })
    });
    if(ok && data.ok){
      document.getElementById('newAdminAccUser').value='';
      document.getElementById('newAdminAccPass').value='';
      msg.innerHTML = '<div class="msg-ok">Admin baru berhasil ditambahkan.</div>';
      renderAdminList(data.admins);
    } else {
      msg.innerHTML = `<div class="msg-err">${escapeHtml((data && data.message) || 'Gagal menambah admin.')}</div>`;
    }
  });

  // ---------- scanning ----------
  async function startScanner(){
    const cap = document.getElementById('scanCaption');
    try{
      scanner = new Html5Qrcode("reader");
      const cams = await Html5Qrcode.getCameras();
      if(!cams || cams.length===0){ cap.textContent = 'Kamera tidak tersedia — pakai input ID manual'; return; }
      await scanner.start({facingMode:"environment"}, {fps:10, qrbox:230}, (text)=>handleScan(text), ()=>{});
    }catch(e){
      cap.textContent = 'Akses kamera ditolak — pakai input ID manual';
    }
  }
  function stopScanner(){
    if(scanner){ scanner.stop().then(()=>scanner.clear()).catch(()=>{}); scanner=null; }
  }
  function handleScan(text){
    const parts = text.split('|');
    if(parts[0] !== 'KARTU' || !parts[1]){ processResult(null, 'Kartu tidak dikenali', null); return; }
    processId(parts[1]);
  }
  document.getElementById('submitManual').addEventListener('click', ()=>{
    const val = document.getElementById('manualId').value.trim().toUpperCase();
    if(!val) return;
    processId(val);
    document.getElementById('manualId').value='';
  });

  async function processId(id){
    const { ok, data } = await api('/api/scan', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id })
    });
    if(!ok){
      processResult(null, (data && data.message) || 'Terjadi kesalahan.', null);
      return;
    }
    if(data.ok){
      await refreshToday();
      processResult(data.peserta, data.message, data.jenis);
    } else {
      processResult(data.peserta || null, data.message, null);
    }
  }

  function processResult(p, msg, jenis){
    const banner = document.getElementById('resultBanner');
    const flash = document.getElementById('flashOverlay');
    banner.classList.remove('masuk','pulang','error');
    banner.classList.add('show', jenis==='Masuk' ? 'masuk' : jenis==='Pulang' ? 'pulang' : 'error');
    document.getElementById('resultName').textContent = p ? p.nama : 'Tidak dikenali';
    document.getElementById('resultSub').textContent = msg;
    document.getElementById('resultIcon').innerHTML = jenis
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>';
    flash.classList.add('on');
    setTimeout(()=>flash.classList.remove('on'), 200);
    setTimeout(()=>banner.classList.remove('show'), 4000);
  }

  goLogin();
})();
