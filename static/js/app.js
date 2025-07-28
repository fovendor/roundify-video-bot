const $ = s => document.querySelector(s);

const fileInp = $("#file"),
      fileLbl = $("#fileLabel"),
      chevBtn = $("#chevron"),
      advBlk  = $("#advanced"),
      convert = $("#convert"),
      status  = $("#status");

/* имя выбранного файла */
fileInp.addEventListener("change", () =>
  fileLbl.textContent = fileInp.files[0]?.name || "Выберите видео…"
);

/* раскрыть/свернуть параметры */
chevBtn.addEventListener("click", () => {
  chevBtn.classList.toggle("open");
  advBlk .classList.toggle("open");
});

/* range → output */
const bindRange = (inpId, outId) => {
  const i=$(inpId), o=$(outId);
  i.addEventListener("input", () => o.textContent = i.value);
};
bindRange("#size",   "#sizeOut");
bindRange("#duration","#durOut");
bindRange("#offset", "#offOut");

/* отправка */
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

    let msg = j.sent ? "Отправлено в Telegram." : "Готово.";
    msg += ` <a href="${j.download}"> Cкачать</a>`;
    status.innerHTML = msg;
  }catch(e){
    status.textContent = "⚠️ " + e.message;
  }
});
