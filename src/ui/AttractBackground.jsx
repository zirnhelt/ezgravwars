import { useEffect, useRef } from "react";
import { GameView } from "../game/view.js";
import { generateLevel } from "../game/levelgen.js";
import { simulateShot } from "../game/physics.js";
import { planCpuShot } from "../game/ai.js";
import { CANVAS_W, CANVAS_H } from "../game/constants.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Arcade-style attract mode: two silent CPUs duel behind the menu, so the
// first thing a new player sees is what the game actually is.
export default function AttractBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let alive = true;
    const view = new GameView(canvas, { silent: true });

    const fit = () => {
      const w = Math.max(window.innerWidth, (window.innerHeight * CANVAS_W) / CANVAS_H);
      const h = (w * CANVAS_H) / CANVAS_W;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      view.resize(w, h);
    };
    fit();
    window.addEventListener("resize", fit);

    (async () => {
      let seed = Math.floor(Math.random() * 2e9) + 1;
      let level = 1 + Math.floor(Math.random() * 6);
      let planets = generateLevel(seed, level);
      let turn = 1;
      let mem = { 1: { shotsOnLevel: 0 }, 2: { shotsOnLevel: 0 } };
      view.setLevel(planets, seed, level);
      view.setState({ labels: { 1: "", 2: "" }, aim: null, idle: true });

      while (alive) {
        view.setState({ turn });
        await sleep(900);
        if (!alive) return;
        const plan = await planCpuShot(planets, turn, "captain", mem[turn], () => !alive);
        if (!plan || !alive) return;
        view.setState({ turrets: { [turn]: plan.angle } });
        await sleep(450);
        if (!alive) return;
        const sim = simulateShot(planets, plan.angle, plan.power, turn);
        await view.playShot(sim, { shooter: turn, power: plan.power });
        if (!alive) return;
        mem[turn].shotsOnLevel++;
        if (sim.hit) {
          await sleep(500);
          level++;
          planets = generateLevel(seed, level);
          mem = { 1: { shotsOnLevel: 0 }, 2: { shotsOnLevel: 0 } };
          await view.transitionTo(planets, seed, level);
        }
        turn = turn === 1 ? 2 : 1;
      }
    })();

    return () => {
      alive = false;
      window.removeEventListener("resize", fit);
      view.destroy();
    };
  }, []);

  return (
    <div className="attract" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
