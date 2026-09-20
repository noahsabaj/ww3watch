import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { encryptBackup, decryptBackup } from './backup-crypto'

const [mode, directory] = process.argv.slice(2)
if (!directory) throw new Error('Usage: backup.ts encrypt|decrypt DIRECTORY')
const names = ['schema.sql','data.sql']
const hash = (s:string) => createHash('sha256').update(s).digest('hex')
if (mode==='encrypt') {
  if (!process.env.BACKUP_PUBLIC_KEY) throw new Error('BACKUP_PUBLIC_KEY missing')
  const files = Object.fromEntries(names.map(n=>[n,readFileSync(join(directory,n),'utf8')]))
  if (files['data.sql'].length<1000 || !files['schema.sql'].includes('CREATE TABLE')) throw new Error('Refusing empty/incomplete backup')
  const manifest = {version:1,createdAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,hashes:Object.fromEntries(names.map(n=>[n,hash(files[n])])),excluded:['article_content','article_translations','article_embeddings','classified_rejects','verdicts','pipeline_runs','rate_limits','trending_log']}
  const encrypted = encryptBackup(Buffer.from(JSON.stringify({manifest,files})),process.env.BACKUP_PUBLIC_KEY)
  const pages = JSON.parse(execFileSync('gh',['api','--paginate','--slurp',`repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts?per_page=100`],{encoding:'utf8'}))
  const stored = pages.flatMap((p:{artifacts:Array<{expired:boolean;size_in_bytes:number}>})=>p.artifacts).filter((a:{expired:boolean})=>!a.expired).reduce((sum:number,a:{size_in_bytes:number})=>sum+a.size_in_bytes,0)
  if (stored+encrypted.length>400*1024*1024) throw new Error('Backup storage safety budget reached; retain existing backups and investigate')
  writeFileSync(join(directory,'ww3watch-backup.enc'),encrypted)
  console.log(JSON.stringify({encryptedBytes:encrypted.length,existingArtifactBytes:stored,createdAt:manifest.createdAt}))
} else if (mode==='decrypt') {
  if (!process.env.BACKUP_PRIVATE_KEY) throw new Error('BACKUP_PRIVATE_KEY missing')
  const {manifest,files} = JSON.parse(decryptBackup(readFileSync(join(directory,'ww3watch-backup.enc')),process.env.BACKUP_PRIVATE_KEY).toString())
  mkdirSync(join(directory,'restored'),{recursive:true})
  for (const name of names) {
    if (typeof files[name]!=='string' || hash(files[name])!==manifest.hashes[name]) throw new Error('Backup integrity check failed')
    writeFileSync(join(directory,'restored',name),files[name],{mode:0o600})
  }
  console.log(JSON.stringify({restoredAt:new Date().toISOString(),backupCreatedAt:manifest.createdAt,bytes:statSync(join(directory,'ww3watch-backup.enc')).size}))
} else throw new Error('Unknown backup operation')
