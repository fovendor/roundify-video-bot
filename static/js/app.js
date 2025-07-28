/* mini‑$ selector */
const $ = s => document.querySelector(s);

/* DOM references */
const fileInp = $("#file"),
      fileLbl = $("#fileLabel"),
      chevBtn = $("#chevron"),
      advBlk  = $("#advanced"),
      convert = $("#convert"),
      status  = $("#status");

/* filename preview */
fileInp.addEventListener("change", () =>
  fileLbl.textContent = fileInp.files[0]?.name || "Выберите видео…"
);

/* show / hide advanced block */
chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk .classList.toggle("open");
});

/* range‑output binding */
const bindRange = (inp, out) => {
  const i=$(inp), o=$(out);
  i.addEventListener("input", () => o.textContent = i.value);
};
bindRange("#size",    "#sizeOut");
bindRange("#duration","#durOut");
bindRange("#offset",  "#offOut");

/* countdown */
function startCountdown(sec){
  const ttl = document.createElement("span");
  ttl.id = "ttl";
  ttl.textContent = ` ⏳ ${sec}s`;
  status.appendChild(ttl);

  const t = setInterval(()=>{
    sec--;
    if(sec<=0){
      clearInterval(t);
      ttl.textContent = " 🗑 deleted";
      $("#dl-btn")?.remove();
    }else{
      ttl.textContent = ` ⏳ ${sec}s`;
    }
  },1000);
}

/* convert handler */
convert.addEventListener("click", async () => {
  if(!fileInp.files[0]){
    status.textContent = "Сначала выберите файл."; return;
  }
  status.textContent = "Обработка…";

  const fd = new FormData();
  fd.append("video", fileInp.files[0]);
  fd.append("size", $("#size").value);
  fd.append("duration", $("#duration").value);
  fd.append("offset", $("#offset").value);
  if($("#token").value) fd.append("token", $("#token").value);
  if($("#chat").value)  fd.append("chat",  $("#chat").value);

  try{
    const r = await fetch("/api/convert", { method:"POST", body:fd });
    const j = await r.json();
    if(!r.ok) throw new Error(j.error || r.statusText);

    status.innerHTML = j.sent
      ? "Отправлено в Telegram. "
      : "Готово. ";

    const link = document.createElement("a");
    link.href = j.download;
    link.id   = "dl-btn";
    link.textContent = "Скачать";
    status.appendChild(link);

    if(j.expires_in) startCountdown(j.expires_in);

  }catch(e){
    status.textContent = "⚠️ " + e.message;
  }
});
