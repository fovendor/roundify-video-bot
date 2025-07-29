/* mini‑$ selector */ const $ = s => document.querySelector(s);
const fileInp = $("#file"), fileLbl = $("#fileLabel"), chevBtn = $("#chevron"),
  advBlk = $("#advanced"), convert = $("#convert"), status = $("#status"),
  bar = $("#bar"), pctTxt = $("#pct");

fileInp.addEventListener("change",
  () => fileLbl.textContent = fileInp.files[0]?.name || "Choose video…");

chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk.classList.toggle("open");
});

const bindRange = (inp, out) => {
  const i = $(inp), o = $(out);
  i.addEventListener("input", () => o.textContent = i.value);
};
bindRange("#size", "#sizeOut"); bindRange("#duration", "#durOut"); bindRange("#offset", "#offOut");

/* NEW → force pure WebSocket, no polling fallback */
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
    let clipSec = $("#duration").value;

    sio.on("metadata", d => {
      if (d.job !== job_id) return;
      $("#duration").max = Math.ceil(d.duration);
      clipSec = $("#duration").value;
    });
    sio.on("progress", d => {
      if (d.job !== job_id) return;
      updatePct(d.ms / (clipSec * 1000));
    });
    sio.on("done", d => {
      if (d.job !== job_id) return;
      updatePct(1);
      status.innerHTML = `Done — <a href="${d.download}">Download</a>`;
      sio.emit("leave", { job: job_id });
    });

    status.textContent = "Processing…";

  } catch (e) { status.textContent = "⚠️ " + e.message; }
});
