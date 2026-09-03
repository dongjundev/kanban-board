import { afterEach, describe, expect, it, vi } from 'vitest'
import { gzipJsonRequest } from './http'

async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

describe('gzipJsonRequest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('본문을 gzip으로 압축하고 Content-Encoding을 붙인다', async () => {
    const payload = { content: '회사망에서 막히던 긴 메모 '.repeat(2000) }
    const init = await gzipJsonRequest('POST', payload)

    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    const body = init.body as Blob
    // 반복 텍스트는 크게 줄어야 한다 — 압축이 실제로 적용됐는지
    expect(body.size).toBeLessThan(JSON.stringify(payload).length / 5)
    // 서버가 풀었을 때 원래 JSON과 같아야 한다
    expect(JSON.parse(await gunzip(body))).toEqual(payload)
  })

  it('CompressionStream이 없는 브라우저는 평문 JSON으로 폴백한다', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const init = await gzipJsonRequest('PUT', { title: '제목', code: 'flowchart TD' })

    expect(init.body).toBe('{"title":"제목","code":"flowchart TD"}')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' }) // 서버가 압축으로 오해하지 않게 헤더 없음
  })
})
