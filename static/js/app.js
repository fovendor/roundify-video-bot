/* mini-$ selector */ const $ = s => document.querySelector(s);

const fileInp = $("#file"),
  uploadLabel = $("#uploadLabel"),
  fileLbl = $("#fileLabel"),
  progressBarFill = $("#progressBarFill"),
  chevBtn = $("#chevron"), advBlk = $("#advanced"), convertBtn = $("#convert"),
  status = $("#status"), durationSlider = $("#duration"), offsetSlider = $("#offset"),
  sizeSlider = $("#size"), tokenInp = $("#token"), chatInp = $("#chat");

let currentJobId = null;
let sourceDuration = 0;
let clipSec = 60;
let statusTimer = null;
let resetTimer = null;

document.addEventListener('DOMContentLoaded', () => { convertBtn.disabled = true; });

fileInp.addEventListener("change", async () => {
  const file = fileInp.files[0];
  if (!file) { resetUI(); return; }

  resetUI();

  uploadLabel.classList.add('is-disabled');
  fileLbl.innerHTML = '<span class="loader"></span>';
  status.textContent = '';

  const fd = new FormData();
  fd.append("video", file);

  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const meta = await r.json();
    if (!r.ok) throw new Error(meta.error || r.statusText);

    currentJobId = meta.job_id;
    sourceDuration = meta.duration;

    updateSliders(sourceDuration, Math.min(parseInt(durationSlider.max, 10), sourceDuration));

    fileLbl.textContent = `${meta.duration.toFixed(1)} сек | ${meta.width}×${meta.height} | ${meta.size_mb.toFixed(1)}MB`;

    convertBtn.disabled = false;
    uploadLabel.classList.remove('is-disabled');

    sio.emit("join", { job: currentJobId });

  } catch (e) {
    status.textContent = "⚠️ " + e.message;
    resetUI();
  }
});

convertBtn.addEventListener("click", async () => {
  if (!currentJobId) { status.textContent = "Please select a file first."; return; }

  resetProgress();
  status.textContent = "";
  convertBtn.disabled = true;
  uploadLabel.classList.add('is-disabled');
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
    uploadLabel.classList.remove('is-disabled');
  }
});

chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk.classList.toggle("open");
});

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

const sio = io({ transports: ["websocket"], autoConnect: true });

sio.on("progress", d => {
  if (d.job !== currentJobId) return;
  updateProgress(d.ms / (clipSec * 1000));
});

sio.on("status_update", d => {
  if (d.job !== currentJobId) return;
  // status.textContent = d.status;
});

sio.on("done", d => {
  if (d.job !== currentJobId) return;
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
      timerSpan.textContent = `(ссылка истекла)`;
      downloadLink.style.pointerEvents = "none";
      downloadLink.style.textDecoration = "line-through";
      clearInterval(statusTimer);
    }
  };

  statusTimer = setInterval(updateTimer, 1000);
  updateTimer();

  status.innerHTML = ``;
  status.appendChild(downloadLink);
  status.append(' можно ');
  status.appendChild(timerSpan);

  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    resetUI();
  }, d.ttl * 1000 + 1000);

  sio.emit("leave", { job: d.job });
  currentJobId = null;
});

function resetUI() {
  convertBtn.disabled = true;
  uploadLabel.classList.remove('is-disabled');
  fileInp.value = '';
  fileLbl.textContent = 'Загрузить видео...';
  fileLbl.style.color = '';
  progressBarFill.style.width = '0%';
  status.innerHTML = '';
  if (statusTimer) clearInterval(statusTimer);
  if (resetTimer) clearTimeout(resetTimer);
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

  if (pct >= 47) {
    fileLbl.style.color = '#fff';
  } else {
    fileLbl.style.color = 'var(--accent)';
  }
}