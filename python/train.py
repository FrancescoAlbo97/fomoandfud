#!/usr/bin/env python3
"""
Addestra la policy con PPO, poi salva i pesi in un JSON che il motore
TypeScript sa caricare.

    npm run train
    npm run train -- --steps 500000
    npm run train -- --scenario "trader povero" --out models/povero.json

Tutti i parametri stanno nel blocco `training:` di simulazione.yaml. I flag
servono per le prove al volo e vincono sul file.

Finito l'addestramento, aggiungi la policy a `policies:` nel YAML e mettila fra
gli `agents:` di uno scenario: da quel momento gioca in `npm run sim` come gli
archetipi, nella stessa tabella e negli stessi grafici.

Dipendenze: npm run py:setup -- --rl
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fomofud import FomoFudVecEnv  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

try:
    import numpy as np
    import torch
    import torch.nn as nn
except ImportError as exc:  # pragma: no cover
    print(
        f"Manca una dipendenza per l'addestramento ({exc.name}).\n"
        "Installa con:  npm run py:setup -- --rl",
        file=sys.stderr,
    )
    raise SystemExit(1)


# ---------------------------------------------------------------------------
# La rete: tronco condiviso, una testa per la policy e una per il valore.
# tanh e non ReLU perché con PPO dà gradienti più docili su reti piccole.
# ---------------------------------------------------------------------------
class PolicyNet(nn.Module):
    def __init__(self, obs_size: int, action_size: int, hidden: list[int]) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        last = obs_size
        for size in hidden:
            layers += [nn.Linear(last, size), nn.Tanh()]
            last = size
        self.trunk = nn.Sequential(*layers)
        self.policy = nn.Linear(last, action_size)
        self.value = nn.Linear(last, 1)
        # Inizializzazione ortogonale: standard per PPO, tiene i logit piccoli
        # all'inizio così la policy parte quasi uniforme e non si incastra.
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=1.0)
                nn.init.zeros_(module.bias)
        nn.init.orthogonal_(self.policy.weight, gain=0.01)

    def forward(self, obs: "torch.Tensor") -> tuple["torch.Tensor", "torch.Tensor"]:
        h = self.trunk(obs)
        return self.policy(h), self.value(h).squeeze(-1)


def masked_distribution(logits: "torch.Tensor", mask: "torch.Tensor"):
    """Azioni illegali a -inf: la rete non può nemmeno provarci."""
    return torch.distributions.Categorical(logits=logits.masked_fill(~mask, -1e9))


def to_mask(legal: list[list[int]], action_size: int) -> "np.ndarray":
    mask = np.zeros((len(legal), action_size), dtype=bool)
    for i, indices in enumerate(legal):
        if indices:
            mask[i, indices] = True
    return mask


def export_model(net: PolicyNet, obs_size: int, action_size: int, shape: str, meta: dict) -> dict:
    """Pesi in JSON, nel formato che legge src/engine/policyFormat.ts."""

    def layer(linear: nn.Linear) -> dict:
        w = linear.weight.detach().cpu().numpy()
        return {
            "w": [round(float(v), 6) for v in w.reshape(-1)],
            "b": [round(float(v), 6) for v in linear.bias.detach().cpu().numpy()],
            "in": int(w.shape[1]),
            "out": int(w.shape[0]),
        }

    return {
        "format": "fomofud-policy-1",
        "obsSize": obs_size,
        "actionSize": action_size,
        "shape": shape,
        "trunk": [layer(m) for m in net.trunk if isinstance(m, nn.Linear)],
        "policyHead": layer(net.policy),
        "valueHead": layer(net.value),
        "meta": meta,
    }


def evaluate(env: FomoFudVecEnv, net: PolicyNet, episodes: int, greedy: bool = True) -> float:
    """Ricompensa media su N episodi, giocando la mossa migliore (senza esplorare)."""
    obs, legal = env.reset()
    scores: list[float] = []
    with torch.no_grad():
        while len(scores) < episodes:
            mask = to_mask(legal, env.action_size)
            logits, _ = net(torch.as_tensor(np.asarray(obs, dtype=np.float32)))
            dist = masked_distribution(logits, torch.as_tensor(mask))
            actions = dist.probs.argmax(dim=-1) if greedy else dist.sample()
            obs, legal, reward, done = env.step(actions.tolist())
            for r, d in zip(reward, done):
                if d:
                    scores.append(r)
    return float(np.mean(scores[:episodes]))


def main() -> int:
    parser = argparse.ArgumentParser(description="Addestra la policy di FOMO & FUD con PPO")
    parser.add_argument("--config", default="simulazione.yaml")
    parser.add_argument("--scenario", default=None, help="scenario su cui allenarsi")
    parser.add_argument("--opponents", default=None, help="avversari, separati da virgola")
    parser.add_argument("--steps", type=int, default=None, help="decisioni totali di addestramento")
    parser.add_argument("--envs", type=int, default=None)
    parser.add_argument("--out", default=None, help="dove salvare i pesi")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()

    try:
        import yaml
    except ImportError:
        print("Manca PyYAML:  npm run py:setup", file=sys.stderr)
        return 1

    config_path = REPO_ROOT / args.config
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    t = dict((raw or {}).get("training") or {})

    steps = args.steps or int(t.get("steps", 2_000_000))
    envs = args.envs or int(t.get("envs", 64))
    scenario = args.scenario or t.get("scenario")
    opponents = args.opponents.split(",") if args.opponents else t.get("opponents")
    out_path = REPO_ROOT / (args.out or t.get("out", "models/policy.json"))
    hidden = [int(h) for h in t.get("hidden", [128, 128])]
    lr = float(t.get("learningRate", 3e-4))
    ent_coef = float(t.get("entropy", 0.02))
    gamma = float(t.get("gamma", 1.0))
    gae_lambda = float(t.get("gaeLambda", 0.95))
    clip = float(t.get("clip", 0.2))
    epochs = int(t.get("epochs", 4))
    minibatches = int(t.get("minibatches", 4))
    rollout = int(t.get("rolloutSteps", 128))
    eval_every = int(t.get("evalEvery", 200_000))
    eval_episodes = int(t.get("evalEpisodes", 2000))

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    env = FomoFudVecEnv(
        config=args.config, scenario=scenario, envs=envs, seed=args.seed,
        build=not args.no_build, opponents=opponents,
    )
    info = env.info
    net = PolicyNet(env.observation_size, env.action_size, hidden)
    optimizer = torch.optim.Adam(net.parameters(), lr=lr, eps=1e-5)

    print(
        f"\nAddestramento su '{info.scenario}' · tavolo da {info.players}\n"
        f"Avversari: {', '.join(info.agents)}\n"
        f"Rete: {env.observation_size} → {' → '.join(map(str, hidden))} → {env.action_size}"
        f"  ({sum(p.numel() for p in net.parameters()):,} parametri)\n"
        f"Passi: {steps:,} · {envs} partite in parallelo · rollout {rollout}\n"
    )

    obs, legal = env.reset()
    best = -1.0
    done_steps = 0
    episode_scores: list[float] = []
    next_eval = eval_every
    started = time.time()

    while done_steps < steps:
        # --- raccolta ---------------------------------------------------
        buf_obs, buf_mask, buf_act, buf_logp, buf_val, buf_rew, buf_done = [], [], [], [], [], [], []
        for _ in range(rollout):
            obs_np = np.asarray(obs, dtype=np.float32)
            mask_np = to_mask(legal, env.action_size)
            with torch.no_grad():
                logits, value = net(torch.as_tensor(obs_np))
                dist = masked_distribution(logits, torch.as_tensor(mask_np))
                action = dist.sample()
                logp = dist.log_prob(action)
            obs, legal, reward, done = env.step(action.tolist())

            buf_obs.append(obs_np)
            buf_mask.append(mask_np)
            buf_act.append(action.numpy())
            buf_logp.append(logp.numpy())
            buf_val.append(value.numpy())
            buf_rew.append(np.asarray(reward, dtype=np.float32))
            buf_done.append(np.asarray(done, dtype=np.float32))
            done_steps += envs
            for r, d in zip(reward, done):
                if d:
                    episode_scores.append(r)

        # --- vantaggi (GAE) ---------------------------------------------
        # La ricompensa arriva solo a fine partita, quindi il bootstrap va
        # interrotto sul confine `done`: l'osservazione successiva appartiene
        # già all'episodio nuovo (il ponte fa autoreset).
        with torch.no_grad():
            _, last_value = net(torch.as_tensor(np.asarray(obs, dtype=np.float32)))
        values = np.array(buf_val, dtype=np.float32)
        rewards = np.array(buf_rew, dtype=np.float32)
        dones = np.array(buf_done, dtype=np.float32)
        advantages = np.zeros_like(rewards)
        gae = np.zeros(envs, dtype=np.float32)
        next_value = last_value.numpy()
        for t_i in reversed(range(rollout)):
            not_done = 1.0 - dones[t_i]
            delta = rewards[t_i] + gamma * next_value * not_done - values[t_i]
            gae = delta + gamma * gae_lambda * not_done * gae
            advantages[t_i] = gae
            next_value = values[t_i]
        returns = advantages + values

        # --- ottimizzazione ---------------------------------------------
        flat_obs = torch.as_tensor(np.concatenate(buf_obs))
        flat_mask = torch.as_tensor(np.concatenate(buf_mask))
        flat_act = torch.as_tensor(np.concatenate(buf_act), dtype=torch.long)
        flat_logp = torch.as_tensor(np.concatenate(buf_logp))
        flat_adv = torch.as_tensor(advantages.reshape(-1))
        flat_ret = torch.as_tensor(returns.reshape(-1))
        flat_adv = (flat_adv - flat_adv.mean()) / (flat_adv.std() + 1e-8)

        batch = flat_obs.shape[0]
        minibatch = max(1, batch // minibatches)
        last_entropy = 0.0
        for _ in range(epochs):
            order = torch.randperm(batch)
            for start in range(0, batch, minibatch):
                idx = order[start : start + minibatch]
                logits, value = net(flat_obs[idx])
                dist = masked_distribution(logits, flat_mask[idx])
                logp = dist.log_prob(flat_act[idx])
                ratio = (logp - flat_logp[idx]).exp()
                adv = flat_adv[idx]
                policy_loss = -torch.min(ratio * adv, ratio.clamp(1 - clip, 1 + clip) * adv).mean()
                value_loss = ((value - flat_ret[idx]) ** 2).mean()
                entropy = dist.entropy().mean()
                last_entropy = float(entropy)
                loss = policy_loss + 0.5 * value_loss - ent_coef * entropy
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                optimizer.step()

        # --- diagnostica -------------------------------------------------
        recent = episode_scores[-500:]
        explained = 1.0 - float(np.var(returns.reshape(-1) - values.reshape(-1)) / (np.var(returns) + 1e-8))
        rate = done_steps / max(1e-9, time.time() - started)
        print(
            f"  {done_steps:>9,} passi | score {np.mean(recent) if recent else 0:.3f} "
            f"| entropia {last_entropy:.2f} | var.spiegata {explained:+.2f} "
            f"| {len(episode_scores):>6,} episodi | {rate:,.0f} passi/s",
            flush=True,
        )

        if done_steps >= next_eval:
            next_eval += eval_every
            score = evaluate(env, net, eval_episodes)
            flag = ""
            if score > best:
                best = score
                out_path.parent.mkdir(parents=True, exist_ok=True)
                model = export_model(
                    net, env.observation_size, env.action_size, info.shape,
                    {
                        "scenario": info.scenario, "opponents": info.agents, "players": info.players,
                        "steps": done_steps, "evalScore": round(score, 4),
                        "hidden": hidden, "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    },
                )
                out_path.write_text(json.dumps(model), encoding="utf-8")
                flag = f"  → salvata in {out_path.relative_to(REPO_ROOT)}"
            print(f"  ── eval su {eval_episodes:,} episodi: score {score:.3f} (migliore {best:.3f}){flag}", flush=True)

    score = evaluate(env, net, eval_episodes)
    if score > best or not out_path.exists():
        best = max(best, score)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(export_model(
                net, env.observation_size, env.action_size, info.shape,
                {
                    "scenario": info.scenario, "opponents": info.agents, "players": info.players,
                    "steps": done_steps, "evalScore": round(score, 4),
                    "hidden": hidden, "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                },
            )),
            encoding="utf-8",
        )
    env.close()

    baseline = 1.0 / info.players
    print(
        f"\n{'=' * 66}\n"
        f"Pesi salvati in {out_path.relative_to(REPO_ROOT)}\n"
        f"Score finale: {score:.3f}  (0.500 = in media col tavolo; una policy casuale sta a ~0.01)\n"
        f"Vittoria attesa al caso: {baseline * 100:.0f}%\n\n"
        "Per farla giocare nelle simulazioni, in simulazione.yaml:\n\n"
        "  policies:\n"
        f"    trained: {out_path.relative_to(REPO_ROOT)}\n\n"
        "  scenarios:\n"
        "    - name: la rete contro gli archetipi\n"
        "      agents: [trained, etfhunter, cashking, bluffer]\n\n"
        "poi:  npm run sim\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
