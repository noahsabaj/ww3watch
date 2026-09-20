import { it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { encryptBackup, decryptBackup } from './backup-crypto'
it('round-trips encrypted archives and detects modification', () => {
  const keys = generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
  const original = Buffer.from('private feedback and operational data')
  const sealed = encryptBackup(original,keys.publicKey)
  expect(sealed.toString()).not.toContain(original.toString())
  expect(decryptBackup(sealed,keys.privateKey)).toEqual(original)
  const tampered = JSON.parse(sealed.toString()); tampered.tag = Buffer.alloc(16).toString('base64')
  expect(()=>decryptBackup(Buffer.from(JSON.stringify(tampered)),keys.privateKey)).toThrow()
})
