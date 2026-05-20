(function () {
  "use strict";

  const MODES = {
    focus: {
      label: "专注",
      ready: "准备开始专注",
      running: "保持专注",
      paused: "专注已暂停",
      setting: "focusMinutes",
    },
    shortBreak: {
      label: "短休",
      ready: "准备短休",
      running: "放松一下",
      paused: "短休已暂停",
      setting: "shortBreakMinutes",
    },
    longBreak: {
      label: "长休",
      ready: "准备长休",
      running: "好好恢复",
      paused: "长休已暂停",
      setting: "longBreakMinutes",
    },
  };

  const DEFAULT_SETTINGS = {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakInterval: 4,
  };

  const STORAGE_KEYS = {
    settings: "pomodoro.settings.v2",
    stats: "pomodoro.stats.v2",
    task: "pomodoro.task.v1",
  };

  const root = document.querySelector(".app-shell");
  const timeText = document.querySelector("#timeText");
  const statusText = document.querySelector("#statusText");
  const subStatusText = document.querySelector("#subStatusText");
  const startPauseButton = document.querySelector("#startPauseButton");
  const startPauseText = document.querySelector("#startPauseText");
  const resetButton = document.querySelector("#resetButton");
  const skipButton = document.querySelector("#skipButton");
  const roundText = document.querySelector("#roundText");
  const nextText = document.querySelector("#nextText");
  const roundDots = document.querySelector("#roundDots");
  const modeMeta = document.querySelector("#modeMeta");
  const rhythmMeta = document.querySelector("#rhythmMeta");
  const cycleMeta = document.querySelector("#cycleMeta");
  const settingsForm = document.querySelector("#settingsForm");
  const settingsNote = document.querySelector("#settingsNote");
  const taskInput = document.querySelector("#taskInput");
  const todayCountBadge = document.querySelector("#todayCountBadge");
  const todayCountText = document.querySelector("#todayCountText");
  const todayMinutesText = document.querySelector("#todayMinutesText");
  const clearStatsButton = document.querySelector("#clearStatsButton");
  const modeTabs = Array.from(document.querySelectorAll("[data-mode-target]"));

  const settingsInputs = {
    focusMinutes: document.querySelector("#focusMinutes"),
    shortBreakMinutes: document.querySelector("#shortBreakMinutes"),
    longBreakMinutes: document.querySelector("#longBreakMinutes"),
    longBreakInterval: document.querySelector("#longBreakInterval"),
  };

  let settings = loadSettings();
  let stats = loadStats();
  let mode = "focus";
  let state = "idle";
  let remainingMs = getModeDuration(mode);
  let endAt = 0;
  let intervalId = 0;
  let audioContext = null;

  initialize();

  function initialize() {
    fillSettingsForm();
    resetDailyStatsIfNeeded();
    taskInput.value = loadTask();
    bindEvents();
    render();
  }

  function bindEvents() {
    startPauseButton.addEventListener("click", toggleStartPause);
    resetButton.addEventListener("click", resetTimer);
    skipButton.addEventListener("click", skipCurrentMode);
    clearStatsButton.addEventListener("click", clearTodayStats);
    taskInput.addEventListener("input", saveTask);

    modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        switchMode(tab.dataset.modeTarget, true);
      });
    });

    settingsForm.addEventListener("input", handleSettingsInput);

    document.addEventListener("visibilitychange", () => {
      if (state === "running") {
        tick();
      }
    });
  }

  function toggleStartPause() {
    ensureAudioContext();

    if (state === "running") {
      pauseTimer();
      return;
    }

    startTimer();
  }

  function startTimer() {
    state = "running";
    endAt = Date.now() + remainingMs;
    clearInterval(intervalId);
    intervalId = window.setInterval(tick, 250);
    tick();
  }

  function pauseTimer() {
    remainingMs = Math.max(0, endAt - Date.now());
    state = "paused";
    clearInterval(intervalId);
    render();
  }

  function resetTimer() {
    state = "idle";
    clearInterval(intervalId);
    remainingMs = getModeDuration(mode);
    render();
  }

  function skipCurrentMode() {
    completeMode(false, false);
  }

  function tick() {
    remainingMs = Math.max(0, endAt - Date.now());

    if (remainingMs <= 0) {
      completeMode(true, true);
      return;
    }

    render();
  }

  function completeMode(playSound, countCompletion) {
    clearInterval(intervalId);
    state = "idle";

    if (playSound) {
      playChime();
    }

    if (mode === "focus") {
      if (countCompletion) {
        stats.todayCount += 1;
        stats.todayFocusMinutes += settings.focusMinutes;
        stats.completedInSet += 1;
        stats.date = getTodayKey();
        saveStats();
      }

      switchMode(stats.completedInSet >= settings.longBreakInterval ? "longBreak" : "shortBreak", false);
      return;
    }

    if (mode === "longBreak") {
      stats.completedInSet = 0;
      saveStats();
    }

    switchMode("focus", false);
  }

  function switchMode(nextMode, manual) {
    mode = nextMode;
    root.dataset.mode = mode;
    state = "idle";
    clearInterval(intervalId);
    remainingMs = getModeDuration(mode);

    if (manual) {
      document.title = "七个番茄钟";
    }

    render();
  }

  function handleSettingsInput(event) {
    const input = event.target;

    if (!(input instanceof HTMLInputElement) || !input.name) {
      return;
    }

    const fallback = DEFAULT_SETTINGS[input.name];
    const min = Number(input.min);
    const max = Number(input.max);
    const parsed = Number.parseInt(input.value, 10);
    const value = Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;

    settings[input.name] = value;
    input.value = String(value);
    stats.completedInSet = clamp(stats.completedInSet, 0, settings.longBreakInterval);
    saveSettings();
    saveStats();

    if (state !== "running") {
      remainingMs = getModeDuration(mode);
    }

    showSavedNote();
    render();
  }

  function clearTodayStats() {
    stats = createEmptyStats();
    saveStats();
    render();
  }

  function render() {
    const seconds = Math.ceil(remainingMs / 1000);
    const display = formatTime(seconds);

    timeText.textContent = display;
    timeText.dateTime = `PT${seconds}S`;
    statusText.textContent = getStatusText();
    subStatusText.textContent = getSubStatusText();
    startPauseText.textContent = state === "running" ? "暂停" : state === "paused" ? "继续" : "开始";
    startPauseButton.querySelector(".button-icon").textContent = state === "running" ? "Ⅱ" : "▶";
    root.style.setProperty("--progress", String(getProgress()));

    renderTabs();
    renderRounds();
    renderMeta();
    renderStats();
    renderDocumentTitle(display);
  }

  function renderTabs() {
    modeTabs.forEach((tab) => {
      const isActive = tab.dataset.modeTarget === mode;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
  }

  function renderRounds() {
    const interval = settings.longBreakInterval;
    const currentRound = Math.min(stats.completedInSet + 1, interval);
    const isFocus = mode === "focus";
    const nextMode = stats.completedInSet + 1 >= interval ? "长休" : "短休";

    roundText.textContent = isFocus ? `第 ${currentRound} / ${interval} 轮` : `已完成 ${stats.completedInSet} / ${interval} 轮`;
    nextText.textContent = isFocus ? `完成后进入${nextMode}` : "休息后回到专注";
    roundDots.style.setProperty("--dot-count", String(interval));
    roundDots.innerHTML = "";

    for (let index = 0; index < interval; index += 1) {
      const dot = document.createElement("span");
      dot.className = "round-dot";

      if (index < stats.completedInSet) {
        dot.classList.add("is-done");
      } else if (isFocus && index === stats.completedInSet) {
        dot.classList.add("is-current");
      }

      roundDots.append(dot);
    }
  }

  function renderMeta() {
    const interval = settings.longBreakInterval;
    const currentRound = Math.min(stats.completedInSet + 1, interval);

    modeMeta.textContent = MODES[mode].label;
    rhythmMeta.textContent = `${settings.focusMinutes} / ${settings.shortBreakMinutes} / ${settings.longBreakMinutes}`;
    cycleMeta.textContent = mode === "focus" ? `${currentRound} / ${interval}` : `${stats.completedInSet} / ${interval}`;
  }

  function renderStats() {
    todayCountBadge.textContent = String(stats.todayCount);
    todayCountText.textContent = String(stats.todayCount);
    todayMinutesText.textContent = `${stats.todayFocusMinutes} 分钟`;
  }

  function renderDocumentTitle(display) {
    document.title = state === "running" ? `${display} - ${MODES[mode].label}` : "七个番茄钟";
  }

  function getStatusText() {
    const task = taskInput.value.trim();

    if (mode === "focus" && state === "running" && task) {
      return `正在推进：${task}`;
    }

    if (state === "running") {
      return MODES[mode].running;
    }

    if (state === "paused") {
      return MODES[mode].paused;
    }

    return MODES[mode].ready;
  }

  function getSubStatusText() {
    if (mode !== "focus") {
      return "休息结束后回到专注";
    }

    return stats.completedInSet + 1 >= settings.longBreakInterval ? "完成后进入长休" : "完成后进入短休";
  }

  function getModeDuration(targetMode) {
    return settings[MODES[targetMode].setting] * 60 * 1000;
  }

  function getProgress() {
    const totalMs = getModeDuration(mode);

    if (totalMs <= 0) {
      return 0;
    }

    return clamp(1 - remainingMs / totalMs, 0, 1);
  }

  function fillSettingsForm() {
    Object.entries(settingsInputs).forEach(([key, input]) => {
      input.value = String(settings[key]);
    });
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings));
      return sanitizeSettings({ ...DEFAULT_SETTINGS, ...saved });
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }

  function sanitizeSettings(nextSettings) {
    return {
      focusMinutes: clamp(toInt(nextSettings.focusMinutes, 25), 1, 180),
      shortBreakMinutes: clamp(toInt(nextSettings.shortBreakMinutes, 5), 1, 60),
      longBreakMinutes: clamp(toInt(nextSettings.longBreakMinutes, 15), 1, 120),
      longBreakInterval: clamp(toInt(nextSettings.longBreakInterval, 4), 2, 12),
    };
  }

  function loadStats() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.stats));
      return sanitizeStats(saved);
    } catch {
      return createEmptyStats();
    }
  }

  function saveStats() {
    localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
  }

  function sanitizeStats(nextStats) {
    const today = getTodayKey();

    if (!nextStats || nextStats.date !== today) {
      return createEmptyStats();
    }

    return {
      date: today,
      todayCount: Math.max(0, toInt(nextStats.todayCount, 0)),
      todayFocusMinutes: Math.max(0, toInt(nextStats.todayFocusMinutes, 0)),
      completedInSet: clamp(toInt(nextStats.completedInSet, 0), 0, settings.longBreakInterval),
    };
  }

  function resetDailyStatsIfNeeded() {
    if (stats.date !== getTodayKey()) {
      stats = createEmptyStats();
      saveStats();
    }
  }

  function createEmptyStats() {
    return {
      date: getTodayKey(),
      todayCount: 0,
      todayFocusMinutes: 0,
      completedInSet: 0,
    };
  }

  function loadTask() {
    return localStorage.getItem(STORAGE_KEYS.task) || "";
  }

  function saveTask() {
    localStorage.setItem(STORAGE_KEYS.task, taskInput.value.trim());
    render();
  }

  function showSavedNote() {
    settingsNote.textContent = "已保存";
    window.clearTimeout(showSavedNote.timeoutId);
    showSavedNote.timeoutId = window.setTimeout(() => {
      settingsNote.textContent = "自动保存";
    }, 1200);
  }

  function ensureAudioContext() {
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

      if (AudioContextConstructor) {
        audioContext = new AudioContextConstructor();
      }
    }

    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }

  function playChime() {
    if (!audioContext) {
      return;
    }

    const now = audioContext.currentTime;

    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * 0.11;

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getTodayKey() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
})();
