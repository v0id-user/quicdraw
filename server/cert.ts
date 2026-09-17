import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Browsers pin a self-signed certificate only if it is ECDSA P-256 and lasts at most 14 days.
export const CERT_DAYS = 13

export function mintCertificate(ip: string) {
  const dir = mkdtempSync(join(tmpdir(), 'quicdraw-'))
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath], { stdio: 'pipe' })
  execFileSync(
    'openssl',
    ['req', '-new', '-x509', '-key', keyPath, '-out', certPath, '-days', String(CERT_DAYS),
      '-subj', '/CN=quicdraw', '-addext', `subjectAltName=IP:${ip}`],
    { stdio: 'pipe' },
  )
  const cert = readFileSync(certPath, 'utf8')
  const privKey = readFileSync(keyPath, 'utf8')
  rmSync(dir, { recursive: true })
  const sha256 = [...createHash('sha256').update(new X509Certificate(cert).raw).digest()]
  return { cert, privKey, sha256 }
}
