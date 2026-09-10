#!/usr/bin/env python3
"""
Gioca a FOMO & FUD dal Python, usando gli stessi parametri di simulazione.yaml.

    npm run play                                 # gioca con una policy casuale
    npm run play -- --scenario "trader povero"
    npm run play -- --episodes 20000 --envs 256

`npm run play` crea l'ambiente virtuale al primo avvio e usa il suo Python, così
non devi ricordarti di attivarlo. Se preferisci a mano:

    source .venv/bin/activate && python python/play.py

Il motore, le carte e i valori restano quelli di sempre: questo script non
duplica nessuna regola, pilota il ponte Node. Sostituisci `choose_action` con la
tua rete e hai un ciclo di addestramento.

Dipendenze: PyYAML (installato da `npm run py:setup`).
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fomofud import FomoFudVecEnv  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def it_num(value: float, decimals: int = 0) -> str:
    """1234567 -> '1.234.567' (separatore italiano)."""
    return f"{value:,.{decimals}f}".replace(",", "\u00a0").replace(".", ",").replace("\u00a0", ".")


def read_yaml(path: Path) -> dict:
    try:
        import yaml
    except ImportError:
        print(
            "Manca PyYAML: uso i valori di default del ponte.\n"
            "Per leggere simulazione.yaml:  npm run py:setup",
            file=sys.stderr,
        )
        return {}
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def choose_action(obs: list[float], legal: list[int], rng: random.Random) -> int:
    """
    LA POLICY. Qui va la rete.

    Riceve l'osservazione (vettore piatto di 155 numeri) e gli indici delle
    azioni legali; deve restituirne uno. Questa versione sceglie a caso — è il
    pavimento contro cui misurare tutto il resto.

    Con una rete: logits = net(obs); logits[non legali] = -inf; campiona.
    """
    if not legal:
        return 0
    return rng.choice(legal)


def main() -> int:
    parser = argparse.ArgumentParser(description="Gioca a FOMO & FUD dal Python")
    parser.add_argument("--config", default="simulazione.yaml", help="file di configurazione")
    parser.add_argument("--scenario", default=None, help="quale scenario del YAML usare (default: il primo)")
    parser.add_argument("--episodes", type=int, default=None, help="partite da giocare (default: 'games' del YAML)")
    parser.add_argument("--envs", type=int, default=None, help="partite in parallelo (default: 'rl.envs' del YAML)")
    parser.add_argument("--seed", type=int, default=None, help="seed di partenza (default: 'seed' del YAML)")
    parser.add_argument("--no-build", action="store_true", help="non ricompilare il motore")
    args = parser.parse_args()

    config_path = REPO_ROOT / args.config
    yaml_config = read_yaml(config_path)
    episodes = args.episodes or int(yaml_config.get("games", 2000))
    seed = args.seed if args.seed is not None else int(yaml_config.get("seed", 1))
    rng = random.Random(seed)

    env = FomoFudVecEnv(
        config=args.config,
        scenario=args.scenario,
        envs=args.envs,
        seed=seed,
        build=not args.no_build,
    )
    info = env.info
    print(
        f"\nScenario '{info.scenario}' · {info.players} giocatori · {info.rounds} Round\n"
        f"Avversari: {', '.join(info.agents)}\n"
        f"Osservazione: {info.obs_size} feature · azioni: {info.action_size} (mascherate)\n"
        f"Partite in parallelo: {info.envs} · episodi da giocare: {it_num(episodes)}"
    )
    print("\nComposizione dell'osservazione:")
    for block in info.feature_layout:
        print(f"   {block['name']:<32}{block['size']:>4}")

    obs, legal = env.reset()
    finished = 0
    rewards: list[float] = []
    steps = 0
    started = time.time()

    while finished < episodes:
        actions = [choose_action(obs[i], legal[i], rng) for i in range(env.num_envs)]
        obs, legal, reward, done = env.step(actions)
        steps += env.num_envs
        for r, d in zip(reward, done):
            if d:
                rewards.append(r)
                finished += 1
    env.close()

    elapsed = time.time() - started
    wins = sum(1 for r in rewards if r == 1.0)
    baseline = 1.0 / info.players
    mean = sum(rewards) / len(rewards)
    print(
        f"\n{'=' * 60}\n"
        f"{it_num(len(rewards))} episodi\n"
        f"ricompensa media (rango): {mean:.3f}   — 0,500 = perfettamente in media\n"
        f"vittorie nette:           {wins / len(rewards) * 100:.1f}%   — atteso {baseline * 100:.1f}% al caso\n"
        f"{it_num(steps)} decisioni in {elapsed:.1f}s ({it_num(steps / elapsed)} decisioni/s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
