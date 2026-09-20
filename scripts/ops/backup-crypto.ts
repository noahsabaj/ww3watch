import { createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

export function encryptBackup(data: Buffer, publicKey: string): Buffer {
  const key = randomBytes(32), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(gzipSync(data)),cipher.final()])
  return Buffer.from(JSON.stringify({version:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')}))
}
export function decryptBackup(envelope: Buffer, privateKey: string): Buffer {
  const value = JSON.parse(envelope.toString())
  if (value.version!==1) throw new Error('Unsupported backup version')
  const key = privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(value.key,'base64'))
  const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'))
  decipher.setAuthTag(Buffer.from(value.tag,'base64'))
  return gunzipSync(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]))
}
