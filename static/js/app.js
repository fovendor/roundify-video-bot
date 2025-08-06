const initApp = () => {
  // --- Константы и Настройки ---
  const MAX_CLIP_SECONDS = 60;

  // --- DOM элементы ---
  const fileInput = document.getElementById('fileInput');
  const touchMeContainer = document.getElementById('touchMeContainer');
  const playerWrapper = document.getElementById('playerWrapper');
  const videoPreview = document.getElementById('videoPreview');
  const videoOverlay = document.getElementById('videoOverlay');
  const deleteButton = document.getElementById('deleteButton');
  const convertButton = document.getElementById('convertButton');

  // Элементы управления
  const scrubberHandle = document.getElementById('scrubberHandle');
  const scrubberProgress = document.getElementById('scrubberProgress');
  let scrubberPathLength = 0;
  if (scrubberProgress) {
    scrubberPathLength = scrubberProgress.getTotalLength();
    scrubberProgress.style.strokeDasharray = scrubberPathLength;
    scrubberProgress.style.strokeDashoffset = scrubberPathLength;
  }
  const durationSliderEl = document.getElementById('durationSlider');
  const durationValueLabel = document.getElementById('durationValueLabel');
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeOut = document.getElementById('sizeOut');

  if (!fileInput || !scrubberHandle || !durationSliderEl) {
    console.error('Критическая ошибка: один или несколько HTML-элементов не найдены.');
    return;
  }

  // --- Переменные состояния ---
  let videoFile = null;
  let videoObjectURL = null;
  let durationSlider = null;
  let isScrubbing = false;

  // --- Хелперы ---

  const formatTime = (seconds) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const updateRangeFill = (slider) => {
    const min = slider.min || 0;
    const max = slider.max || 100;
    const value = slider.value;
    const percentage = ((value - min) / (max - min)) * 100;
    const sliderColor = '#606680';
    slider.style.background = `(to right, ${sliderColor} ${percentage}%, #E0E1E6 ${percentage}%)`;
  };

  /** [ИЗМЕНЕНИЕ] Новая, точная математика для позиционирования дотика на дуге */
  const updateScrubberHandle = (time, duration) => {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) return;

    const progress = Math.max(0, Math.min(1, time / duration));
    const angle = -75 + (progress * 330);

    const x = 100 + 90 * Math.cos(angle * Math.PI / 180);
    const y = 100 + 90 * Math.sin(angle * Math.PI / 180);

    scrubberHandle.setAttribute('cx', x);
    scrubberHandle.setAttribute('cy', y);

    // Теперь точно!
    const dashOffset = scrubberPathLength * (1 - progress);
    scrubberProgress.style.strokeDashoffset = dashOffset;
  };

  // --- Функции переключения UI ---
  const showPlayer = () => {
    touchMeContainer.classList.add('hidden');
    playerWrapper.classList.remove('hidden');
  };

  const showUploader = () => {
    if (videoObjectURL) URL.revokeObjectURL(videoObjectURL);
    if (durationSlider) durationSlider.destroy();

    videoPreview.src = '';
    videoObjectURL = null;
    videoFile = null;
    fileInput.value = '';
    durationSlider = null;

    sizeSlider.value = 640;
    sizeOut.textContent = sizeSlider.value;
    updateRangeFill(sizeSlider);

    convertButton.disabled = true;
    playerWrapper.classList.add('hidden');
    touchMeContainer.classList.remove('hidden');
  };

  // --- Инициализация элементов управления ---

  const initDurationSlider = (videoDuration) => {
    const start = 0;
    const end = Math.min(videoDuration, MAX_CLIP_SECONDS);

    if (durationSlider) durationSlider.destroy();

    durationSlider = noUiSlider.create(durationSliderEl, {
      start: [start, end],
      connect: true,
      range: { min: 0, max: videoDuration },
      limit: MAX_CLIP_SECONDS,
      behaviour: 'drag',
      tooltips: {
        to: (value) => formatTime(value),
        from: (value) => value
      }
    });

    durationSlider.on('update', (values) => {
      const clipDuration = values[1] - values[0];
      durationValueLabel.textContent = `${clipDuration.toFixed(1)} сек`;
    });
  };

  // --- Обработчики событий ---

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('video/')) {
      videoFile = file;
      videoObjectURL = URL.createObjectURL(videoFile);
      videoPreview.src = videoObjectURL;
      videoPreview.load();
    }
  });

  videoPreview.addEventListener('loadedmetadata', () => {
    showPlayer();
    videoPreview.muted = false;
    videoOverlay.classList.remove('hidden');
    updateScrubberHandle(0, videoPreview.duration);
    initDurationSlider(videoPreview.duration);
    convertButton.disabled = false;
  });

  videoPreview.addEventListener('timeupdate', () => {
    if (!isScrubbing) {
      updateScrubberHandle(videoPreview.currentTime, videoPreview.duration);
    }
  });

  videoPreview.addEventListener('click', () => {
    videoPreview.paused ? videoPreview.play() : videoPreview.pause();
  });

  videoPreview.addEventListener('play', () => videoOverlay.classList.add('hidden'));
  videoPreview.addEventListener('pause', () => videoOverlay.classList.remove('hidden'));

  deleteButton.addEventListener('click', showUploader);

  sizeSlider.addEventListener('input', () => {
    sizeOut.textContent = sizeSlider.value;
    updateRangeFill(sizeSlider);
  });


  // --- Логика кругового скраббера ---

  const handleScrub = (event) => {
    event.preventDefault();
    const rect = videoPreview.closest('.video-container').getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let clientX, clientY;
    if (event.touches) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    // [ИЗМЕНЕНИЕ] Новая, точная математика для определения прогресса по клику
    let angleDeg = Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI;

    // Сдвигаем систему координат так, чтобы начало дуги (-75deg) стало 0
    let normalizedAngle = angleDeg + 75;
    if (normalizedAngle < 0) {
      normalizedAngle += 360;
    }

    // Определяем, находится ли клик в "мертвой зоне" (разрыве)
    const deadZoneStart = 330; // Конец нашей дуги
    if (normalizedAngle > deadZoneStart) {
      // Если клик в мертвой зоне, определяем, к какому концу дуги он ближе
      const distToStart = normalizedAngle - deadZoneStart; // Расстояние до начала разрыва
      const distToEnd = 360 - normalizedAngle; // Расстояние до конца разрыва
      if (distToStart < distToEnd) {
        normalizedAngle = 330; // Ближе к концу дуги
      } else {
        normalizedAngle = 0; // Ближе к началу дуги
      }
    }

    const progress = normalizedAngle / 330;
    const newTime = progress * videoPreview.duration;

    videoPreview.currentTime = newTime;
    updateScrubberHandle(newTime, videoPreview.duration);
  };

  const startScrubbing = (event) => {
    isScrubbing = true;
    videoPreview.pause();
    handleScrub(event);
    document.addEventListener('mousemove', handleScrub);
    document.addEventListener('touchmove', handleScrub);
    document.addEventListener('mouseup', stopScrubbing);
    document.addEventListener('touchend', stopScrubbing);
    document.addEventListener('mouseleave', stopScrubbing);
  };

  const stopScrubbing = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    document.removeEventListener('mousemove', handleScrub);
    document.removeEventListener('touchmove', handleScrub);
    document.removeEventListener('mouseup', stopScrubbing);
    document.removeEventListener('touchend', stopScrubbing);
    document.removeEventListener('mouseleave', stopScrubbing);
  };

  scrubberHandle.addEventListener('mousedown', startScrubbing);
  scrubberHandle.addEventListener('touchstart', startScrubbing);

  // --- Первоначальная инициализация ---
  showUploader();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}