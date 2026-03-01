/**
 * Strepitus — Entry point.
 * Initializes WASM, creates the engine, and runs the simulation loop.
 */

import { initWasm } from "./bridge/wasm";
import { EngineView, type CylinderData } from "./renderer/engine-view";
import { PVDiagram } from "./renderer/pv-diagram";
import { TelemetryDisplay, HistoryCharts } from "./ui/graphs";
import { createControls, updateThrottleSlider, type ControlValues } from "./ui/controls";
import { ParamPanel } from "./ui/param-panel";
import { EngineSynthesizer, cylinderCombustion } from "./audio/synthesizer";
import { AudioMixerPanel } from "./ui/audio-mixer";
import { DynoSweep } from "./dyno/sweep";
import { DynoChart } from "./ui/dyno-chart";

const statusEl = document.getElementById("status")!;

function setStatus(msg: string, state: "loading" | "ready" | "error") {
  statusEl.textContent = msg;
  statusEl.className = state;
}

async function main() {
  try {
    // 1. Load WASM
    setStatus("Loading physics engine...", "loading");
    const wasm = await initWasm();

    // 2. Create engine — check localStorage for saved config
    const savedConfig = ParamPanel.loadSaved();
    let config = new wasm.EngineConfig();
    if (savedConfig) {
      try {
        config = wasm.EngineConfig.fromJSON(JSON.stringify(savedConfig));
      } catch (e) {
        console.warn("[strepitus] Failed to load saved config:", e);
      }
    }

    // Snapshot config as JSON before engine takes ownership
    let configJson = JSON.parse(config.toJSON()) as Record<string, unknown>;
    let bore = config.bore;
    let stroke = config.stroke;
    let cylinderCount = (configJson.cylinder_count as number) || 1;
    let singleEngine: InstanceType<typeof wasm.Engine> | null = null;
    let multiEngine: InstanceType<typeof wasm.MultiCylinderEngine> | null = null;

    function createEngine() {
      // Always recreate config from JSON (engine takes ownership)
      const freshConfig = wasm.EngineConfig.fromJSON(JSON.stringify(configJson));
      bore = freshConfig.bore;
      stroke = freshConfig.stroke;
      cylinderCount = (configJson.cylinder_count as number) || 1;
      if (cylinderCount > 1) {
        singleEngine = null;
        multiEngine = new wasm.MultiCylinderEngine(freshConfig);
      } else {
        multiEngine = null;
        singleEngine = new wasm.Engine(freshConfig);
      }
    }
    createEngine();

    function setRpm(rpm: number) {
      if (singleEngine) singleEngine.set_rpm(rpm);
      if (multiEngine) multiEngine.set_rpm(rpm);
    }
    function setDynoEnabled(v: boolean) {
      if (singleEngine) singleEngine.set_dyno_enabled(v);
      if (multiEngine) multiEngine.set_dyno_enabled(v);
    }
    function setDynoGain(v: number) {
      if (singleEngine) singleEngine.set_dyno_gain(v);
      if (multiEngine) multiEngine.set_dyno_gain(v);
    }
    function setDynoIntegralGain(v: number) {
      if (singleEngine) singleEngine.set_dyno_integral_gain(v);
      if (multiEngine) multiEngine.set_dyno_integral_gain(v);
    }
    function setDynoMode(v: number) {
      if (singleEngine) singleEngine.set_dyno_mode(v);
      if (multiEngine) multiEngine.set_dyno_mode(v);
    }
    function setDynoLoad(v: number) {
      if (singleEngine) singleEngine.set_dyno_load(v);
      if (multiEngine) multiEngine.set_dyno_load(v);
    }
    function setTargetRpm(rpm: number) {
      if (singleEngine) singleEngine.set_target_rpm(rpm);
      if (multiEngine) multiEngine.set_target_rpm(rpm);
    }
    function setThrottle(v: number) {
      if (singleEngine) singleEngine.set_throttle(v);
      if (multiEngine) multiEngine.set_throttle(v);
    }
    function getThrottle(): number {
      if (singleEngine) return singleEngine.throttle();
      if (multiEngine) return multiEngine.throttle();
      return 1.0;
    }
    function getRpm(): number {
      if (singleEngine) return singleEngine.rpm();
      if (multiEngine) return multiEngine.rpm();
      return 0;
    }

    setStatus(
      `Strepitus v${wasm.version()} — ${getRpm().toFixed(0)} RPM — Space: pause, ↑↓: RPM`,
      "ready"
    );

    // 3. Set up renderer
    const canvas = document.getElementById("engine-canvas") as HTMLCanvasElement;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    let view = new EngineView(canvas, bore, stroke, cylinderCount);

    // 4. P-V diagram
    const pvCanvas = document.getElementById("pv-canvas") as HTMLCanvasElement;
    const pvDiagram = new PVDiagram(pvCanvas);

    // 5. Telemetry display + history charts
    const telemetry = new TelemetryDisplay("telemetry");
    const charts = new HistoryCharts("charts-panel");

    // 6. Audio synthesizer
    const synth = new EngineSynthesizer();
    let audioInitialized = false;

    async function ensureAudio() {
      if (!audioInitialized) {
        await synth.init();
        audioInitialized = true;
        mixerPanel.refresh();
      }
    }

    // Track latest control values so we can re-apply after engine recreation
    let controlValues: ControlValues = { rpm: 800, running: true, dynoEnabled: true, dynoGain: 1.0, dynoIntegralGain: 0.0, dynoMode: 0, dynoLoadTorque: 0, throttle: 1.0, volume: 0.3, muted: false, timeScale: 1.0 };

    // 6b. Audio mixer panel
    const mixerPanel = new AudioMixerPanel("audio-mixer", synth);

    // 7. Parameter panel
    const paramPanel = new ParamPanel("param-panel", configJson, (newConfig) => {
      try {
        configJson = newConfig as Record<string, unknown>;
        createEngine();
        setRpm(controlValues.rpm);
        setDynoEnabled(controlValues.dynoEnabled);
        setDynoGain(controlValues.dynoGain);
        // Recreate view for new bore/stroke/cylinder count
        view.dispose();
        view = new EngineView(canvas, bore, stroke, cylinderCount);
        charts.resetRanges();
      } catch (e) {
        console.error("[strepitus] Config apply error:", e);
      }
    });

    // 8. Keyboard toggles
    document.addEventListener("keydown", (e) => {
      if (document.activeElement instanceof HTMLInputElement) return;

      switch (e.key) {
        case "g":
        case "G":
          charts.toggle();
          break;
        case "f":
        case "F":
          view.setForceArrowsVisible(!view.forceArrowsVisible);
          break;
        case "v":
        case "V":
          pvDiagram.setVisible(!pvDiagram.visible);
          break;
        case "p":
        case "P":
          paramPanel.toggle();
          break;
        case "a":
        case "A":
          mixerPanel.toggle();
          break;
        case "l":
        case "L":
          pvDiagram.setLogScale(!pvDiagram.logScale);
          break;
      }
    });

    // 9. Controls
    let running = true;
    let timeScale = 1.0;
    createControls(document.body, (values: ControlValues) => {
      controlValues = values;
      running = values.running;
      timeScale = values.timeScale;
      setRpm(values.rpm);
      setDynoEnabled(values.dynoEnabled);
      setDynoGain(values.dynoGain);
      setDynoIntegralGain(values.dynoIntegralGain);
      setDynoMode(values.dynoMode);
      setDynoLoad(values.dynoLoadTorque);
      // In speed mode (0/2), PI controller manages throttle; otherwise manual
      if (!values.dynoEnabled || values.dynoMode === 1) {
        setThrottle(values.throttle);
      }
      synth.setVolume(values.volume);
      synth.setMuted(values.muted || !values.running);
      const dynoTag = values.dynoEnabled ? ` · Dyno K=${values.dynoGain}` : " · Dyno OFF";
      const cylTag = cylinderCount > 1 ? ` · ${cylinderCount}cyl` : "";
      const speedTag = values.timeScale !== 1.0 ? ` · ${values.timeScale.toFixed(1)}x` : "";
      setStatus(
        `Strepitus v${wasm.version()} — ${values.rpm} RPM${running ? "" : " [PAUSED]"}${dynoTag}${cylTag}${speedTag}`,
        "ready"
      );
    });

    // Init audio on first user interaction (autoplay policy)
    const initAudioOnce = () => {
      ensureAudio();
      document.removeEventListener("click", initAudioOnce);
      document.removeEventListener("keydown", initAudioOnce);
    };
    document.addEventListener("click", initAudioOnce);
    document.addEventListener("keydown", initAudioOnce);

    // P-V diagram info toggle
    const pvInfoBtn = document.getElementById("pv-info-btn");
    const pvTooltip = document.getElementById("pv-tooltip");
    if (pvInfoBtn && pvTooltip) {
      pvInfoBtn.addEventListener("click", () => {
        const shown = pvTooltip.style.display !== "none";
        pvTooltip.style.display = shown ? "none" : "block";
      });
    }

    // P-V log scale toggle
    const pvLogBtn = document.getElementById("pv-log-btn");
    if (pvLogBtn) {
      pvLogBtn.addEventListener("click", () => {
        pvDiagram.setLogScale(!pvDiagram.logScale);
      });
    }

    // 10. Power EMA + Dyno sweep
    let smoothedTorque = 0;
    const torqueAlpha = 0.02;
    let activeSweep: DynoSweep | null = null;
    const dynoChart = new DynoChart("dyno-chart-canvas");
    const dynoChartSection = document.getElementById("dyno-chart-section");

    document.addEventListener("dyno-sweep-start", () => {
      smoothedTorque = 0; // reset EMA for clean sweep
      activeSweep = new DynoSweep({
        startRpm: 1000,
        endRpm: configJson.max_rpm as number || 8000,
        stepRpm: 100,
        holdTime: 1.5,
        sampleTime: 0.5,
      });
      activeSweep.onProgress = (pct) => {
        setStatus(`Sweep ${(pct * 100).toFixed(0)}%...`, "loading");
      };
      activeSweep.onComplete = (data) => {
        activeSweep = null;
        dynoChart.setData(data);
        if (dynoChartSection) dynoChartSection.style.display = "";
        setStatus(`Sweep complete — peak ${data.reduce((a, b) => b.powerKw > a.powerKw ? b : a, data[0]).powerKw.toFixed(1)} kW`, "ready");
      };
      setDynoEnabled(true);
      activeSweep.start(setTargetRpm, setDynoMode);
    });

    // 11. Simulation loop
    let lastTime = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05) * timeScale;
      lastTime = now;

      if (running) {
        let currentTorque = 0;
        let currentRpm = 0;
        let currentCycleAvgTorque = 0;

        if (singleEngine) {
          // Single-cylinder path
          const state = singleEngine.step(dt);
          currentTorque = state.torque;
          currentRpm = state.rpm;
          currentCycleAvgTorque = state.cycle_avg_torque;

          view.update({
            piston_position: state.piston_position,
            crank_angle: state.crank_angle,
            intake_valve_lift: state.intake_valve_lift,
            exhaust_valve_lift: state.exhaust_valve_lift,
            cylinder_pressure: state.cylinder_pressure,
            gas_temperature: state.gas_temperature,
            wall_temperature: state.wall_temperature,
            stroke_phase: state.stroke_phase,
            burn_fraction: state.burn_fraction,
            cylinder_volume: state.cylinder_volume,
            gas_force: state.gas_force,
            inertia_force: state.inertia_force,
            friction_force: state.friction_force,
            throttle_position: getThrottle(),
            manifold_pressure: state.manifold_pressure,
          });

          smoothedTorque += torqueAlpha * (state.torque - smoothedTorque);
          const powerKw = smoothedTorque * state.rpm / 9549;

          // Update throttle slider readback
          const isSpeedMode = controlValues.dynoEnabled && controlValues.dynoMode !== 1;
          updateThrottleSlider(getThrottle(), isSpeedMode);

          telemetry.update({
            rpm: state.rpm,
            cylinder_pressure: state.cylinder_pressure,
            gas_temperature: state.gas_temperature,
            stroke_phase: state.stroke_phase,
            piston_position: state.piston_position,
            crank_angle: state.crank_angle,
            power_kw: powerKw,
            manifold_pressure: state.manifold_pressure,
            throttle: getThrottle(),
          });

          charts.update({
            rpm: state.rpm,
            cylinder_pressure: state.cylinder_pressure,
            gas_temperature: state.gas_temperature,
            wall_temperature: state.wall_temperature,
            torque: state.torque,
            burn_fraction: state.burn_fraction,
            cylinder_volume: state.cylinder_volume,
            crank_angle: state.crank_angle,
            gas_force: state.gas_force,
            inertia_force: state.inertia_force,
            friction_force: state.friction_force,
            power_kw: powerKw,
            manifold_pressure: state.manifold_pressure,
          });

          pvDiagram.push(state.cylinder_volume, state.cylinder_pressure, state.stroke_phase);
          pvDiagram.render();

          if (audioInitialized) {
            synth.update({
              mechanical_noise: state.mechanical_noise,
              cycle_frequency: state.cycle_frequency,
              rpm: state.rpm,
              cylinders: [{
                combustion_intensity: state.combustion_intensity,
                stroke_phase: state.stroke_phase,
                intake_valve_lift: state.intake_valve_lift,
                exhaust_valve_lift: state.exhaust_valve_lift,
                burn_fraction: state.burn_fraction,
                cylinder_pressure: state.cylinder_pressure,
              }],
            });
          }
        } else if (multiEngine) {
          // Multi-cylinder path
          const mstate = multiEngine.step(dt);
          const cylJson = mstate.cylindersJSON();
          const cylinders: CylinderData[] = JSON.parse(cylJson);
          currentTorque = mstate.total_torque;
          currentRpm = mstate.rpm;
          currentCycleAvgTorque = mstate.cycle_avg_torque;

          view.updateMulti(cylinders);
          view.updateThrottle(getThrottle(), cylinders);

          smoothedTorque += torqueAlpha * (mstate.total_torque - smoothedTorque);
          const powerKw = smoothedTorque * mstate.rpm / 9549;

          // Update throttle slider readback
          const isSpeedModeM = controlValues.dynoEnabled && controlValues.dynoMode !== 1;
          updateThrottleSlider(getThrottle(), isSpeedModeM);

          // Telemetry: show cylinder 0 data
          const c0 = cylinders[0];
          if (c0) {
            telemetry.update({
              rpm: mstate.rpm,
              cylinder_pressure: c0.cylinder_pressure,
              gas_temperature: c0.gas_temperature,
              stroke_phase: c0.stroke_phase,
              piston_position: c0.piston_position,
              crank_angle: c0.crank_angle,
              power_kw: powerKw,
              manifold_pressure: mstate.manifold_pressure,
              throttle: getThrottle(),
            });

            charts.update({
              rpm: mstate.rpm,
              cylinder_pressure: c0.cylinder_pressure,
              gas_temperature: c0.gas_temperature,
              wall_temperature: c0.wall_temperature,
              torque: mstate.total_torque,
              burn_fraction: c0.burn_fraction,
              cylinder_volume: c0.cylinder_volume,
              crank_angle: c0.crank_angle,
              gas_force: c0.gas_force,
              inertia_force: c0.inertia_force,
              friction_force: c0.friction_force,
              power_kw: powerKw,
              manifold_pressure: mstate.manifold_pressure,
            });

            pvDiagram.push(c0.cylinder_volume, c0.cylinder_pressure, c0.stroke_phase);
            pvDiagram.render();
          }

          if (audioInitialized) {
            synth.update({
              mechanical_noise: mstate.mechanical_noise,
              cycle_frequency: mstate.cycle_frequency,
              rpm: mstate.rpm,
              cylinders: cylinders.map((cyl) => ({
                combustion_intensity: cylinderCombustion(cyl.cylinder_pressure, cyl.stroke_phase),
                stroke_phase: cyl.stroke_phase,
                intake_valve_lift: cyl.intake_valve_lift,
                exhaust_valve_lift: cyl.exhaust_valve_lift,
                burn_fraction: cyl.burn_fraction,
                cylinder_pressure: cyl.cylinder_pressure,
              })),
            });
          }
        }

        // Tick sweep if active — feed Rust-computed cycle-averaged torque
        if (activeSweep) {
          activeSweep.tick(dt, currentCycleAvgTorque);
        }
      }

      view.render();
      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
  } catch (err) {
    console.error("[strepitus] Fatal:", err);
    setStatus(`Failed to initialize: ${err}`, "error");
  }
}

main();
