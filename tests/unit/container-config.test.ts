import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string) => readFileSync(path, 'utf8')

describe('container packaging', () => {
  it('runs the production image as a healthy non-root process', () => {
    const dockerfile = readProjectFile('Dockerfile')

    expect(dockerfile).toMatch(/^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}/)
    expect(dockerfile).toMatch(/FROM node:24-bookworm-slim@sha256:[a-f0-9]{64} AS build/)
    expect(dockerfile).toMatch(/FROM node:24-bookworm-slim@sha256:[a-f0-9]{64} AS runtime/)
    expect(dockerfile).toContain('npm ci --omit=dev')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(dockerfile).toContain('CMD ["node", "dist/server/start.js"]')
  })

  it('constrains the Compose service and persists its SQLite databases', () => {
    const compose = readProjectFile('compose.yaml')

    expect(compose).toContain('init: true')
    expect(compose).toContain('read_only: true')
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/)
    expect(compose).toContain('no-new-privileges:true')
    expect(compose).toContain('stop_grace_period: 15s')
    expect(compose).toContain('orderflow-data:/app/data')
  })

  it('boots and exercises the image in CI', () => {
    const workflow = readProjectFile('.github/workflows/ci.yml')
    const smokeTest = readProjectFile('scripts/docker-smoke.mjs')

    expect(workflow).toContain('docker compose config --quiet')
    expect(workflow).toContain('docker compose build')
    expect(workflow).toContain('docker compose up -d --wait')
    expect(workflow).toContain('node scripts/docker-smoke.mjs --restart')
    expect(workflow).toContain('ReadonlyRootfs')
    expect(workflow).toContain('no-new-privileges')
    expect(workflow).toContain('CapDrop')
    const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)].map((match) => match[1])
    expect(actionReferences.length).toBeGreaterThan(0)
    expect(actionReferences.every((reference) => /^[a-f0-9]{40}$/.test(reference ?? ''))).toBe(true)
    expect(smokeTest).toContain('/health/ready')
    expect(smokeTest).toContain('/api/v1/orders')
    expect(smokeTest).toContain('randomUUID()')
    expect(smokeTest).toContain('create.response.status !== 202')
    expect(smokeTest).toContain("['compose', 'restart', 'orderflow']")
  })
})
