import protobuf from 'protobufjs/minimal.js'
import { bytesToBase64 } from '../crypto/encoding'
import { EResult, eresultName } from './eresult'

const STEAM_API_BASE = 'https://api.steampowered.com'

export type HttpMethod = 'GET' | 'POST'

export type ProtobufType<T> = {
  encode(message: T, writer?: protobuf.Writer): protobuf.Writer
  decode(bytes: Uint8Array): T
}

export type SteamApiResponse<T> = {
  result: EResult
  errorMessage: string | null
  response: T
}

export class SteamApiError extends Error {
  constructor(
    message: string,
    public result: EResult,
    public errorMessage: string | null,
  ) {
    super(message)
  }
}

function base64UrlPadded(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_')
}

export async function sendSteamApiRequest<Req, Res>(input: {
  apiInterface: string
  apiMethod: string
  version?: number
  method: HttpMethod
  requestType: ProtobufType<Req>
  responseType: ProtobufType<Res>
  request: Req
  accessToken?: string | null
}): Promise<SteamApiResponse<Res>> {
  const version = input.version ?? 1
  const url = new URL(`${STEAM_API_BASE}/${input.apiInterface}/${input.apiMethod}/v${version}`)
  const encodedBytes = input.requestType.encode(input.request, new protobuf.Writer()).finish()

  const init: RequestInit = { method: input.method }
  if (input.accessToken) url.searchParams.set('access_token', input.accessToken)

  if (input.method === 'GET') {
    url.searchParams.set('input_protobuf_encoded', base64UrlPadded(encodedBytes))
  } else {
    const form = new FormData()
    form.set('input_protobuf_encoded', bytesToBase64(encodedBytes))
    init.body = form
  }

  const response = await fetch(url, init)
  const result = Number(response.headers.get('x-eresult') ?? EResult.Invalid) as EResult
  const errorMessage = response.headers.get('x-error_message')
  const body = new Uint8Array(await response.arrayBuffer())

  if (!response.ok) {
    throw new SteamApiError(`Steam API HTTP ${response.status}: ${errorMessage ?? response.statusText}`, result, errorMessage)
  }

  const decoded = input.responseType.decode(body)
  if (result !== EResult.Invalid && result !== EResult.OK && result !== EResult.Pending) {
    throw new SteamApiError(`Steam API failed: ${eresultName(result)}`, result, errorMessage)
  }

  return { result, errorMessage, response: decoded }
}
