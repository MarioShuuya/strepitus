/**
 * Engine parameter controls + keyboard shortcuts.
 */

export interface ControlValues {
  rpm: number;
  running: boolean;
  dynoEnabled: boolean;
  dynoGain: number;
  dynoIntegralGain: number;
  dynoMode: number;
  dynoLoadTorque: number;
  dynoTargetPower: number;
  throttle: number;
  volume: number;
  muted: boolean;
  timeScale: number;
}

export function createControls(
  _container: HTMLElement,
  onChange: (values: ControlValues) => void
): ControlValues {
  const values: ControlValues = {
    rpm: 800,
    running: true,
    dynoEnabled: true,
    dynoGain: 1.0,
    dynoIntegralGain: 0.5,
    dynoMode: 0,
    dynoLoadTorque: 10.0,
    dynoTargetPower: 5.0,
    throttle: 1.0,
    volume: 0.3,
    muted: false,
    timeScale: 1.0,
  };

  const pauseBtn = document.getElementById("pause-btn") as HTMLButtonElement;
  const rpmInput = document.getElementById("rpm-input") as HTMLInputElement;
  const dynoToggle = document.getElementById("dyno-toggle") as HTMLInputElement;
  const dynoGainInput = document.getElementById("dyno-gain") as HTMLInputElement;
  const dynoModeSelect = document.getElementById("dyno-mode") as HTMLSelectElement;
  const dynoLoadInput = document.getElementById("dyno-load") as HTMLInputElement;
  const dynoPowerInput = document.getElementById("dyno-power") as HTMLInputElement;
  const sweepBtn = document.getElementById("sweep-btn") as HTMLButtonElement;
  const throttleSlider = document.getElementById("throttle-slider") as HTMLInputElement;
  const throttleValueEl = document.getElementById("throttle-value") as HTMLSpanElement;
  const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
  const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement;
  const timeScaleInput = document.getElementById("time-scale") as HTMLInputElement;
  const timeScaleValue = document.getElementById("time-scale-value") as HTMLSpanElement;

  function setRpm(rpm: number) {
    values.rpm = Math.max(0, Math.min(8000, rpm));
    rpmInput.value = String(values.rpm);
    onChange(values);
  }

  function setThrottle(thr: number) {
    values.throttle = Math.max(0, Math.min(1, Math.round(thr * 100) / 100));
    if (throttleSlider) throttleSlider.value = String(Math.round(values.throttle * 100));
    if (throttleValueEl) throttleValueEl.textContent = `${Math.round(values.throttle * 100)}%`;
    onChange(values);
  }

  function updateMuteBtn() {
    muteBtn.textContent = values.muted ? "\u{1F507}" : "\u{1F50A}";
  }

  // Pause button
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      values.running = !values.running;
      onChange(values);
    });
  }

  // Numeric input field
  rpmInput.addEventListener("input", () => {
    const v = parseInt(rpmInput.value, 10);
    if (!isNaN(v)) {
      values.rpm = Math.max(0, Math.min(8000, v));
      onChange(values);
    }
  });

  // Dyno checkbox
  dynoToggle.addEventListener("change", () => {
    values.dynoEnabled = dynoToggle.checked;
    onChange(values);
  });

  // Dyno gain input
  dynoGainInput.addEventListener("input", () => {
    const v = parseFloat(dynoGainInput.value);
    if (!isNaN(v) && v > 0) {
      values.dynoGain = v;
      onChange(values);
    }
  });

  // Dyno mode selector
  function updateDynoModeUI() {
    const loadGroup = document.getElementById("dyno-load-group");
    const powerGroup = document.getElementById("dyno-power-group");
    if (loadGroup) loadGroup.style.display = values.dynoMode === 1 ? "contents" : "none";
    if (powerGroup) powerGroup.style.display = values.dynoMode === 3 ? "contents" : "none";
    if (sweepBtn) sweepBtn.style.display = values.dynoMode === 0 ? "inline" : "none";
  }

  if (dynoModeSelect) {
    dynoModeSelect.addEventListener("change", () => {
      values.dynoMode = parseInt(dynoModeSelect.value, 10);
      updateDynoModeUI();
      onChange(values);
    });
  }

  if (dynoLoadInput) {
    dynoLoadInput.addEventListener("input", () => {
      const v = parseFloat(dynoLoadInput.value);
      if (!isNaN(v) && v >= 0) {
        values.dynoLoadTorque = v;
        onChange(values);
      }
    });
  }

  if (dynoPowerInput) {
    dynoPowerInput.addEventListener("input", () => {
      const v = parseFloat(dynoPowerInput.value);
      if (!isNaN(v) && v >= 0) {
        values.dynoTargetPower = v;
        onChange(values);
      }
    });
  }

  if (sweepBtn) {
    sweepBtn.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("dyno-sweep-start"));
    });
  }

  updateDynoModeUI();

  // Throttle slider
  if (throttleSlider) {
    throttleSlider.addEventListener("input", () => {
      values.throttle = parseInt(throttleSlider.value, 10) / 100;
      if (throttleValueEl) throttleValueEl.textContent = `${Math.round(values.throttle * 100)}%`;
      onChange(values);
    });
  }

  // Volume slider
  volumeSlider.addEventListener("input", () => {
    values.volume = parseInt(volumeSlider.value, 10) / 100;
    onChange(values);
  });

  // Mute button
  muteBtn.addEventListener("click", () => {
    values.muted = !values.muted;
    updateMuteBtn();
    onChange(values);
  });

  // Time scale slider
  function updateTimeScale(v: number) {
    values.timeScale = Math.round(Math.max(0.1, Math.min(2.0, v)) * 10) / 10;
    timeScaleInput.value = String(values.timeScale);
    timeScaleValue.textContent = `${values.timeScale.toFixed(1)}x`;
    onChange(values);
  }

  timeScaleInput.addEventListener("input", () => {
    updateTimeScale(parseFloat(timeScaleInput.value));
  });

  // Keyboard controls (only when input isn't focused)
  document.addEventListener("keydown", (e) => {
    if (document.activeElement instanceof HTMLInputElement) return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        values.running = !values.running;
        onChange(values);
        break;
      case "w":
      case "W":
      case "ArrowUp":
        e.preventDefault();
        setThrottle(values.throttle + (e.shiftKey ? 0.01 : 0.05));
        break;
      case "s":
      case "S":
      case "ArrowDown":
        e.preventDefault();
        setThrottle(values.throttle - (e.shiftKey ? 0.01 : 0.05));
        break;
      case "d":
      case "D":
        values.dynoEnabled = !values.dynoEnabled;
        dynoToggle.checked = values.dynoEnabled;
        onChange(values);
        break;
      case "m":
      case "M":
        values.muted = !values.muted;
        updateMuteBtn();
        onChange(values);
        break;
      case "[":
        updateTimeScale(values.timeScale - 0.1);
        break;
      case "]":
        updateTimeScale(values.timeScale + 0.1);
        break;
    }
  });

  return values;
}

/** Update the throttle slider display from engine readback (for PI mode). */
export function updateThrottleSlider(throttle: number, disabled: boolean): void {
  const slider = document.getElementById("throttle-slider") as HTMLInputElement | null;
  const valueEl = document.getElementById("throttle-value") as HTMLSpanElement | null;
  if (slider) {
    slider.value = String(Math.round(throttle * 100));
    slider.disabled = disabled;
    slider.style.opacity = disabled ? "0.5" : "1";
  }
  if (valueEl) {
    valueEl.textContent = `${Math.round(throttle * 100)}%`;
  }
}
