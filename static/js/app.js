// static/js/app.js

const initWebSocket = (jobId, options) => {
  const convertButton = document.getElementById('convertButton');
  const convertBtnLabel = document.getElementById('convertBtnLabel');
  const btnLoader = document.getElementById('btnLoader');

  const wsUrl = `${location.protocol === 'https' ? 'wss' : 'ws'}://${location.host}/ws/${jobId}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connection established.');
    ws.send(JSON.stringify({ type: 'start_conversion', options }));
    convertBtnLabel.textContent = 'ОБРАБОТКА...';
    btnLoader.classList.remove('hidden');
    convertButton.disabled = true;
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Message from server:', data);

    switch (data.type) {
      case 'queued':
        convertBtnLabel.textContent = `В ОЧЕРЕДИ (${data.position})`;
        break;
      case 'status_update':
        convertBtnLabel.textContent = data.status.toUpperCase();
        break;
      case 'progress':
        const clipDuration = options.clip_sec * 1000;
        const percent = Math.round((data.ms / clipDuration) * 100);
        convertBtnLabel.textContent = `ОБРАБОТКА... ${percent}%`;
        break;
      case 'done':
        if (data.telegram) {
          convertBtnLabel.textContent = 'УСПЕШНО ОТПРАВЛЕНО!';
        } else {
          convertBtnLabel.textContent = 'ГОТОВО (НЕ ОТПРАВЛЕНО)';
        }
        setTimeout(() => {
          convertButton.disabled = false;
          btnLoader.classList.add('hidden');
          convertBtnLabel.textContent = 'ОТПРАВИТЬ';
        }, 2000);
        break;
      case 'error':
        convertBtnLabel.textContent = 'ОШИБКА!';
        console.error('Server error:', data.message);
        alert(`Произошла ошибка: ${data.message}`);
        setTimeout(() => {
          convertButton.disabled = false;
          btnLoader.classList.add('hidden');
          convertBtnLabel.textContent = 'ОТПРАВИТЬ';
        }, 3000);
        break;
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
    convertBtnLabel.textContent = 'ОШИБКА СОЕДИНЕНИЯ';
    alert('Не удалось установить соединение с сервером.');
    btnLoader.classList.add('hidden');
    convertButton.disabled = false;
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed.');
  };
};


const initApp = () => {
  /* ─── Константы ───────────────────────────────────────────── */
  const MAX_CLIP_SECONDS = 60;
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const SCALE_SENSITIVITY = 0.005;
  const SLIDER_ZOOM_WINDOW_SECONDS = 120;
  const TOOLTIP_MERGE_DISTANCE = 50;
  const SCRUBBER_RADIUS = 90;

  /* ─── DOM-элементы ────────────────────────────────────────── */
  const uploadScreen = document.getElementById('uploadScreen');
  const playerScreen = document.getElementById('playerScreen');

  const fileInput = document.getElementById('fileInput');
  const touchMeText = document.getElementById('touchMeText'); // <-- НОВЫЙ ЭЛЕМЕНТ
  const videoPreview = document.getElementById('videoPreview');
  const videoOverlay = document.getElementById('videoOverlay');

  const moveButton = document.getElementById('moveButton');
  const resizeButton = document.getElementById('resizeButton');
  const currentTime = document.getElementById('currentTime');
  const deleteButton = document.getElementById('deleteButton');

  const scrubberHandle = document.getElementById('scrubberHandle');
  const scrubberProgress = document.getElementById('scrubberProgress');
  let scrubberPathLength = 0;
  if (scrubberProgress) {
    scrubberPathLength = scrubberProgress.getTotalLength();
    scrubberProgress.style.strokeDasharray = scrubberPathLength;
    scrubberProgress.style.strokeDashoffset = scrubberPathLength;
  }

  const durationSliderEl = document.getElementById('durationSlider');
  const combinedTooltip = document.getElementById('combinedTooltip');
  const durationValueLabel = document.getElementById('durationValueLabel');

  const sizeSlider = document.getElementById('sizeSlider');
  const sizeOut = document.getElementById('sizeOut');
  const convertButton = document.getElementById('convertButton');
  const chatInput = document.getElementById('chat');
  
  const convertBtnLabel = document.getElementById('convertBtnLabel');
  const btnLoader = document.getElementById('btnLoader');

  /* ─── Состояние ───────────────────────────────────────────── */
  let videoFile = null;
  let videoObjectURL = null;
  let videoMetadata = {};
  let durationSlider = null;
  let isScrubbing = false, isResizing = false, isMoving = false;
  let scale = 1, offsetX = 0, offsetY = 0;
  let startX = 0, startY = 0;
  let startScale = 1, startMoveX = 0, startMoveY = 0;

  /* ─── Хелперы ─────────────────────────────────────────────── */
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const applyTransform = () => {
    videoPreview.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };

  const updateScrubberAppearance = () => {
    if (!scrubberProgress) return;
    const svg = scrubberProgress.ownerSVGElement;
    const bgTrack = svg.querySelector('.scrubber-track-bg');
    const currentWidth = svg.getBoundingClientRect().width;
    const viewBoxWidth = svg.viewBox.baseVal.width;

    if (currentWidth === 0 || viewBoxWidth === 0) return;

    const scaleFactor = currentWidth / viewBoxWidth;

    const targetStrokeWidth = 8;
    const targetHandleRadius = 11;

    const newStrokeWidth = targetStrokeWidth / scaleFactor;
    const newHandleRadius = targetHandleRadius / scaleFactor;

    scrubberProgress.style.strokeWidth = newStrokeWidth;
    bgTrack.style.strokeWidth = newStrokeWidth;
    scrubberHandle.setAttribute('r', newHandleRadius);
  };

  const updateScrubberHandle = (time, duration) => {
    if (!scrubberProgress || !Number.isFinite(duration) || duration <= 0) return;
    const progress = clamp(time / duration, 0, 1);

    scrubberProgress.style.strokeDashoffset = scrubberPathLength * (1 - progress);

    const point = scrubberProgress.getPointAtLength(progress * scrubberPathLength);
    scrubberHandle.setAttribute('cx', point.x);
    scrubberHandle.setAttribute('cy', point.y);
  };

  /* ─── Переключение экранов ───────────────────────────────── */
  const showPlayer = () => {
    uploadScreen.classList.add('hidden');
    playerScreen.classList.remove('hidden');
  };

  const showUploader = () => {
    if (videoObjectURL) URL.revokeObjectURL(videoObjectURL);
    if (durationSlider) durationSlider.destroy();

    videoPreview.src = '';
    videoObjectURL = null;
    videoFile = null;
    videoMetadata = {};
    fileInput.value = '';
    durationSlider = null;

    scale = 1; offsetX = 0; offsetY = 0; applyTransform();
    sizeSlider.value = 640;
    sizeOut.textContent = sizeSlider.value;

    convertButton.disabled = true;
    convertBtnLabel.textContent = 'ОТПРАВИТЬ';
    btnLoader.classList.add('hidden');
    touchMeText.textContent = 'Touch Me';

    playerScreen.classList.add('hidden');
    uploadScreen.classList.remove('hidden');
    currentTime.textContent = '00:00';
  };

  const updateCombinedTooltip = (values, handle, unencoded, tap, positions) => {
    const handles = durationSlider.target.querySelectorAll('.noUi-handle');
    if (handles.length < 2) return;
    const distance = positions[1] - positions[0];
    if (distance < TOOLTIP_MERGE_DISTANCE) {
      combinedTooltip.classList.remove('hidden');
      combinedTooltip.innerHTML = `${formatTime(values[0])} &mdash; ${formatTime(values[1])}`;
      const sliderRect = durationSlider.target.getBoundingClientRect();
      const midpoint = (handles[0].getBoundingClientRect().left + handles[1].getBoundingClientRect().right) / 2;
      combinedTooltip.style.left = `${midpoint - sliderRect.left}px`;
    } else {
      combinedTooltip.classList.add('hidden');
    }
  };

  const initDurationSlider = (videoDuration) => {
    const start = 0;
    const end = Math.min(videoDuration, MAX_CLIP_SECONDS);
    const initialRangeMax = Math.min(videoDuration, SLIDER_ZOOM_WINDOW_SECONDS);

    if (durationSlider) durationSlider.destroy();

    durationSlider = noUiSlider.create(durationSliderEl, {
      start: [start, end],
      connect: true,
      range: { min: 0, max: initialRangeMax },
      limit: MAX_CLIP_SECONDS,
      behaviour: 'drag-tap',
      tooltips: { to: formatTime, from: Number },
    });

    durationSlider.on('update', (values, handle, unencoded, tap, positions) => {
      const clipDur = values[1] - values[0];
      durationValueLabel.textContent = `${clipDur.toFixed(1)} сек`;
      if (handle === 0) videoPreview.currentTime = values[0];
      updateCombinedTooltip(values, handle, unencoded, tap, positions);
    });

    durationSlider.on('tap', () => {
      const clickedValue = Number(durationSlider.get(true));
      if (videoPreview.duration > SLIDER_ZOOM_WINDOW_SECONDS) {
        updateSliderZoom(clickedValue);
      }
    });

    durationSlider.set(durationSlider.get());
  };

  const updateSliderZoom = (centerTime) => {
    const halfWindow = SLIDER_ZOOM_WINDOW_SECONDS / 2;
    let newRangeMin = Math.max(0, centerTime - halfWindow);
    let newRangeMax = newRangeMin + SLIDER_ZOOM_WINDOW_SECONDS;

    if (newRangeMax > videoPreview.duration) {
      newRangeMax = videoPreview.duration;
      newRangeMin = Math.max(0, newRangeMax - SLIDER_ZOOM_WINDOW_SECONDS);
    }

    const currentSelection = durationSlider.get().map(Number);
    const clipLength = currentSelection[1] - currentSelection[0];

    durationSlider.updateOptions({
      range: { min: newRangeMin, max: newRangeMax }
    }, false);

    const newStart = clamp(centerTime, newRangeMin, newRangeMax - clipLength);
    durationSlider.set([newStart, newStart + clipLength]);
  };

  /* ─── Загрузка и управление видео ─────────────────────────── */
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('video/')) return;
    videoFile = file;

    const formData = new FormData();
    formData.append('video', videoFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        // ОБНОВЛЯЕМ ТЕКСТ В КРУГЕ "TOUCH ME"
        touchMeText.textContent = `Загрузка ${percentComplete}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        videoMetadata = JSON.parse(xhr.responseText);
        videoObjectURL = URL.createObjectURL(videoFile);
        videoPreview.src = videoObjectURL;
        videoPreview.load();
      } else {
        try {
            const errorData = JSON.parse(xhr.responseText);
            handleUploadError(errorData.detail || `HTTP error! status: ${xhr.status}`);
        } catch {
            handleUploadError(`HTTP error! status: ${xhr.status}`);
        }
      }
    };

    xhr.onerror = () => {
      handleUploadError('Ошибка сети при загрузке файла.');
    };
    
    const handleUploadError = (message) => {
        console.error('Upload failed:', message);
        alert(`Не удалось загрузить видео: ${message}`);
        showUploader(); // showUploader сбросит текст на "Touch Me"
    };

    xhr.send(formData);
  });


  videoPreview.addEventListener('loadedmetadata', () => {
    showPlayer(); // Переключаем экран
    initDurationSlider(videoPreview.duration);
    convertButton.disabled = false; // Разрешаем нажимать кнопку отправки
    applyTransform();
    updateScrubberHandle(0, videoPreview.duration);
    updateScrubberAppearance();
  });

  videoPreview.addEventListener('timeupdate', () => {
    const time = videoPreview.currentTime;
    if (!isScrubbing) {
      currentTime.textContent = formatTime(time);
      updateScrubberHandle(time, videoPreview.duration);
    }
  });

  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });
  videoPreview.addEventListener('play', () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  /* ─── ЛОГИКА КРУГОВОГО СКРАББЕРА --- */
  const startScrub = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    moveScrub(event);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('touchmove', moveScrub, { passive: false });
    document.addEventListener('mouseup', endScrub);
    document.addEventListener('touchend', endScrub);
    document.addEventListener('mouseleave', endScrub);
  };

  const moveScrub = (event) => {
    event.preventDefault();
    const svgRect = scrubberHandle.ownerSVGElement.getBoundingClientRect();
    const cx = svgRect.left + svgRect.width / 2;
    const cy = svgRect.top + svgRect.height / 2;

    const p = event.touches ? event.touches[0] : event;
    let angle = Math.atan2(p.clientY - cy, p.clientX - cx) * 180 / Math.PI;

    angle = (angle + 360 + 75) % 360;

    if (angle < 330) {
      const progress = angle / 330;
      const newTime = progress * videoPreview.duration;

      videoPreview.currentTime = newTime;
      updateScrubberHandle(newTime, videoPreview.duration);
      currentTime.textContent = formatTime(newTime);
    }
  };

  const endScrub = () => {
    isScrubbing = false;
    if (videoPreview.duration > SLIDER_ZOOM_WINDOW_SECONDS) {
      updateSliderZoom(videoPreview.currentTime);
    }
    document.removeEventListener('mousemove', moveScrub);
    document.removeEventListener('touchmove', moveScrub);
    document.removeEventListener('mouseup', endScrub);
    document.removeEventListener('touchend', endScrub);
    document.removeEventListener('mouseleave', endScrub);
  };

  scrubberHandle.addEventListener('mousedown', startScrub);
  scrubberHandle.addEventListener('touchstart', startScrub, { passive: false });

  /* ─── Зум и перемещение кадра ────────────────────────────── */
  const onResizeStart = (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    isResizing = true;
    startY = p.clientY;
    startScale = scale;
    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup', onResizeEnd);
  };

  const onResizeMove = (e) => {
    if (!isResizing) return;
    const p = e.touches ? e.touches[0] : e;
    const deltaY = p.clientY - startY;
    const newScale = clamp(startScale - deltaY * SCALE_SENSITIVITY, MIN_SCALE, MAX_SCALE);
    if (newScale !== scale) {
      scale = newScale;
      const videoRect = videoPreview.getBoundingClientRect();
      const maxOffsetX = (videoRect.width * scale - videoRect.width) / 2 / scale;
      const maxOffsetY = (videoRect.height * scale - videoRect.height) / 2 / scale;
      offsetX = clamp(offsetX, -maxOffsetX, maxOffsetX);
      offsetY = clamp(offsetY, -maxOffsetY, maxOffsetY);
      applyTransform();
    }
  };

  const onResizeEnd = () => {
    isResizing = false;
    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup', onResizeEnd);
  };

  resizeButton.addEventListener('pointerdown', onResizeStart);
  resizeButton.addEventListener('touchstart', onResizeStart, { passive: false });

  const onMoveStart = (e) => {
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    isMoving = true;
    startX = p.clientX;
    startY = p.clientY;
    startMoveX = offsetX;
    startMoveY = offsetY;
    document.body.style.cursor = 'move';
    document.addEventListener('pointermove', onMoveMove);
    document.addEventListener('pointerup', onMoveEnd);
  };

  const onMoveMove = (e) => {
    if (!isMoving) return;
    const p = e.touches ? e.touches[0] : e;
    const deltaX = p.clientX - startX;
    const deltaY = p.clientY - startY;
    
    const videoRect = videoPreview.getBoundingClientRect();
    const maxOffsetX = (videoRect.width * scale - videoRect.width) / 2 / scale;
    const maxOffsetY = (videoRect.height * scale - videoRect.height) / 2 / scale;
    
    offsetX = clamp(startMoveX + deltaX, -maxOffsetX, maxOffsetX);
    offsetY = clamp(startMoveY + deltaY, -maxOffsetY, maxOffsetY);
    applyTransform();
  };

  const onMoveEnd = () => {
    isMoving = false;
    document.body.style.cursor = 'default';
    document.removeEventListener('pointermove', onMoveMove);
    document.removeEventListener('pointerup', onMoveEnd);
  };

  moveButton.addEventListener('pointerdown', onMoveStart);
  moveButton.addEventListener('touchstart', onMoveStart, { passive: false });

  sizeSlider.addEventListener('input', () => {
    sizeOut.textContent = sizeSlider.value;
  });

  convertButton.addEventListener('click', () => {
    if (!videoMetadata.job_id) {
      alert('Нет активной сессии для видео. Пожалуйста, загрузите видео заново.');
      return;
    }
    
    if (!chatInput.value) {
      alert('Пожалуйста, укажите ID чата или название канала.');
      chatInput.focus();
      return;
    }

    const [start, end] = durationSlider.get().map(Number);
    const options = {
      offset: start,
      clip_sec: end - start,
      size: Number(sizeSlider.value),
      chat: chatInput.value,
      scale: scale,
      offsetX: offsetX,
      offsetY: offsetY,
      previewWidth: videoPreview.getBoundingClientRect().width,
      videoWidth: videoMetadata.width,
      videoHeight: videoMetadata.height,
    };
    
    initWebSocket(videoMetadata.job_id, options);
  });

  window.addEventListener('resize', updateScrubberAppearance);

  showUploader();
};

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', initApp)
  : initApp();