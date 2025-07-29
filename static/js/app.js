/* mini‑$ selector */ const $ = s => document.querySelector(s);

const fileInp = $("#file"), fileLbl = $("#fileLabel"), chevBtn = $("#chevron"),
  advBlk = $("#advanced"), convert = $("#convert"), status = $("#status"),
  bar = $("#bar"), pctTxt = $("#pct");

let clipSec = 60;      // актуальная длительность клипа

fileInp.addEventListener("change", async () => {
  fileLbl.textContent = fileInp.files[0]?.name || "Choose video…";
  if (!fileInp.files[0]) return;

  // ─── запрашиваем метаданные ───
  status.innerHTML = '<span class="loader"></span>Reading meta…';
  const fd = new FormData();
  fd.append("video", fileInp.files[0]);

  try {
    const r = await fetch("/api/meta", { method: "POST", body: fd });
    const meta = await r.json();
    if (!r.ok) throw new Error(meta.error || r.statusText);

    $("#duration").max = Math.ceil(meta.duration);
    $("#offset").max = Math.floor(meta.duration);
    clipSec = $("#duration").value;

    status.textContent =
      `Duration: ${meta.duration.toFixed(1)} s | ` +
      `Resolution: ${meta.width}×${meta.height} | ` +
      `Size: ${meta.size_mb.toFixed(2)} MB`;
  } catch (e) {
    status.textContent = "⚠️ " + e.message;
  }
});

chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk.classList.toggle("open");
});

const bindRange = (inp, out) => {
  const i = $(inp), o = $(out);
  i.addEventListener("input", () => {
    o.textContent = i.value;
    if (inp === "#duration") {
      clipSec = +i.value;
      $("#offset").max = Math.max(0, $("#duration").max - clipSec);
    }
  });
};
bindRange("#size", "#sizeOut");
bindRange("#duration", "#durOut");
bindRange("#offset", "#offOut");

/* force pure WebSocket */
const sio = io({ transports: ["websocket"] });

function resetProgress() { bar.value = 0; pctTxt.textContent = "0%"; }
function updatePct(v) { bar.value = v; pctTxt.textContent = Math.round(v * 100) + "%"; }

convert.addEventListener("click", async () => {
  if (!fileInp.files[0]) { status.textContent = "Select a file first."; return; }
  status.textContent = "Uploading…"; resetProgress();

  const fd = new FormData();
  fd.append("video", fileInp.files[0]);
  fd.append("size", $("#size").value);
  fd.append("duration", $("#duration").value);
  fd.append("offset", $("#offset").value);
  if ($("#token").value) fd.append("token", $("#token").value);
  if ($("#chat").value) fd.append("chat", $("#chat").value);

  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const { job_id, error } = await r.json();
    if (!r.ok) throw new Error(error || r.statusText);

    sio.emit("join", { job: job_id });

    sio.once("metadata", d => {              // пришло ещё раз, но не страшно
      if (d.job === job_id) clipSec = $("#duration").value;
    });

    sio.on("progress", d => {
      if (d.job !== job_id) return;
      updatePct(d.ms / (clipSec * 1000));
    });

    sio.once("done", d => {
      if (d.job !== job_id) return;
      updatePct(1);
      const tg = d.telegram ? " ↗️ sent&nbsp;to&nbsp;TG" : "";
      status.innerHTML = `Done — <a href="${d.download}">Download</a>${tg}`;
      sio.emit("leave", { job: job_id });
    });

    status.textContent = "Processing…";

  } catch (e) { status.textContent = "⚠️ " + e.message; }
});
