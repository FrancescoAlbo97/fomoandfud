/**
 * `npm run report` — trasforma uno o più file JSONL di partite in una pagina
 * HTML con i grafici. Il file è autoconsistente: nessuna dipendenza, nessuna
 * rete, si apre con un doppio clic.
 *
 *   npm run report -- data/matches.jsonl
 *   npm run report -- base=data/base.jsonl variante=data/fee-alte.jsonl
 *   npm run report -- data/matches.jsonl --out report.html
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseJsonl, reportFromRecords, type RunMeta } from './reportData'
import { renderReportHtml } from './reportHtml'

interface Input {
  label: string
  file: string
}

function parseArgs(argv: string[]): { inputs: Input[]; out: string | null } {
  const inputs: Input[] = []
  let out: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') {
      out = argv[++i]
      continue
    }
    if (arg === '--help') {
      console.log(`
FOMO & FUD — report grafico

  npm run report -- data/matches.jsonl
  npm run report -- base=data/base.jsonl variante=data/variante.jsonl
  npm run report -- data/matches.jsonl --out report.html

Passa fino a 3 file per confrontare run diverse; con "etichetta=file" scegli
il nome che compare nella legenda.
`)
      process.exit(0)
    }
    const eq = arg.indexOf('=')
    if (eq > 0) inputs.push({ label: arg.slice(0, eq), file: arg.slice(eq + 1) })
    else inputs.push({ label: basename(arg).replace(/\.jsonl$/, ''), file: arg })
  }
  return { inputs, out }
}

const { inputs, out } = parseArgs(process.argv.slice(2))
if (inputs.length === 0) {
  console.error('\n❌ Serve almeno un file .jsonl. Genera i dati con:\n   npm run sim -- --games 20000 --out data/matches.jsonl\n')
  process.exit(1)
}
// Oltre 3 run i colori delle serie non restano distinguibili sotto daltonismo.
if (inputs.length > 3) {
  console.error(`\n❌ Massimo 3 run per confronto (ne hai passate ${inputs.length}): oltre, i colori non restano distinguibili.\n`)
  process.exit(1)
}

const runs = inputs.map(({ label, file }) => {
  if (!existsSync(file)) throw new Error(`File non trovato: ${file}`)
  const records = parseJsonl(readFileSync(file, 'utf8'))
  if (records.length === 0) throw new Error(`${file} non contiene partite`)
  const metaFile = `${file}.meta.json`
  const meta: RunMeta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
  console.log(`   ${label.padEnd(16)} ${records.length.toLocaleString('it-IT').padStart(9)} partite  ←  ${file}`)
  return { label: meta.label ?? label, records, meta }
})

const outFile = out ?? join(dirname(inputs[0].file), 'report.html')
writeFileSync(outFile, renderReportHtml(reportFromRecords(runs)))
console.log(`\n✅ Report scritto in ${outFile}\n   Aprilo con: open ${outFile}\n`)
