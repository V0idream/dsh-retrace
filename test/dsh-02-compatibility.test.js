import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Session, deriveEventMessage } from '@deepseek-ai/dsh-session'
import { satisfies } from 'semver'
import { createEditorApi } from '../lib/host-core.js'
import { createDshMarkerWriter } from '../lib/adapter/dsh-writer.js'
import { sessionEvents } from '../lib/host-compat.js'
import { automaticTitlePinningEnabled } from '../lib/index.js'
import { officialSurfaceMeter } from './official-meter.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('DSH 0.2 release candidate compatibility', () => {
  it('accepts Cordis 4.x and DSH prereleases without including future 0.3 hosts', () => {
    expect(satisfies('4.0.5', pkg.peerDependencies['@deepseek-ai/cordis'])).toBe(true)
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      expect(satisfies('0.1.7-rc.2', range), name).toBe(true)
      expect(satisfies('0.2.0-rc.2', range), name).toBe(true)
      expect(satisfies('0.3.0', range), name).toBe(false)
    }
    expect(satisfies('0.2.0-rc.2', pkg.dsh.compatibility.dsh)).toBe(true)
  })

  it('lets existing deployments opt out of automatic title pinning', () => {
    expect(automaticTitlePinningEnabled({})).toBe(true)
    expect(automaticTitlePinningEnabled({ DSH_RETRACE_PIN_TITLES: '0' })).toBe(false)
  })

  it('edits a real 0.2 Session using native replacement events, then survives strict replay', async () => {
    const session = Session.create('00000000-0000-4000-8000-000000000001')
    session.append('request/header', {
      header: { config: { provider: 'test-provider', model: 'test-model' } }, reason: 'initial',
    })
    session.append('user/message', {
      id: 'u1', role: 'user', content: [{ type: 'text', text: 'original' }], source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    const agent = { status: 'idle', followup: vi.fn() }
    const writer = createDshMarkerWriter({
      validateMarker: () => ({ t1Ok: true }),
      meter: () => officialSurfaceMeter(session),
      deriveMessage: deriveEventMessage,
    })
    const api = createEditorApi({}, { get: () => session }, { get: () => agent }, () => {}, {
      writeMarker: writer.writeMarker,
    })
    const result = await api.editAndResend({ sessionId: session.id, messageId: 'u1', text: 'replacement' })
    expect(result.ok, result.error?.message).toBe(true)
    expect(agent.followup).toHaveBeenCalledOnce()
    expect(agent.followup.mock.calls[0][0].content).toEqual([{ type: 'text', text: 'replacement' }])
    const replay = Session.create(session.id, sessionEvents(session))
    expect(JSON.stringify(replay.deriveMessages())).not.toContain('original')
  })
})
