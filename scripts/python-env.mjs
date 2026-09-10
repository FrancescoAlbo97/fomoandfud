/**
 * Percorsi e creazione dell'ambiente virtuale Python.
 *
 * Il venv sta in `.venv/` alla radice: è la posizione che VS Code, PyCharm e
 * gli strumenti di lint trovano da soli, senza configurazione.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const VENV_DIR = '.venv'

/** Su Windows gli eseguibili stanno in Scripts/, altrove in bin/. */
export function venvPython() {
  return process.platform === 'win32'
    ? join(VENV_DIR, 'Scripts', 'python.exe')
    : join(VENV_DIR, 'bin', 'python')
}

export function venvExists() {
  return existsSync(venvPython())
}

function systemPython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // prova il prossimo
    }
  }
  throw new Error('Python non trovato. Installalo da https://www.python.org/downloads/')
}

export function createVenv() {
  const python = systemPython()
  console.log(`Creo l'ambiente virtuale in ${VENV_DIR}/ …`)
  execFileSync(python, ['-m', 'venv', VENV_DIR], { stdio: 'inherit' })
}

export function install({ rl = false } = {}) {
  const requirements = rl ? 'python/requirements-rl.txt' : 'python/requirements.txt'
  console.log(`Installo ${requirements} …`)
  execFileSync(venvPython(), ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'ignore' })
  execFileSync(venvPython(), ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' })
}
