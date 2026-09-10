// Compila engine + simulatore in CommonJS dentro dist-sim/, così `node` può
// eseguirli senza bundler (il progetto principale resta ESM per Vite).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

execFileSync('npx', ['tsc', '-p', 'tsconfig.sim.json'], { stdio: 'inherit' })
mkdirSync('dist-sim', { recursive: true })
writeFileSync('dist-sim/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`)
