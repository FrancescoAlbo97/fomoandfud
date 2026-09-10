/** Esegue uno script Python dentro il venv, creandolo al primo utilizzo.
 *  `npm run play -- --scenario "trader povero"` inoltra tutti gli argomenti. */
import { spawnSync } from 'node:child_process'
import { createVenv, install, venvExists, venvPython } from './python-env.mjs'

if (!venvExists()) {
  console.log('Primo avvio: preparo l\'ambiente Python.\n')
  createVenv()
  install()
  console.log('')
}

const result = spawnSync(venvPython(), process.argv.slice(2), { stdio: 'inherit' })
process.exit(result.status ?? 1)
