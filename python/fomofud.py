"""
Client Python del motore di FOMO & FUD.

Il motore resta in TypeScript: qui c'è solo un client che parla con il ponte
Node (`npm run bridge`) via stdin/stdout, una riga JSON per messaggio. Lo
scambio è a BLOCCHI — N partite avanzano insieme a ogni `step` — così il costo
della comunicazione si spalma su tutte e resta trascurabile.

Il ponte fa giocare gli avversari da solo: Python vede solo i punti in cui deve
decidere l'agente in addestramento, con osservazione già vettorizzata e maschera
delle azioni legali.

Dipendenze: nessuna per `Bridge` e `FomoFudVecEnv` (solo standard library).
numpy e gymnasium servono solo a `FomoFudEnv`.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_ENTRY = REPO_ROOT / "dist-sim" / "sim" / "bridge.js"
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-sim.mjs"


@dataclass
class BridgeInfo:
    """Quello che il ponte dichiara all'avvio."""

    obs_size: int
    action_size: int
    envs: int
    scenario: str
    agents: list[str]
    players: int
    rounds: int
    feature_layout: list[dict[str, Any]]
    action_segments: dict[str, dict[str, int]]
    #: Impronta della forma di gioco: va salvata nel modello per impedire che
    #: una policy giochi su un tavolo con settori o Mercato diversi.
    shape: str


class Bridge:
    """Processo Node che tiene N partite e risponde a reset/step."""

    def __init__(
        self,
        config: str = "simulazione.yaml",
        scenario: str | None = None,
        envs: int | None = None,
        seed: int = 1,
        build: bool = True,
        opponents: Sequence[str] | None = None,
    ) -> None:
        if build or not BRIDGE_ENTRY.exists():
            subprocess.run(
                ["node", str(BUILD_SCRIPT)], cwd=REPO_ROOT, check=True,
                stdout=subprocess.DEVNULL, stderr=sys.stderr,
            )
        cmd = ["node", str(BRIDGE_ENTRY), "--config", config, "--seed", str(seed)]
        if scenario:
            cmd += ["--scenario", scenario]
        if envs:
            cmd += ["--envs", str(envs)]
        if opponents:
            cmd += ["--opponents", ",".join(opponents)]

        self._proc = subprocess.Popen(
            cmd, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=None, text=True, bufsize=1,
        )
        hello = self._read()
        if hello.get("type") != "hello":
            raise RuntimeError(f"Handshake inatteso dal ponte: {hello}")
        self.info = BridgeInfo(
            obs_size=hello["obsSize"],
            action_size=hello["actionSize"],
            envs=hello["envs"],
            scenario=hello["scenario"],
            agents=hello["agents"],
            players=hello["players"],
            rounds=hello["rounds"],
            feature_layout=hello["featureLayout"],
            action_segments=hello["actionSegments"],
            shape=hello["shape"],
        )

    def _read(self) -> dict[str, Any]:
        line = self._proc.stdout.readline()  # type: ignore[union-attr]
        if not line:
            raise RuntimeError("Il ponte Node si è chiuso senza rispondere")
        return json.loads(line)

    def _send(self, message: dict[str, Any]) -> dict[str, Any]:
        self._proc.stdin.write(json.dumps(message) + "\n")  # type: ignore[union-attr]
        self._proc.stdin.flush()  # type: ignore[union-attr]
        reply = self._read()
        if "error" in reply:
            raise RuntimeError(reply["error"])
        return reply

    def reset(self) -> dict[str, Any]:
        return self._send({"cmd": "reset"})

    def step(self, actions: Sequence[int]) -> dict[str, Any]:
        return self._send({"cmd": "step", "actions": [int(a) for a in actions]})

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                self._proc.stdin.write('{"cmd":"close"}\n')  # type: ignore[union-attr]
                self._proc.stdin.flush()  # type: ignore[union-attr]
                self._proc.wait(timeout=5)
            except Exception:
                self._proc.kill()

    def __enter__(self) -> "Bridge":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class FomoFudVecEnv:
    """
    Ambiente vettorizzato: N partite in parallelo, una azione per partita.

    Semantica standard delle VecEnv: quando una partita finisce, `done` è True e
    l'osservazione restituita è già la PRIMA del nuovo episodio (autoreset).
    La ricompensa è zero durante la partita e alla fine vale il RANGO
    normalizzato — 1.0 se hai battuto tutti, 0.0 se sei ultimo, condivisa in
    caso di pareggio. Si massimizza la vittoria, non i Punti Vittoria.
    """

    def __init__(self, **kwargs: Any) -> None:
        self.bridge = Bridge(**kwargs)
        self.info = self.bridge.info
        self.num_envs = self.info.envs
        self.observation_size = self.info.obs_size
        self.action_size = self.info.action_size

    def reset(self) -> tuple[list[list[float]], list[list[int]]]:
        """Ritorna (osservazioni, indici delle azioni legali) per ogni partita."""
        r = self.bridge.reset()
        return r["obs"], r["legal"]

    def step(
        self, actions: Sequence[int]
    ) -> tuple[list[list[float]], list[list[int]], list[float], list[bool]]:
        r = self.bridge.step(actions)
        return r["obs"], r["legal"], r["reward"], r["done"]

    def as_mask(self, legal: Sequence[int]) -> list[bool]:
        """Espande gli indici legali in una maschera booleana piena."""
        mask = [False] * self.action_size
        for i in legal:
            mask[i] = True
        return mask

    def close(self) -> None:
        self.bridge.close()

    def __enter__(self) -> "FomoFudVecEnv":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def make_gym_env(**kwargs: Any):
    """
    Ambiente Gymnasium a singolo agente (envs=1).

    Gymnasium è single-agent e FOMO & FUD ha 3-5 giocatori: gli altri posti sono
    dentro l'ambiente, giocati dagli agenti del motore. È il modo consueto di
    impostare il self-play, e mantiene valida l'interfaccia standard.

    `action_masks()` è il nome che si aspetta MaskablePPO di sb3-contrib.
    """
    import gymnasium as gym  # import pigro: serve solo qui
    import numpy as np

    class FomoFudEnv(gym.Env):  # type: ignore[misc]
        metadata = {"render_modes": []}

        def __init__(self) -> None:
            kwargs.setdefault("envs", 1)
            self._vec = FomoFudVecEnv(**kwargs)
            self.info = self._vec.info
            # Gli estremi combaciano con FEATURE_MIN/FEATURE_MAX di features.ts,
            # dove il vettore viene saturato prima di partire.
            self.observation_space = gym.spaces.Box(
                low=-1.0, high=2.0, shape=(self._vec.observation_size,), dtype=np.float32
            )
            self.action_space = gym.spaces.Discrete(self._vec.action_size)
            self._mask = np.zeros(self._vec.action_size, dtype=bool)

        def action_masks(self) -> "np.ndarray":
            return self._mask

        def _set_mask(self, legal) -> None:
            self._mask = np.zeros(self._vec.action_size, dtype=bool)
            self._mask[np.asarray(legal, dtype=int)] = True

        def reset(self, *, seed: int | None = None, options: dict | None = None):
            super().reset(seed=seed)
            obs, legal = self._vec.reset()
            self._set_mask(legal[0])
            return np.array(obs[0], dtype=np.float32), {"action_mask": self._mask}

        def step(self, action):
            obs, legal, reward, done = self._vec.step([action])
            self._set_mask(legal[0])
            return (
                np.array(obs[0], dtype=np.float32),
                float(reward[0]),
                bool(done[0]),
                False,
                {"action_mask": self._mask},
            )

        def close(self) -> None:
            self._vec.close()

    return FomoFudEnv()
