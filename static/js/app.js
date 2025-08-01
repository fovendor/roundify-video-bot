/* eslint-env browser */
document.addEventListener('DOMContentLoaded', () => {
  /* mini-$ selector */
  const $ = s => document.querySelector(s);

  // ───── constants ─────
  const MAX_SIZE_BYTES = 600 * 1024 * 1024; // 600 МБ

  const fileInp = $("#file"),
    uploadLabel = $("#uploadLabel"),
    fileLbl = $("#fileLabel"),
    progressBarFill = $("#progressBarFill"),
    chevBtn = $("#chevron"),
    advBlk = $("#advanced"),
    convertBtn = $("#convert"),
    status = $("#status"),
    durationSlider = $("#duration"),
    offsetSlider = $("#offset"),
    sizeSlider = $("#size"),
    tokenInp = $("#token"),
    chatInp = $("#chat");

  let currentJobId = null;
  let sourceDuration = 0;
  let clipSec = 60;
  let statusTimer = null;
  let resetTimer = null;
  let ws = null;

  convertBtn.disabled = true;

  function bytesToMB(b) {
    return (b / 1048576).toFixed(1);
  }

  function connectWebSocket(jobId) {
    if (ws) ws.close();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/${jobId}`);

    ws.onmessage = (event) => {
      const d = JSON.parse(event.data);
      console.log("Received from WebSocket:", d);

      switch (d.type) {
        case 'queued':
          fileLbl.innerHTML = `<span class="loader"></span> Ваша позиция в очереди: ${d.position}`;
          break;
        case 'progress':
          updateProgress(d.ms / (clipSec * 1000));
          break;
        case 'status_update':
          // можно вывести d.status при желании
          break;
        case 'done':
          handleDone(d);
          ws.close();
          break;
        case 'error':
          status.textContent = "⚠️ " + d.message;
          resetUI();
          ws.close();
          break;
      }
    };

    ws.onclose  = () => console.log('WebSocket disconnected.');
    ws.onerror  = (error) => {
      console.error('WebSocket Error:', error);
      status.textContent = "⚠️ Connection error.";
      resetUI();
    };
  }

  fileInp.addEventListener("change", async () => {
    const file = fileInp.files[0];
    if (!file) { resetUI(); return; }

    /* --- новая клиентская проверка размера --- */
    if (file.size > MAX_SIZE_BYTES) {
      status.textContent = `⚠️ Файл слишком большой: ${bytesToMB(file.size)} МБ. Лимит — 600 МБ.`;
      fileInp.value = '';
      return;
    }
    /* ----------------------------------------- */

    resetUI();
    uploadLabel.classList.add('is-disabled');
    fileLbl.innerHTML = '<span class="loader"></span>';
    status.textContent = '';

    const fd = new FormData();
    fd.append("video", file);

    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });

      /* --- обработка 413 от сервера --- */
      if (r.status === 413) {
        throw new Error("Файл превышает лимит 600 МБ (проверка сервера)");
      }
      /* -------------------------------- */

      const meta = await r.json();
      if (!r.ok) throw new Error(meta.detail || r.statusText);

      currentJobId = meta.job_id;
      sourceDuration = meta.duration;

      updateSliders(
        sourceDuration,
        Math.min(parseInt(durationSlider.max, 10), sourceDuration)
      );
      fileLbl.textContent =
        `${meta.duration.toFixed(1)} сек | ${meta.width}×${meta.height} | ${meta.size_mb.toFixed(1)} МБ`;

      convertBtn.disabled = false;
      uploadLabel.classList.remove('is-disabled');
      connectWebSocket(currentJobId);
    } catch (e) {
      status.textContent = "⚠️ " + e.message;
      resetUI();
    }
  });

  convertBtn.addEventListener("click", () => {
    if (!currentJobId || !ws || ws.readyState !== WebSocket.OPEN) {
      status.textContent = "Сначала выберите файл и дождитесь подключения.";
      return;
    }

    resetProgress();
    fileLbl.innerHTML = '<span class="loader"></span> Отправка запроса...';
    status.textContent = "";
    convertBtn.disabled = true;
    uploadLabel.classList.add('is-disabled');
    clipSec = +durationSlider.value;

    const payload = {
      type: "start_conversion",
      options: {
        size: parseInt(sizeSlider.value, 10),
        clip_sec: parseFloat(durationSlider.value),
        offset: parseFloat(offsetSlider.value),
        token: tokenInp.value,
        chat:  chatInp.value,
      }
    };
    ws.send(JSON.stringify(payload));
  });

  function handleDone(d) {
    updateProgress(1);

    const downloadLink = document.createElement('a');
    downloadLink.href = d.download;
    downloadLink.target = "_blank";
    downloadLink.textContent = "Скачать видео";

    const timerSpan = document.createElement('span');
    timerSpan.style.marginLeft = '1px';

    let remainingTime = d.ttl;
    if (statusTimer) clearInterval(statusTimer);

    const updateTimer = () => {
      if (remainingTime > 0) {
        timerSpan.textContent = `ещё: ${remainingTime}с`;
        remainingTime--;
      } else {
        clearInterval(statusTimer);
      }
    };
    statusTimer = setInterval(updateTimer, 1000);
    updateTimer();

    status.innerHTML = ``;
    status.appendChild(downloadLink);
    status.append(' можно ');
    status.appendChild(timerSpan);
    resetForNewUpload();

    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      if (d.job === currentJobId) {
        resetUI();
      }
    }, d.ttl * 1000);
  }

  chevBtn.addEventListener("click", () => {
    chevBtn.classList.toggle("open");
    advBlk.classList.toggle("open");
  });

  /* ─── sliders ───────────────────── */
  function updateSliders(totalDuration, defaultClipDuration) {
    durationSlider.max = Math.ceil(Math.min(totalDuration, parseInt(durationSlider.max, 10)));
    durationSlider.value = Math.ceil(defaultClipDuration);
    $("#durOut").textContent = durationSlider.value;
    clipSec = defaultClipDuration;

    offsetSlider.max = Math.floor(totalDuration - defaultClipDuration);
    offsetSlider.value = 0;
    $("#offOut").textContent = 0;
  }

  durationSlider.addEventListener("input", () => {
    clipSec = +durationSlider.value;
    $("#durOut").textContent = clipSec;
    offsetSlider.max = Math.max(0, Math.floor(sourceDuration - clipSec));
    if (+offsetSlider.value > +offsetSlider.max) {
      offsetSlider.value = offsetSlider.max;
      $("#offOut").textContent = offsetSlider.value;
    }
  });

  offsetSlider.addEventListener("input", () => $("#offOut").textContent = offsetSlider.value);
  sizeSlider.addEventListener("input",   () => $("#sizeOut").textContent = sizeSlider.value);

  /* ─── helpers / reset ───────────── */
  function resetForNewUpload() {
    uploadLabel.classList.remove('is-disabled');
    fileLbl.textContent = 'Загрузить видео...';
    fileLbl.style.color = '';
    progressBarFill.style.width = '0%';
    convertBtn.disabled = true;
    fileInp.value = '';
  }

  function resetUI() {
    resetForNewUpload();
    status.innerHTML = '';
    if (ws) {
      ws.close();
      ws = null;
    }
    if (statusTimer) clearInterval(statusTimer);
    if (resetTimer)  clearTimeout(resetTimer);
    currentJobId = null;
  }

  function resetProgress() {
    fileLbl.textContent = '0%';
    fileLbl.style.color = 'var(--accent)';
    progressBarFill.style.width = '0%';
  }

  function updateProgress(v) {
    const pct = Math.min(100, v * 100);
    fileLbl.textContent = `${Math.round(pct)}%`;
    progressBarFill.style.width = `${pct}%`;

    fileLbl.style.color = pct >= 47 ? '#fff' : 'var(--accent)';
  }
});
