/* mini-$ selector */ const $ = s => document.querySelector(s);

const fileInp = $("#file"), fileLbl = $("#fileLabel"), uploadLabel = $("#uploadLabel"),
  chevBtn = $("#chevron"), advBlk = $("#advanced"), convertBtn = $("#convert"),
  status = $("#status"), durationSlider = $("#duration"), offsetSlider = $("#offset"),
  sizeSlider = $("#size"), tokenInp = $("#token"), chatInp = $("#chat");

let currentJobId = null;
let sourceDuration = 0;
let clipSec = 60;
let statusTimer = null; // Для таймера TTL

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
  convertBtn.disabled = true; // Кнопка "Convert" неактивна при старте
});


// --- Event Listeners ---

fileInp.addEventListener("change", async () => {
  const file = fileInp.files[0];
  if (!file) {
    resetUI();
    return;
  }

  fileLbl.textContent = file.name;
  fileLbl.style.fontWeight = 'normal';
  uploadLabel.style.backgroundSize = '0% 100%';

  status.innerHTML = '<span class="loader"></span>Reading meta…';
  convertBtn.disabled = true;

  const fd = new FormData();
  fd.append("video", file);

  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const meta = await r.json();
    if (!r.ok) throw new Error(meta.error || r.statusText);

    currentJobId = meta.job_id;
    sourceDuration = meta.duration;

    updateSliders(sourceDuration, Math.min(parseInt(durationSlider.max, 10), sourceDuration));

    status.textContent = `Duration: ${meta.duration.toFixed(1)}s | Res: ${meta.width}×${meta.height}`;
    convertBtn.disabled = false;

    sio.emit("join", { job: currentJobId });

  } catch (e) {
    status.textContent = "⚠️ " + e.message;
    resetUI();
  }
});

convertBtn.addEventListener("click", async () => {
  if (!currentJobId) {
    status.textContent = "Please select a file first.";
    return;
  }

  resetProgress();
  status.textContent = "Uploading & processing…";
  convertBtn.disabled = true;
  clipSec = +durationSlider.value;

  const fd = new FormData();
  fd.append("job_id", currentJobId);
  fd.append("size", sizeSlider.value);
  fd.append("duration", durationSlider.value);
  fd.append("offset", offsetSlider.value);
  if (tokenInp.value) fd.append("token", tokenInp.value);
  if (chatInp.value) fd.append("chat", chatInp.value);

  try {
    const r = await fetch("/api/convert", { method: "POST", body: fd });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || r.statusText);

  } catch (e) {
    status.textContent = "⚠️ " + e.message;
    convertBtn.disabled = false;
  }
});

chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk.classList.toggle("open");
});

// --- Sliders Logic ---

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
sizeSlider.addEventListener("input", () => $("#sizeOut").textContent = sizeSlider.value);

// --- WebSocket Logic ---

const sio = io({ transports: ["websocket"], autoConnect: true });

sio.on("progress", d => {
  if (d.job !== currentJobId) return;
  const progressValue = d.ms / (clipSec * 1000);
  updateProgress(progressValue);
});

sio.on("status_update", d => {
  if (d.job !== currentJobId) return;
  status.textContent = d.status;
});

sio.on("done", d => {
  if (d.job !== currentJobId) return;
  updateProgress(1); // Финальные 100%

  const tg = d.telegram ? " ↗️ Sent to TG" : "";

  const downloadLink = document.createElement('a');
  downloadLink.href = d.download;
  downloadLink.target = "_blank";
  downloadLink.textContent = "Download";

  const timerSpan = document.createElement('span');
  timerSpan.style.marginLeft = '10px';

  let remainingTime = d.ttl;
  if (statusTimer) clearInterval(statusTimer);

  const updateTimer = () => {
    if (remainingTime > 0) {
      timerSpan.textContent = `(expires in ${remainingTime}s)`;
      remainingTime--;
    } else {
      timerSpan.textContent = "(expired)";
      downloadLink.style.pointerEvents = "none";
      downloadLink.style.textDecoration = "line-through";
      clearInterval(statusTimer);
    }
  };

  statusTimer = setInterval(updateTimer, 1000);
  updateTimer();

  status.innerHTML = `Done — `;
  status.appendChild(downloadLink);
  status.appendChild(timerSpan);
  status.innerHTML += tg;

  setTimeout(() => {
    resetUI();
    status.textContent = 'Ready for next video.';
  }, 5000);

  sio.emit("leave", { job: d.job });
  currentJobId = null;
});

// --- UI Helper Functions ---

function resetUI() {
  convertBtn.disabled = true;
  fileInp.value = ''; // Сбрасываем выбранный файл
  uploadLabel.style.backgroundSize = '0% 100%';
  fileLbl.textContent = 'Choose video…';
  fileLbl.style.fontWeight = 'normal';
  status.textContent = '';
  if (statusTimer) clearInterval(statusTimer);
}

function resetProgress() {
  uploadLabel.style.backgroundSize = '0% 100%';
  fileLbl.textContent = '0%';
  fileLbl.style.fontWeight = 'bold';
}

function updateProgress(v) {
  const pct = Math.min(100, Math.round(v * 100));
  uploadLabel.style.backgroundSize = `${pct}% 100%`;
  fileLbl.textContent = `${pct}%`;
}