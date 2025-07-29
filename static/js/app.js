/* mini-$ selector */ const $ = s => document.querySelector(s);

const fileInp = $("#file"), fileLbl = $("#fileLabel"), chevBtn = $("#chevron"),
  advBlk = $("#advanced"), convertBtn = $("#convert"), status = $("#status"),
  bar = $("#bar"), pctTxt = $("#pct"), durationSlider = $("#duration"),
  offsetSlider = $("#offset"), sizeSlider = $("#size"), tokenInp = $("#token"),
  chatInp = $("#chat");

let currentJobId = null;
let sourceDuration = 0;
let clipSec = 60;

// --- Event Listeners ---

fileInp.addEventListener("change", async () => {
  const file = fileInp.files[0];
  fileLbl.textContent = file?.name || "Choose video…";
  if (!file) {
    resetUI();
    return;
  }

  status.innerHTML = '<span class="loader"></span>Uploading & reading meta…';
  convertBtn.disabled = true;

  const fd = new FormData();
  fd.append("video", file);

  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const meta = await r.json();
    if (!r.ok) throw new Error(meta.error || r.statusText);

    currentJobId = meta.job_id;
    sourceDuration = meta.duration;
    // Используем актуальную длительность клипа из слайдера
    clipSec = +durationSlider.value;

    updateSliders(sourceDuration, Math.min(60, sourceDuration));
    status.textContent =
      `Duration: ${meta.duration.toFixed(1)} s | ` +
      `Res: ${meta.width}×${meta.height} | ` +
      `Size: ${meta.size_mb.toFixed(2)} MB`;
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

  status.textContent = "Processing…";
  resetProgress();
  convertBtn.disabled = true;
  // Обновляем длительность клипа перед отправкой
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
  durationSlider.max = Math.ceil(totalDuration);
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

offsetSlider.addEventListener("input", () => {
    $("#offOut").textContent = offsetSlider.value;
});

sizeSlider.addEventListener("input", () => {
    $("#sizeOut").textContent = sizeSlider.value;
});

// --- WebSocket Logic ---

const sio = io({ transports: ["websocket"], autoConnect: true });

sio.on("connect", () => console.log("Socket.IO connected!"));

sio.on("progress", d => {
  if (d.job !== currentJobId) return;
  // ИЗМЕНЕНИЕ: Теперь расчет корректный (миллисекунды / миллисекунды)
  const progressValue = d.ms / (clipSec * 1000);
  updatePct(progressValue);
});

sio.on("status_update", d => {
    if (d.job !== currentJobId) return;
    status.textContent = d.status;
});

sio.on("done", d => {
  if (d.job !== currentJobId) return;
  updatePct(1); // Финальные 100%
  const tg = d.telegram ? " ↗️ sent to TG" : "";
  status.innerHTML = `Done — <a href="${d.download}" target="_blank">Download</a>${tg}`;
  convertBtn.disabled = false;
  sio.emit("leave", { job: d.job });
  currentJobId = null;
});

sio.on("connect_error", (err) => {
  console.error("Socket connection error:", err);
  status.textContent = "⚠️ WebSocket connection failed.";
});

// --- UI Helper Functions ---

function resetUI() {
  convertBtn.disabled = true;
  status.textContent = "";
  fileLbl.textContent = "Choose video…";
  resetProgress();
}

function resetProgress() {
  bar.value = 0;
  pctTxt.textContent = "0%";
}

function updatePct(v) {
  const clampedValue = Math.min(1, Math.max(0, v)); // Гарантируем, что значение в диапазоне [0, 1]
  bar.value = clampedValue;
  pctTxt.textContent = Math.round(clampedValue * 100) + "%";
}