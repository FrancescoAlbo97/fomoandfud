/** `npm run py:setup` — crea .venv e installa le dipendenze Python.
 *  Con `-- --rl` installa anche numpy e gymnasium. */
import { createVenv, install, venvExists, venvPython } from './python-env.mjs'

const wantsRl = process.argv.includes('--rl')
if (!venvExists()) createVenv()
install({ rl: wantsRl })

console.log(`
✅ Ambiente pronto: ${venvPython()}

   npm run play                     gioca leggendo simulazione.yaml
   npm run play -- --episodes 5000  passa argomenti allo script
${wantsRl ? '' : '\n   npm run py:setup -- --rl        aggiunge numpy e gymnasium per addestrare\n'}
   Per usarlo a mano:  source ${venvExists() ? '.venv/bin/activate' : '.venv/bin/activate'}
`)
